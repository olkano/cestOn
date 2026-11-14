import { randomUUID } from 'node:crypto';
import { commandSchema, DomainError, type Command, type Receipt, type Scope } from '../../../../packages/contracts/src/commands.js';
import type { Config, ProjectConfig } from '../../../../packages/contracts/src/config.js';
import { redactText } from '../../../../packages/contracts/src/logging.js';
import { Store, type CommandRow, type DecisionRow, type TaskRow } from '../db/store.js';

export type CommandHook = (command: Command, commandId: string, task: TaskRow | null) => { taskId?: string; dispatch?: boolean };
export class CommandService {
  readonly hooks = new Map<string, CommandHook>();
  constructor(readonly store: Store, readonly config: Config, private crash?: (point: string) => void) {}

  receive(deviceId: string, key: string, input: unknown): Receipt {
    if (!/^[0-9a-f-]{36}$/i.test(key)) throw new DomainError('invalid_idempotency_key', 400);
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new DomainError('invalid_command', 400);
    const command = parsed.data; const db = this.store.db; const hash = this.store.payloadHash(command);
    return db.transaction(() => {
      const device = db.prepare('SELECT revoked_at,expires_at FROM devices WHERE id=?').get(deviceId) as { revoked_at: number | null; expires_at: number } | undefined;
      if (!device || device.revoked_at !== null || device.expires_at <= this.store.now()) throw new DomainError('device_revoked', 401);
      const prior = db.prepare('SELECT * FROM commands WHERE device_id=? AND idempotency_key=?').get(deviceId, key) as CommandRow | undefined;
      if (prior) { if (prior.payload_hash !== hash) throw new DomainError('idempotency_conflict'); return this.store.command(prior.id); }
      if (db.prepare('SELECT 1 FROM command_tombstones WHERE device_id=? AND idempotency_key=?').get(deviceId, key)) throw new DomainError('idempotency_expired');
      if (command.type === 'decision.answer') {
        const priorDecision = db.prepare('SELECT * FROM decisions WHERE id=?').get(command.payload.decisionId) as DecisionRow | undefined;
        if (priorDecision?.state === 'answered') {
          if (priorDecision.task_id !== command.taskId || priorDecision.revision !== command.payload.decisionRevision || priorDecision.scope_revision_id !== command.scopeRevisionId) throw new DomainError('stale_decision');
          if (priorDecision.chosen_option_id !== command.payload.optionId) throw new DomainError('decision_conflict');
          return this.store.command(priorDecision.command_id!);
        }
      }
      if (command.type === 'action.approve') {
        const previous = db.prepare('SELECT * FROM action_approvals WHERE id=?').get(command.payload.approvalId) as { task_id: string; revision: number; proposed_hash: string; scope_revision_id: string; approved_command_id: string | null } | undefined;
        if (previous?.approved_command_id) {
          if (previous.task_id !== command.taskId || previous.revision !== command.payload.revision || previous.proposed_hash !== command.payload.proposedHash || previous.scope_revision_id !== command.scopeRevisionId) throw new DomainError('action_conflict');
          return this.store.command(previous.approved_command_id);
        }
      }
      const task = 'taskId' in command ? this.store.taskRow(command.taskId) : null;
      if (task && 'expectedRevision' in command && (task.revision !== command.expectedRevision || !('scopeRevisionId' in command) || task.scope_revision_id !== command.scopeRevisionId)) throw new DomainError('stale_revision');
      if (command.type.startsWith('installation.') && 'expectedRevision' in command && command.expectedRevision !== this.store.installation().revision) throw new DomainError('stale_revision');
      const id = randomUUID(); let taskId = task?.id ?? null; let dispatch = false;
      if (command.type === 'task.create') taskId = this.createTask(command, deviceId, hash);
      const supported = new Set(['task.create', 'task.instruct', 'decision.answer', 'task.pause', 'task.resume', 'task.cancel', 'task.prioritize', 'task.accept', 'installation.pause', 'installation.resume']);
      if (!supported.has(command.type) && !this.hooks.has(command.type)) throw new DomainError('unsupported_capability', 422);
      db.prepare('INSERT INTO commands(id,task_id,device_id,idempotency_key,payload_hash,type,payload_json,expected_revision,scope_revision_id,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,\'queued\',?)').run(id, taskId, deviceId, key, hash, command.type, JSON.stringify(command), 'expectedRevision' in command ? command.expectedRevision : null, taskId ? this.store.taskRow(taskId).scope_revision_id : null, this.store.now());
      if (command.type === 'task.create') dispatch = true;
      else if (command.type === 'installation.pause' || command.type === 'installation.resume') {
        const recovery = db.prepare("SELECT state_json FROM service_checkpoints WHERE name='recovery'").get() as { state_json: string } | undefined;
        if (command.type === 'installation.resume' && recovery && (JSON.parse(recovery.state_json) as { reconciliationRequired?: boolean }).reconciliationRequired) throw new DomainError('restore_reconciliation_required');
        const paused = command.type === 'installation.pause';
        db.prepare('UPDATE installations SET dispatch_paused=?,revision=revision+1').run(paused ? 1 : 0);
        this.store.event(this.store.installation().id, this.store.installation().revision, 'host.status', { dispatchPaused: paused });
      } else if (command.type === 'decision.answer' && task) {
        const decision = db.prepare('SELECT * FROM decisions WHERE id=? AND task_id=?').get(command.payload.decisionId, task.id) as DecisionRow | undefined;
        if (!decision || decision.state !== 'open' || decision.revision !== command.payload.decisionRevision || decision.scope_revision_id !== task.scope_revision_id) throw new DomainError('stale_decision');
        if (decision.expires_at <= this.store.now()) throw new DomainError('decision_expired');
        const options = JSON.parse(decision.options_json) as { id: string; meaning: string }[];
        const option = options.find(o => o.id === command.payload.optionId);
        if (!option) throw new DomainError('unknown_option', 400);
        db.prepare("UPDATE decisions SET state='answered',chosen_option_id=?,command_id=? WHERE id=?").run(option.id, id, decision.id);
        this.store.changeTask(task.id, 'queued', 'Decision recorded. Waiting for an eligible worker.');
        db.prepare("UPDATE phases SET state='eligible' WHERE task_id=? AND state='waiting_input'").run(task.id);
        this.store.event(task.id, this.store.taskRow(task.id).revision, 'decision.changed', { decisionId: decision.id, revision: decision.revision, optionId: option.id, meaning: option.meaning });
        dispatch = true;
      } else if (command.type === 'task.instruct' && task) {
        if (['completed', 'cancelled'].includes(task.state)) throw new DomainError('task_terminal');
        if (task.state === 'review_ready') this.store.changeTask(task.id, 'queued', 'An adjustment is queued within the existing scope.');
        const revision = this.store.taskRow(task.id).revision;
        this.store.event(task.id, revision + 1, 'task.instruction', { text: redactText(command.payload.text), deliveryMode: command.payload.deliveryMode });
        db.prepare('UPDATE tasks SET revision=revision+1,updated_at=? WHERE id=?').run(this.store.now(), task.id); dispatch = true;
      } else if ((command.type === 'task.pause' || command.type === 'task.cancel') && task) {
        const active = db.prepare("SELECT id FROM runs WHERE task_id=? AND state IN ('created','starting','running','verifying','interrupting','reconciling','needs_attention') LIMIT 1").get(task.id);
        const final = command.type === 'task.cancel' ? 'cancelled' : 'paused';
        if (active) {
          if (task.state !== 'pausing') this.store.changeTask(task.id, 'pausing', 'Stop requested. Waiting for process acknowledgement.');
          db.prepare('UPDATE tasks SET stop_target=? WHERE id=?').run(final, task.id); dispatch = true;
        } else if (task.state !== final) this.store.changeTask(task.id, final, final === 'paused' ? 'Paused. Resume this task when ready.' : 'Cancelled.');
      } else if (command.type === 'task.resume' && task) {
        if (!['paused', 'blocked'].includes(task.state)) throw new DomainError('task_not_resumable');
        if (db.prepare("SELECT 1 FROM runs WHERE task_id=? AND state IN ('reconciling','needs_attention','interrupting')").get(task.id)) throw new DomainError('reconciliation_required');
        if (db.prepare("SELECT 1 FROM phases WHERE task_id=? AND state='blocked' AND attempt_count>=max_attempts").get(task.id)) throw new DomainError('attempt_budget_exhausted');
        db.prepare("UPDATE phases SET state='eligible' WHERE task_id=? AND state IN ('blocked','waiting_input')").run(task.id);
        this.store.changeTask(task.id, 'queued', 'Waiting for an eligible worker.'); dispatch = true;
      } else if (command.type === 'task.prioritize' && task) {
        this.store.setDependencies(task.id, command.payload.dependencyIds);
        db.prepare('UPDATE tasks SET priority=?,revision=revision+1,updated_at=? WHERE id=?').run(command.payload.priority, this.store.now(), task.id);
        this.store.event(task.id, task.revision + 1, 'task.changed', { priority: command.payload.priority });
      } else if (command.type === 'task.accept' && task) {
        const incomplete = db.prepare("SELECT 1 FROM phases WHERE task_id=? AND state!='done' LIMIT 1").get(task.id);
        if (task.state !== 'review_ready' || incomplete || !db.prepare('SELECT 1 FROM phases WHERE task_id=?').get(task.id)) throw new DomainError('verification_required');
        this.store.changeTask(task.id, 'completed', 'Accepted.');
      } else {
        const result = this.hooks.get(command.type)!(command, id, task);
        if (result.taskId) { taskId = result.taskId; db.prepare('UPDATE commands SET task_id=?,scope_revision_id=? WHERE id=?').run(taskId, this.store.taskRow(taskId).scope_revision_id, id); }
        dispatch = result.dispatch === true;
      }
      if (dispatch) db.prepare('INSERT INTO outbox(command_id,next_attempt_at) VALUES(?,?)').run(id, this.store.now());
      else db.prepare("UPDATE commands SET state='succeeded',accepted_at=?,resolved_at=?,revision=revision+1 WHERE id=?").run(this.store.now(), this.store.now(), id);
      this.store.event(taskId ?? this.store.installation().id, taskId ? this.store.taskRow(taskId).revision : this.store.installation().revision, 'command.changed', { commandId: id, state: dispatch ? 'queued' : 'succeeded', type: command.type });
      this.crash?.('before_commit');
      return this.store.command(id);
    })();
  }
  private createTask(command: Extract<Command, { type: 'task.create' }>, deviceId: string, requestHash: string) {
    const project = this.store.project(command.payload.projectId);
    const profile = JSON.parse(project.config_json) as ProjectConfig;
    for (const sourceId of command.payload.sourceIds) if (!this.store.db.prepare('SELECT 1 FROM sources WHERE id=? AND project_id=?').get(sourceId, project.id)) throw new DomainError('source_not_found', 404);
    const scope: Scope = command.payload.requestedScope;
    if (scope.operations.some(op => !profile.operations.includes(op))) throw new DomainError('scope_denied', 403);
    for (const cap of ['concurrency', 'phaseAttempts', 'runMinutes', 'taskPhases', 'turns'] as const) if (scope.budgets[cap] > this.config.limits[cap]) throw new DomainError('budget_denied', 403);
    if (this.config.limits.spendUsd !== undefined && (scope.budgets.spendUsd === undefined || scope.budgets.spendUsd > this.config.limits.spendUsd)) throw new DomainError('budget_denied', 403);
    const id = randomUUID(); const scopeId = randomUUID(); const now = this.store.now();
    this.store.db.prepare('INSERT INTO tasks(id,project_id,title,goal,state,scope_revision_id,created_at,updated_at,next_action) VALUES(?,?,?,?,\'queued\',?,?,?,?)').run(id, project.id, redactText(command.payload.title), redactText(command.payload.goal), scopeId, now, now, 'Waiting for an eligible worker.');
    this.store.db.prepare('INSERT INTO scope_revisions(id,task_id,revision,allowed_operations_json,roots_json,resources_json,budgets_json,completion_boundary,authority_source,created_at,request_hash) VALUES(?,?,1,?,?,?,?,?,?,?,?)').run(scopeId, id, JSON.stringify(scope.operations), JSON.stringify([project.canonical_root]), JSON.stringify([`workspace:${project.id}`]), JSON.stringify(scope.budgets), scope.completionBoundary, `device:${deviceId}`, now, requestHash);
    const provider = this.config.providers.find(provider => provider.id === profile.providerId) ?? null;
    this.store.db.prepare('INSERT INTO scope_profiles VALUES(?,?,?,?)').run(scopeId, JSON.stringify(profile), JSON.stringify(provider), this.store.payloadHash({ project: profile, provider }));
    const cursor = this.store.event(id, 1, 'task.changed', { state: 'queued', title: command.payload.title });
    this.store.db.prepare('UPDATE tasks SET summary_cursor=? WHERE id=?').run(cursor, id);
    if (command.payload.sourceIds.length) this.store.event(id, 1, 'task.sources', { sourceIds: command.payload.sourceIds, authority: 'untrusted_source' });
    return id;
  }
}
