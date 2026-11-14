import { randomUUID } from 'node:crypto';
import type { Store } from '../db/store.js';
import type { Config, ProjectConfig, Limits } from '../../../../packages/contracts/src/config.js';
import { validatePlan, workerCompletionSchema, type PhasePlan } from '../../../../packages/contracts/src/model.js';
import { DomainError, type Scope } from '../../../../packages/contracts/src/commands.js';
import type { ArtifactVerifier } from '../verification/index.js';
import { CoordinatorDetached } from './broker-worker.js';

export type WorkRequest = { taskId: string; runId: string; phaseId: string; commandId: string; scopeRevisionId: string; projectId: string; providerId: string; root: string; goal: string; operations: string[]; limits: Limits; artifacts: PhasePlan['expectedArtifacts']; verificationRecipeIds: string[]; attempt: number; instructions: { id: string; text: string }[] };
export interface Worker { execute(request: WorkRequest): Promise<unknown>; prepareWorkspace?(projectId: string, taskId: string, scopeRevisionId: string): Promise<string>; interrupt?(runId: string): Promise<{ acknowledged: boolean }>; }
type PhaseRow = { id: string; task_id: string; ordinal: number; state: string; attempt_count: number; max_attempts: number; dependencies_json: string; plan_json: string; revision: number };
export class Scheduler {
  private active = new Map<string, Promise<void>>(); private requests = new Map<string, WorkRequest>();
  private frozen = false;
  freeze(value: boolean) { this.frozen = value; }
  constructor(readonly store: Store, private config: Config, private worker: Worker, private verifier: ArtifactVerifier) {}
  savePlan(taskId: string, input: unknown) {
    const task = this.store.getTask(taskId); const project = JSON.parse(this.store.project(task.projectId).config_json) as ProjectConfig;
    const existing = task.phases;
    if (existing.some(p => p.state !== 'done')) throw new DomainError('plan_already_saved');
    const plan = validatePlan(input, { recipes: project.recipes, operations: task.scope.operations, maxPhases: task.scope.budgets.taskPhases - existing.length, completionBoundary: task.scope.completionBoundary });
    this.store.db.transaction(() => {
      const ids = new Map(plan.phases.map(p => [p.id, randomUUID()]));
      for (const [index, phase] of [...plan.phases].sort((a,b) => a.ordinal-b.ordinal).entries()) {
        const dependsOn: string[] = phase.dependsOn.map(id => ids.get(id)!); if (!dependsOn.length && existing.length) dependsOn.push(String(existing.at(-1)!.id));
        const normalized = { ...phase, id: ids.get(phase.id), ordinal: existing.length + index + 1, dependsOn };
        this.store.db.prepare('INSERT INTO phases(id,task_id,ordinal,goal,dependencies_json,verification_json,state,max_attempts,plan_json) VALUES(?,?,?,?,?,?,\'pending\',?,?)').run(normalized.id, taskId, normalized.ordinal, phase.goal, JSON.stringify(dependsOn), JSON.stringify(phase.verificationRecipeIds), task.scope.budgets.phaseAttempts, JSON.stringify(normalized));
      }
      this.store.event(taskId, task.revision, 'task.plan', { phaseIds: [...ids.values()], goal: plan.goal });
      this.store.db.prepare("UPDATE commands SET state='succeeded',resolved_at=? WHERE task_id=? AND type='task.create' AND state='queued'").run(this.store.now(), taskId);
      this.store.db.prepare("DELETE FROM outbox WHERE command_id IN (SELECT id FROM commands WHERE task_id=? AND type='task.create' AND state='succeeded')").run(taskId);
    })();
  }
  async tick() {
    await this.processStops();
    if (this.frozen || this.store.installation().dispatch_paused) return;
    const jobs: Promise<void>[] = [];
    const tasks = this.store.listTasks().filter(t => ['queued', 'running'].includes(t.state));
    for (const task of tasks) {
      if (this.active.size >= Math.min(this.config.limits.concurrency, task.scope.budgets.concurrency)) break;
      if ([...this.requests.values()].some(r => r.taskId === task.id)) continue;
      const blockedDependency = this.store.db.prepare("SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_id WHERE d.task_id=? AND t.state!='completed' LIMIT 1").get(task.id); if (blockedDependency) continue;
      const phases = this.store.db.prepare('SELECT * FROM phases WHERE task_id=? ORDER BY ordinal').all(task.id) as PhaseRow[];
      const phase = phases.find(p => ['pending', 'eligible'].includes(p.state) && p.attempt_count < p.max_attempts && (JSON.parse(p.dependencies_json) as string[]).every(id => phases.some(other => other.id === id && other.state === 'done')));
      if (!phase) continue;
      const project = this.store.project(task.projectId); const profile = JSON.parse(project.config_json) as ProjectConfig;
      const authorized = this.store.db.prepare('SELECT profile_hash FROM scope_profiles WHERE scope_revision_id=?').get(task.scopeRevisionId) as { profile_hash: string } | undefined;
      if (!authorized || authorized.profile_hash !== this.store.payloadHash({ project: profile, provider: this.config.providers.find(provider => provider.id === profile.providerId) ?? null })) { this.store.changeTask(task.id, 'blocked', 'Project or provider configuration changed. Create a task with fresh scope to continue.'); continue; }
      if (!profile.providerId) { if (task.state !== 'blocked') this.store.changeTask(task.id, 'blocked', 'Configure a certified provider for this project.'); continue; }
      const pending = this.store.db.prepare("SELECT c.id,c.payload_json FROM commands c JOIN outbox o ON o.command_id=c.id WHERE c.task_id=? AND c.type='task.instruct' AND c.state='queued' ORDER BY c.created_at LIMIT 1").all(task.id) as { id: string; payload_json: string }[];
      const instructions = pending.map(c => ({ id: c.id, text: (JSON.parse(c.payload_json) as { payload: { text: string } }).payload.text }));
      const request: WorkRequest = { taskId: task.id, runId: randomUUID(), commandId: randomUUID(), phaseId: phase.id, scopeRevisionId: task.scopeRevisionId, projectId: task.projectId, providerId: profile.providerId, root: project.canonical_root, goal: (JSON.parse(phase.plan_json) as PhasePlan).goal, operations: task.scope.operations, limits: task.scope.budgets, artifacts: (JSON.parse(phase.plan_json) as PhasePlan).expectedArtifacts, verificationRecipeIds: (JSON.parse(phase.plan_json) as PhasePlan).verificationRecipeIds, attempt: phase.attempt_count + 1, instructions };
      if (this.worker.prepareWorkspace) { try { request.root = await this.worker.prepareWorkspace(task.projectId, task.id, task.scopeRevisionId); } catch { this.store.changeTask(task.id, 'blocked', 'An isolated workspace could not be prepared. Check the registered project and its local diagnostics.'); continue; } }
      if (this.store.taskRow(task.id).revision !== task.revision || this.active.size >= Math.min(this.config.limits.concurrency, task.scope.budgets.concurrency)) continue;
      try {
        this.store.db.transaction(() => {
          this.store.acquireLease(request.root, task.id, request.runId, request.runId);
          if (phase.state === 'pending') this.store.db.prepare("UPDATE phases SET state='eligible' WHERE id=?").run(phase.id);
          this.store.db.prepare("UPDATE phases SET state='running',revision=revision+1 WHERE id=?").run(phase.id);
          this.store.db.prepare("INSERT INTO runs(id,task_id,phase_id,state,started_at,attempt,command_id) VALUES(?,?,?,'starting',?,?,?)").run(request.runId, task.id, phase.id, this.store.now(), request.attempt, request.commandId);
          const original = this.store.db.prepare('SELECT device_id FROM commands WHERE task_id=? ORDER BY created_at LIMIT 1').get(task.id) as { device_id: string };
          this.store.db.prepare("INSERT INTO commands(id,task_id,device_id,idempotency_key,payload_hash,type,payload_json,scope_revision_id,state,created_at) VALUES(?,?,?,?,?,'phase.execute',?,?,'queued',?)").run(request.commandId, task.id, original.device_id, request.commandId, this.store.payloadHash(request), JSON.stringify(request), task.scopeRevisionId, this.store.now());
          this.store.db.prepare('INSERT INTO outbox(command_id,next_attempt_at) VALUES(?,?)').run(request.commandId, this.store.now());
          if (task.state === 'queued') this.store.changeTask(task.id, 'running', phase.ordinal === 1 ? 'Working on the first phase.' : `Working on phase ${phase.ordinal}.`);
        })();
      } catch (error) { if (error instanceof DomainError && error.code === 'resource_busy') continue; throw error; }
      this.requests.set(request.runId, request);
      const job = Promise.resolve().then(() => this.run(request, JSON.parse(phase.plan_json) as PhasePlan)); this.active.set(request.runId, job); jobs.push(job);
    }
    await Promise.all(jobs);
  }
  private async run(request: WorkRequest, phase: PhasePlan) {
    let release = false; let dispatchAttempted = false; let executionCompleted = false;
    try {
      this.verifier.captureBaseline({ ...request, phase });
      this.store.db.prepare("UPDATE runs SET state='running' WHERE id=?").run(request.runId);
      dispatchAttempted = true; const completion = await this.worker.execute(request); executionCompleted = true;
      if (['pausing', 'paused', 'cancelled'].includes(this.store.taskRow(request.taskId).state)) { this.finalizeStop(request); release = true; return; }
      const parsed = workerCompletionSchema.safeParse(completion);
      if (parsed.success && parsed.data.status === 'needs_input' && parsed.data.decisionProposal) {
        this.store.db.prepare("UPDATE phases SET state='waiting_input' WHERE id=?").run(request.phaseId);
        this.store.createDecision(request.taskId, parsed.data.decisionProposal.prompt, parsed.data.decisionProposal.options, this.store.now() + 86400000);
        this.store.db.prepare("UPDATE runs SET state='failed',error_code='needs_input',ended_at=? WHERE id=?").run(this.store.now(), request.runId); release = true; return;
      }
      this.store.db.prepare("UPDATE runs SET state='verifying' WHERE id=?").run(request.runId);
      this.store.db.prepare("UPDATE phases SET state='verifying' WHERE id=?").run(request.phaseId);
      await this.verifier.verify({ ...request, phase, completion });
      this.store.db.transaction(() => {
        this.store.db.prepare("UPDATE phases SET state='done',revision=revision+1 WHERE id=?").run(request.phaseId);
        this.store.db.prepare("UPDATE runs SET state='succeeded',ended_at=? WHERE id=?").run(this.store.now(), request.runId);
        this.store.db.prepare("UPDATE commands SET state='succeeded',resolved_at=? WHERE id=?").run(this.store.now(), request.commandId);
        this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(request.commandId);
        for (const instruction of request.instructions) { this.store.db.prepare("UPDATE commands SET state='succeeded',resolved_at=? WHERE id=?").run(this.store.now(), instruction.id); this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(instruction.id); }
        const queuedInstruction = this.store.db.prepare("SELECT 1 FROM commands c JOIN outbox o ON o.command_id=c.id WHERE c.task_id=? AND c.type='task.instruct' AND c.state='queued'").get(request.taskId);
        if (!this.store.db.prepare("SELECT 1 FROM phases WHERE task_id=? AND state!='done'").get(request.taskId) && !queuedInstruction) {
          this.store.changeTask(request.taskId, 'review_ready', 'Review the verified artifacts and checks.');
          if (this.store.getTask(request.taskId).scope.completionBoundary === 'automatic') this.store.changeTask(request.taskId, 'completed', 'All authorized phases and automatic verification passed.');
        } else if (queuedInstruction && !this.store.db.prepare("SELECT 1 FROM phases WHERE task_id=? AND state!='done'").get(request.taskId)) {
          this.store.changeTask(request.taskId, 'review_ready', 'A scoped follow-up is queued.');
          this.store.changeTask(request.taskId, 'queued', 'Planning the queued follow-up within the remaining phase budget.');
        }
      })();
      release = true;
    } catch (error) {
      if (error instanceof CoordinatorDetached) return;
      if (['paused', 'cancelled'].includes(this.store.taskRow(request.taskId).state) || (this.store.taskRow(request.taskId).state === 'pausing' && error instanceof DomainError && error.code === 'worker_interrupted')) { this.finalizeStop(request); release = true; return; }
      const terminalFailure = error instanceof DomainError && ['worker_failed', 'worker_interrupted', 'run_timeout', 'worker_envelope_invalid'].includes(error.code);
      const uncertain = dispatchAttempted && !executionCompleted && !terminalFailure;
      const code = error instanceof DomainError ? error.code : 'worker_result_uncertain';
      this.store.db.transaction(() => {
        this.store.db.prepare('UPDATE runs SET state=?,error_code=?,ended_at=? WHERE id=?').run(uncertain ? 'reconciling' : 'failed', code, this.store.now(), request.runId);
        this.store.db.prepare("UPDATE phases SET state='blocked',attempt_count=attempt_count+1,revision=revision+1 WHERE id=?").run(request.phaseId);
        if (this.store.taskRow(request.taskId).state === 'running') this.store.changeTask(request.taskId, 'blocked', uncertain ? 'Work may have executed. Reconcile it before another attempt.' : `Verification stopped this phase: ${code}.`);
        this.store.db.prepare('UPDATE commands SET state=?,error_code=? WHERE id=?').run(uncertain ? 'reconciling' : 'failed', code, request.commandId);
        if (!uncertain) this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(request.commandId);
      })();
      release = !uncertain;
      if (!uncertain && code === 'verification_failed' && request.attempt < request.limits.phaseAttempts) {
        this.store.db.prepare("UPDATE phases SET state='eligible' WHERE id=?").run(request.phaseId);
        this.store.changeTask(request.taskId, 'queued', 'Investigate the failed check and retry within the existing scope.');
      }
    } finally {
      if (release) this.store.releaseLease(request.root, request.runId, true);
      this.active.delete(request.runId); this.requests.delete(request.runId);
    }
  }
  private async processStops() {
    for (const request of this.requests.values()) {
      const task = this.store.taskRow(request.taskId);
      if (this.store.installation().dispatch_paused && task.state === 'running') { this.store.changeTask(task.id, 'pausing', 'Pausing active work.'); this.store.db.prepare("UPDATE tasks SET stop_target='paused' WHERE id=?").run(task.id); }
      if (this.store.taskRow(task.id).state !== 'pausing' || !this.worker.interrupt) continue;
      const result = await this.worker.interrupt(request.runId);
      if (result.acknowledged) this.finalizeStop(request);
    }
  }
  private finalizeStop(request: WorkRequest) {
    const task = this.store.taskRow(request.taskId); const target = task.stop_target === 'cancelled' || task.state === 'cancelled' ? 'cancelled' : 'paused';
    this.store.db.transaction(() => {
      this.store.db.prepare("UPDATE runs SET state='interrupted',ended_at=? WHERE id=?").run(this.store.now(), request.runId);
      this.store.db.prepare('UPDATE phases SET state=? WHERE id=?').run(target === 'cancelled' ? 'cancelled' : 'eligible', request.phaseId);
      this.store.db.prepare("UPDATE commands SET state='cancelled',resolved_at=? WHERE id=?").run(this.store.now(), request.commandId);
      this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(request.commandId);
      this.store.db.prepare("UPDATE commands SET state='succeeded',resolved_at=? WHERE task_id=? AND type IN ('task.pause','task.cancel') AND state='queued'").run(this.store.now(), task.id);
      this.store.db.prepare("DELETE FROM outbox WHERE command_id IN (SELECT id FROM commands WHERE task_id=? AND type IN ('task.pause','task.cancel') AND state='succeeded')").run(task.id);
      if (task.state === 'pausing') this.store.changeTask(task.id, target, target === 'paused' ? 'Paused. Resume this task when ready.' : 'Cancelled.');
    })();
  }
  async idle() { await Promise.all([...this.active.values()]); }
  async recover() {
    const rows = this.store.db.prepare("SELECT r.id,r.phase_id,c.payload_json FROM runs r JOIN commands c ON c.id=r.command_id WHERE r.state IN ('created','starting','running','verifying')").all() as { id: string; phase_id: string; payload_json: string }[];
    for (const row of rows) {
      if (this.active.has(row.id)) continue;
      const request = JSON.parse(row.payload_json) as WorkRequest;
      const phase = this.store.db.prepare('SELECT plan_json FROM phases WHERE id=?').get(row.phase_id) as { plan_json: string };
      this.requests.set(row.id, request);
      const job = Promise.resolve().then(() => this.run(request, JSON.parse(phase.plan_json) as PhasePlan)); this.active.set(row.id, job);
    }
  }
  activeCount() { return this.active.size; }
  scope(taskId: string): Scope { return this.store.getTask(taskId).scope; }
}
