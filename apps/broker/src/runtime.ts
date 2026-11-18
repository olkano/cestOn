import { join } from 'node:path';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { ReceiptJournal } from './journal.js';
import { BrokerEvents } from './events.js';
import { ToolPolicy, childEnvironment } from './policy/index.js';
import { certificationValid, installationSecrets } from './certification.js';
import { WorkspaceManager } from './workspaces.js';
import { FixtureAdapter } from '../../../packages/adapters/src/fixture/index.js';
import { CodexAdapter } from '../../../packages/adapters/src/codex/index.js';
import { ClaudeAdapter } from '../../../packages/adapters/src/claude/index.js';
import type { Adapter, RunRef, RunRequest } from '../../../packages/adapters/src/types.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { operationSchema, type Config } from '../../../packages/contracts/src/config.js';
import { canonicalPath, within, validateDataRoot } from '../../../packages/contracts/src/paths.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { SessionDiscovery } from '../../../packages/adapters/src/discovery.js';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { safePath } from '../../../packages/contracts/src/paths.js';
import { workerCompletionSchema, artifactSchema, planSchema, intentSchema } from '../../../packages/contracts/src/model.js';
import { randomUUID } from 'node:crypto';
import { executeSandboxedRecipe } from './recipes.js';
import Database from 'better-sqlite3';
import { UpdateExecution } from './update-worker.js';
import { readUpdateGrant } from './update-grants.js';
import { LocalHistory } from '../../server/src/projects/history.js';
import { HistoryProvider } from './history-provider.js';

export const executionSchema = z.strictObject({
  commandId: z.uuid(), taskId: z.uuid(), projectId: z.uuid(), scopeRevisionId: z.uuid(), providerId: z.string(), root: z.string(),
  operations: z.array(operationSchema).min(1), prompt: z.string().min(1).max(65536).refine(text => Buffer.byteLength(text) <= 65536),
  limits: z.strictObject({ turns: z.number().int().min(1).max(128), runMinutes: z.number().min(1).max(180), spendUsd: z.number().positive().optional() }),
  resumeSessionId: z.string().optional(),
  workerContext: z.strictObject({ runId: z.uuid(), phaseId: z.uuid(), artifacts: z.array(artifactSchema.shape.path).max(100) }).optional(),
});
export type Execution = z.infer<typeof executionSchema>;
type OwnedRun = { ref: RunRef; adapter: Adapter; providerId: string; taskId: string; commandId: string; execution: Execution; state: string; collecting: Promise<void>; collectingStarted: boolean };
export class Broker {
  readonly journal: ReceiptJournal; private log: BrokerEvents; private runs = new Map<string, OwnedRun>(); private adapters = new Map<string, Adapter>(); private discoveries = new Map<string, SessionDiscovery>();
  private roots = new Map<string, string>();
  private modelActive = 0;
  private closing = false;
  private ownedOperations = new Set<Promise<unknown>>();
  private async own<T>(action: () => Promise<T>): Promise<T> { if (this.closing) throw new DomainError('broker_closing'); const work = action(); this.ownedOperations.add(work); try { return await work; } finally { this.ownedOperations.delete(work); } }
  activeOperations() { return this.roots.size + this.historyJobs.size + this.ownedOperations.size + this.updateWorker.activity().filter(run => run.state === 'reconciling').length; }
  private updateWorker: UpdateExecution;
  private updatePending = new Set<Promise<void>>();
  private workspaces?: WorkspaceManager;
  private savedHistory: LocalHistory;
  private historyProvider: HistoryProvider;
  private historyJobs = new Map<string, { runId: string | undefined; cancel: AbortController; work: Promise<void> }>();
  constructor(readonly root: string, readonly config: Config, private options: { testMode?: boolean; fixtureDelayMs?: number; liveCertification?: boolean } = {}) {
    if (existsSync(join(root, 'state/recovery-fence.json'))) throw new DomainError('installation_retired_for_restore');
    if (options.testMode) assertTestRoot(root); else validateDataRoot(root, config.projects.map(p => p.root));
    if (options.liveCertification && (!options.testMode || process.env.CESTON_LIVE_TESTS !== '1')) throw new DomainError('live_test_scope_required');
    this.journal = new ReceiptJournal(join(root, 'state', 'broker-receipts.jsonl')); this.log = new BrokerEvents(join(root, 'state', 'broker-events.jsonl'));
    const testRoot = options.testMode ? root : undefined;
    this.savedHistory = new LocalHistory(config.history, testRoot);
    this.historyProvider = new HistoryProvider(config.history, testRoot);
    this.updateWorker = new UpdateExecution(root, config);
    const latest = new Map(this.journal.list().map(r => [r.commandId, r]));
    for (const receipt of latest.values()) if (receipt.state !== 'resolved' && receipt.context?.root) this.roots.set(receipt.commandId, receipt.context.root);
  }
  workspace(projectId: string, taskId: string, scopeRevisionId: string) {
    const project = this.config.projects.find(p => p.id === projectId); if (!project) throw new DomainError('project_not_found', 404);
    if (this.options.testMode) return { root: canonicalPath(project.root), sourceHash: 'synthetic-owned-test-root' };
    this.workspaces ??= new WorkspaceManager(this.root, installationSecrets(this.root).session);
    const prepared = this.workspaces.prepare(project, taskId, scopeRevisionId); return { root: prepared.root, sourceHash: prepared.sourceHash };
  }
  private adapter(execution: Execution): Adapter {
    const profile = this.config.providers.find(p => p.id === execution.providerId);
    if (profile && profile.kind !== 'fixture' && profile.billingMode === 'unknown') throw new DomainError('billing_mode_required', 422);
    if (profile?.kind === 'codex' && profile.billingMode === 'metered') throw new DomainError('codex_monetary_cap_unavailable', 422);
    const project = this.config.projects.find(p => p.id === execution.projectId);
    if (!profile || !project) throw new DomainError('provider_unavailable', 503);
    if (profile.kind !== 'fixture' && (profile.profile !== 'constrained' || !profile.home || (!this.options.liveCertification && !certificationValid(this.root, profile)))) throw new DomainError('uncertified_provider_profile', 422);
    const key = profile.kind === 'codex' ? profile.id : `${profile.id}:${project.id}:${execution.scopeRevisionId}`;
    const existing = this.adapters.get(key); if (existing) return existing;
    let adapter: Adapter;
    if (profile.kind === 'fixture') {
      if (!this.options.testMode) throw new DomainError('fixture_denied', 403);
      adapter = new FixtureAdapter({ delayMs: this.options.fixtureDelayMs ?? 0, artifactWriter: (request, path) => {
        const target = safePath(request.workspace, path); const policy = new ToolPolicy(request.workspace, request.operations ?? ['read'], project.recipes);
        if (!policy.check('Write', { file_path: target }).allowed) throw new DomainError('fixture_scope_denied', 403);
        mkdirSync(dirname(target), { recursive: true });
        const content = `Synthetic cestOn fixture artifact for ${request.taskId}.\n`;
        writeFileSync(target, content); return { path, sha256: createHash('sha256').update(content).digest('hex') };
      } });
    } else {
      const certified = this.options.liveCertification === true || certificationValid(this.root, profile);
      if (profile.profile !== 'constrained' || !certified || !profile.home) throw new DomainError('uncertified_provider_profile', 422);
      if (profile.kind === 'codex') {
        for (const path of [join(profile.home, 'config.toml'), join(project.root, '.codex', 'config.toml')]) if (existsSync(path) && /^\s*sandbox_mode\s*=/m.test(readFileSync(path, 'utf8'))) throw new DomainError('legacy_sandbox_profile_conflict', 422);
      }
      const env = childEnvironment(process.env, profile.billingMode === 'metered' ? [profile.kind === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'] : []);
      if (profile.home) env[profile.kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = profile.home;
      if (profile.kind === 'codex') adapter = new CodexAdapter({ command: profile.executable.endsWith('.js') ? process.execPath : profile.executable, args: [...(profile.executable.endsWith('.js') ? [profile.executable] : []), 'app-server'], cwd: execution.root, env }, { version: profile.version, certified, ...(profile.model ? { model: profile.model } : {}), readOnly: !execution.operations.includes('edit') });
      else if (profile.kind === 'claude') {
        const policy = new ToolPolicy(execution.root, execution.operations, project.recipes);
        adapter = new ClaudeAdapter({ executable: profile.executable, version: profile.version, workspace: execution.root, env, certified, billingMode: profile.billingMode, check: (name, input) => policy.check(name, input), ...(profile.model ? { model: profile.model } : {}) });
      } else throw new DomainError('batch_profile_uncertified', 422);
    }
    this.adapters.set(key, adapter); return adapter;
  }
  async start(input: unknown) { return this.own(() => this.startOwned(input)); }
  replyState(runId: string) {
    const run = this.runs.get(runId);
    if (!run || run.state !== 'succeeded' || !run.execution.operations.includes('read')) return 'unavailable' as const;
    const profile = this.config.providers.find(value => value.id === run.providerId);
    if (!profile || !(profile.kind === 'fixture' ? this.options.testMode : profile.billingMode === 'subscription' && certificationValid(this.root, profile))) return 'unavailable' as const;
    if ([...this.runs.values()].some(other => other.ref.sessionId === run.ref.sessionId && other.adapter === run.adapter && !['succeeded', 'failed', 'interrupted'].includes(other.state))) return 'working' as const;
    return 'ready' as const;
  }
  async reply(runId: string, commandId: string, prompt: string) {
    const state = this.replyState(runId);
    if (state !== 'ready') throw new DomainError(state === 'working' ? 'conversation_busy' : 'conversation_unavailable');
    const prior = this.runs.get(runId)!;
    const { taskId, projectId, scopeRevisionId, providerId, root, limits } = prior.execution;
    return this.start({ commandId, taskId, projectId, scopeRevisionId, providerId, root, prompt,
      operations: ['read'], resumeSessionId: prior.ref.sessionId,
      limits: { turns: Math.min(limits.turns, 4), runMinutes: Math.min(limits.runMinutes, 5) } });
  }
  async historyReplyState(id: string) {
    const target = await this.savedHistory.target(id);
    if (!this.historyProvider.configured(target.provider)) return 'unavailable' as const;
    if (this.historyJobs.has(id)) return 'working' as const;
    const recent = [...new Map(this.journal.list().map(row => [row.commandId,row])).values()];
    if (recent.some(row => row.context?.historyId === id && (row.state !== 'resolved' || row.result?.state === 'reconciling'))) return 'working' as const;
    return 'ready' as const;
  }
  async historyReply(id: string, commandId: string, text: string) {
    return this.own(async () => {
      if (await this.historyReplyState(id) !== 'ready' || this.historyJobs.has(id)) throw new DomainError('conversation_unavailable');
      if (this.historyJobs.size >= this.config.limits.concurrency) throw new DomainError('concurrency_limit');
      const cancel = new AbortController();
      const job = { runId: undefined as string | undefined, cancel, work: Promise.resolve() };
      this.historyJobs.set(id, job);
      try {
        const target = await this.savedHistory.target(id);
        const send = await this.historyProvider.prepare(target);
        const ref = { runId: randomUUID(), sessionId: target.nativeId, turnId: '' };
        const receipt = await this.journal.dispatch(commandId, { id, text }, async () => ({ ref, historyId: id }), { historyId: id });
        const recorded = receipt.result.ref as RunRef;
        if (recorded.runId !== ref.runId) { this.historyJobs.delete(id); return { ref: recorded }; }
        job.runId = ref.runId;
        job.work = (async () => {
          try {
            const response = await send(text,cancel.signal);
            this.log.append(ref.runId,{key:ref.runId+':reply',sequence:1,type:'message.delta',data:{text:response}});
            this.journal.resolve(commandId,{...receipt.result,state:'succeeded'});
          } catch (error) {
            if (error instanceof DomainError && error.code === 'history_session_open') {
              this.journal.resolve(commandId,{...receipt.result,state:'failed',errorCode:error.code});
            } else this.journal.resolve(commandId,{...receipt.result,state:'reconciling'});
          } finally { this.historyJobs.delete(id); }
        })();
        return { ref };
      } catch (error) { this.historyJobs.delete(id); throw error; }
    });
  }
  private async startOwned(input: unknown) {
    const parsed = executionSchema.safeParse(input); if (!parsed.success) throw new DomainError('invalid_execution', 400);
    const execution = parsed.data; const project = this.config.projects.find(p => p.id === execution.projectId);
    if (!project || project.providerId !== execution.providerId || execution.operations.some(op => !project.operations.includes(op))) throw new DomainError('scope_denied', 403);
    if (this.options.testMode) { if (canonicalPath(project.root) !== canonicalPath(execution.root)) throw new DomainError('scope_denied', 403); }
    else { this.workspaces ??= new WorkspaceManager(this.root, installationSecrets(this.root).session); this.workspaces.validate(project, execution.taskId, execution.scopeRevisionId, execution.root); }
    if (this.options.testMode && !within(this.root, execution.root)) throw new DomainError('test_workspace_denied', 403);
    if (this.options.liveCertification && (execution.limits.turns > 4 || execution.limits.runMinutes > 5)) throw new DomainError('live_test_budget_denied', 403);
    if (execution.limits.turns > this.config.limits.turns || execution.limits.runMinutes > this.config.limits.runMinutes) throw new DomainError('budget_denied', 403);
    const profile = this.config.providers.find(p => p.id === execution.providerId);
    if (profile?.billingMode === 'metered' && (!execution.limits.spendUsd || !this.config.limits.spendUsd || execution.limits.spendUsd > this.config.limits.spendUsd)) throw new DomainError('spend_ceiling_required', 403);
    const adapter = this.adapter(execution);
    const probe = await adapter.probe();
    if (!probe.authenticated || !probe.capabilities.start) throw new DomainError('provider_authentication_required', 503);
    if (execution.resumeSessionId && !probe.capabilities.resumeExact) throw new DomainError('resume_unavailable', 422);
    if (profile && profile.kind !== 'fixture' && probe.capabilities.billingMode !== profile.billingMode) throw new DomainError('billing_mode_mismatch', 403);
    const capabilities = probe.capabilities;
    if (!this.journal.receipt(execution.commandId)) {
      for (const [commandId, root] of this.roots) if (commandId !== execution.commandId && (within(root, execution.root) || within(execution.root, root))) throw new DomainError('resource_busy');
      if (!this.roots.has(execution.commandId) && this.roots.size + this.modelActive + this.updateWorker.activity().filter(run => run.state === 'reconciling').length >= this.config.limits.concurrency) throw new DomainError('concurrency_limit');
      this.roots.set(execution.commandId, canonicalPath(execution.root));
    }
    const receipt = await this.journal.dispatch(execution.commandId, execution, async () => {
      const request: RunRequest = { commandId: execution.commandId, taskId: execution.taskId, workspace: execution.root, prompt: execution.prompt, operations: execution.operations, limits: execution.limits, ...(execution.workerContext ? { workerContext: execution.workerContext, outputSchema: workerCompletionSchema.toJSONSchema() } : {}) };
      const ref = execution.resumeSessionId ? await adapter.resume(execution.resumeSessionId, request) : await adapter.start(request);
      const owned: OwnedRun = { ref, adapter, providerId: execution.providerId, taskId: execution.taskId, commandId: execution.commandId, execution, state: 'running', collecting: Promise.resolve(), collectingStarted: false };
      this.runs.set(ref.runId, owned);
      return { ref, providerId: execution.providerId, taskId: execution.taskId, capabilities };
    }, { root: canonicalPath(execution.root), taskId: execution.taskId, projectId: execution.projectId });
    const owned = this.runs.get((receipt.result.ref as RunRef).runId);
    if (owned && !owned.collectingStarted) { owned.collectingStarted = true; owned.collecting = this.collect(owned); }
    return { sequence: receipt.sequence, ref: receipt.result.ref as RunRef, providerId: String(receipt.result.providerId), capabilities: receipt.result.capabilities };
  }
  private async collect(run: OwnedRun) {
    try {
      for await (const event of run.adapter.events(run.ref.runId)) this.log.append(run.ref.runId, event);
      run.state = (await run.adapter.reconcile(run.ref.runId)).state;
      if (['succeeded', 'failed', 'interrupted'].includes(run.state)) {
        const prior = this.journal.receipt(run.commandId)!;
        this.journal.resolve(run.commandId, { ...prior.result, state: run.state }); this.roots.delete(run.commandId);
      }
    }
    catch { run.state = 'reconciling'; }
  }
  lookup(commandId: string) {
    const receipt = this.journal.receipt(commandId);
    if (!receipt) return { status: 'absent' as const };
    if (receipt.state === 'prepared') return { status: 'uncertain' as const };
    return { status: 'accepted' as const, sequence: receipt.sequence, result: receipt.result! };
  }
  events(runId: string, after: number) { return this.log.read(runId, after); }
  async reconcile(runId: string) {
    if ([...this.historyJobs.values()].some(job => job.runId === runId)) return { state: 'running' };
    const run = this.runs.get(runId);
    if (run) {
      if (run.state === 'reconciling') return { state: 'reconciling' };
      const observed = await run.adapter.reconcile(runId);
      return { state: observed.state === 'succeeded' ? run.state : observed.state };
    }
    const receipt = this.journal.list().findLast(record => (record.result?.ref as RunRef | undefined)?.runId === runId);
    return { state: receipt?.state === 'resolved' && typeof receipt.result?.state === 'string' ? receipt.result.state : 'needs_attention' };
  }
  async steer(runId: string, text: string, turnId: string) { const run = this.runs.get(runId); if (!run || run.ref.turnId !== turnId) throw new DomainError('stale_run'); return run.adapter.enqueue(run.ref, text); }
  async interrupt(runId: string) {
    const run = this.runs.get(runId); if (!run) throw new DomainError('unmanaged_run');
    await run.adapter.interrupt(run.ref);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const state = (await run.adapter.reconcile(runId)).state; if (['interrupted', 'succeeded', 'failed'].includes(state)) return { acknowledged: true, state }; await delay(50); }
    return { acknowledged: false, state: 'stop_pending' };
  }
  async probes() { return Promise.all([...this.adapters.entries()].map(async ([id, adapter]) => ({ id, ...(await adapter.probe()) }))); }
  async profileProbe(providerId: string) { return this.own(() => this.profileProbeOwned(providerId)); }
  private async profileProbeOwned(providerId: string) {
    const profile = this.config.providers.find(provider => provider.id === providerId); if (!profile) throw new DomainError('provider_not_found');
    if (profile.kind === 'fixture' && this.options.testMode) return { authenticated: true, billingMode: 'unknown', fixture: true, modelTurns: 0 };
    if (!['codex', 'claude'].includes(profile.kind) || !profile.home) throw new DomainError('profile_probe_unavailable');
    const workspace = join(this.root, 'staging/probe-workspace'); mkdirSync(workspace, { recursive: true }); const environment = childEnvironment(process.env, profile.kind === 'claude' && profile.billingMode === 'metered' ? ['ANTHROPIC_API_KEY'] : []); environment[profile.kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = profile.home;
    const adapter = profile.kind === 'codex' ? new CodexAdapter({ command: profile.executable, args: ['app-server'], cwd: workspace, env: environment }, { version: profile.version, certified: false, readOnly: true }) : new ClaudeAdapter({ executable: profile.executable, version: profile.version, workspace, env: environment, certified: false, billingMode: profile.billingMode, tools: [], check: () => ({ allowed: false, reason: 'Authentication probe has no tool authority' }) });
    try { const observed = await adapter.probe(); return { authenticated: observed.authenticated, billingMode: observed.capabilities.billingMode, fixture: false, modelTurns: 0 }; } finally { await adapter.close(); }
  }
  prune() { const db = new Database(join(this.root, 'state/ceston.sqlite'), { readonly: true }); try { const rows = db.prepare("SELECT usage_json FROM runs WHERE state IN ('succeeded','failed','interrupted') AND ended_at<? AND id NOT IN (SELECT run_id FROM leases)").all(Date.now() - 30 * 86400000) as { usage_json: string }[]; const acknowledged = new Map<string, number>(); for (const row of rows) { const value = JSON.parse(row.usage_json) as { providerRunId?: string; cursor?: number }; if (value.providerRunId && Number.isSafeInteger(value.cursor)) acknowledged.set(value.providerRunId, value.cursor!); } const events = this.log.prune(acknowledged); this.journal.compact(); return { events, receiptTombstones: 'preserved' }; } finally { db.close(); } }
  async recipe(runId: string, recipeId: string) { return this.own(() => this.recipeOwned(runId, recipeId)); }
  private async recipeOwned(runId: string, recipeId: string) {
    const run = this.runs.get(runId); if (!run) throw new DomainError('unmanaged_run');
    const project = this.config.projects.find(p => p.id === run.execution.projectId)!;
    const recipe = project.recipes.find(r => r.id === recipeId);
    if (!recipe || !run.execution.operations.includes(recipe.operation)) throw new DomainError('recipe_scope_denied', 403);
    const key = `${run.commandId}:recipe:${recipeId}`;
    const result = await this.journal.dispatch(key, { runId, recipeId }, async () => {
      if (this.options.testMode && this.config.providers.find(p => p.id === run.providerId)?.kind === 'fixture') {
        if (recipe.executable !== 'fixture:assert-artifact' || recipe.args.length !== 1) throw new DomainError('fixture_recipe_unregistered', 422);
        const content = readFileSync(safePath(project.root, recipe.args[0]!), 'utf8');
        return { exitCode: content.startsWith('Synthetic cestOn fixture artifact') ? 0 : 1, outputHash: createHash('sha256').update(content).digest('hex') };
      }
      return executeSandboxedRecipe(this.root, this.config, recipe, run.execution.root);
    }, { root: canonicalPath(run.execution.root), taskId: run.taskId, projectId: project.id });
    this.journal.resolve(key, result.result);
    return result.result as { exitCode: number; outputHash: string };
  }
  async infer(providerId: string, kind: 'plan' | 'intent', prompt: string) { return this.own(() => this.inferOwned(providerId, kind, prompt)); }
  private async inferOwned(providerId: string, kind: 'plan' | 'intent', prompt: string) {
    const profile = this.config.providers.find(p => p.id === providerId);
    if (!profile || !profile.home || !['codex', 'claude'].includes(profile.kind) || profile.profile !== 'constrained' || !certificationValid(this.root, profile)) throw new DomainError('model_profile_uncertified', 422);
    if (this.roots.size + this.modelActive + this.updateWorker.activity().filter(run => run.state === 'reconciling').length >= this.config.limits.concurrency) throw new DomainError('model_capacity_unavailable', 503);
    if (profile.billingMode === 'unknown') throw new DomainError('billing_mode_required', 422);
    if (profile.kind === 'codex' && profile.billingMode === 'metered') throw new DomainError('codex_monetary_cap_unavailable', 422);
    if (profile.billingMode === 'metered' && !this.config.limits.spendUsd) throw new DomainError('spend_ceiling_required', 403);
    this.modelActive++;
    const workspace = join(this.root, 'staging', 'model-workspace'); mkdirSync(workspace, { recursive: true });
    const env = childEnvironment(process.env, profile.billingMode === 'metered' ? [profile.kind === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'] : []);
    env[profile.kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = profile.home;
    const adapter = profile.kind === 'codex' ? new CodexAdapter({ command: profile.executable.endsWith('.js') ? process.execPath : profile.executable, args: [...(profile.executable.endsWith('.js') ? [profile.executable] : []), 'app-server'], cwd: workspace, env }, { version: profile.version, certified: true, readOnly: true, ...(profile.model ? { model: profile.model } : {}) }) : new ClaudeAdapter({ executable: profile.executable, version: profile.version, workspace, env, certified: true, billingMode: profile.billingMode, tools: [], check: () => ({ allowed: false, reason: 'Interpretation has no tool authority' }), ...(profile.model ? { model: profile.model } : {}) });
    try {
      const probe = await adapter.probe(); if (!probe.authenticated || probe.capabilities.billingMode !== profile.billingMode) throw new DomainError('model_authentication_or_billing_mismatch', 503);
      const ref = await adapter.start({ commandId: randomUUID(), taskId: randomUUID(), workspace, prompt, operations: ['read'], limits: { turns: kind === 'plan' ? 2 : 1, runMinutes: 1, ...(this.config.limits.spendUsd ? { spendUsd: this.config.limits.spendUsd } : {}) }, outputSchema: (kind === 'plan' ? planSchema : intentSchema).toJSONSchema() });
      let text = ''; let result: unknown;
      const timer = setTimeout(() => { void adapter.interrupt(ref); }, 60000);
      try {
        for await (const event of adapter.events(ref.runId)) {
          if (event.type === 'message.delta' && typeof event.data.text === 'string') text = (text + event.data.text).slice(-32768);
          if (event.type === 'turn.completed') result = event.data.result;
        }
      } finally { clearTimeout(timer); }
      if ((await adapter.reconcile(ref.runId)).state !== 'succeeded') throw new DomainError('model_run_unverified', 503);
      const value = result ?? text; return typeof value === 'string' ? JSON.parse(value) as unknown : value;
    } finally { this.modelActive--; await adapter.close(); }
  }
  async updateEdit(grantId: string) { return this.own(() => this.updateEditOwned(grantId)); }
  private async updateEditOwned(grantId: string) {
    const grant = readUpdateGrant(this.root, grantId);
    if (this.roots.size + this.modelActive + this.updateWorker.activity().filter(run => run.state === 'reconciling').length >= this.config.limits.concurrency) throw new DomainError('model_capacity_unavailable', 503);
    // Reserve synchronously before provider probes can yield to an ordinary dispatch.
    this.modelActive++;
    const job = this.updateWorker.edit(grant.workspace, grant.request, grant.stage, grant.regression); this.updatePending.add(job);
    try { await job; return { completed: true }; } finally { this.modelActive--; this.updatePending.delete(job); }
  }
  sessions() { return [...this.updateWorker.activity(), ...[...this.runs.values()].map(r => ({ sessionId: r.ref.sessionId, runId: r.ref.runId, providerId: r.providerId, taskId: r.taskId, state: r.state, ownership: 'managed' }))]; }
  private discovery(providerId: string) {
    const profile = this.config.providers.find(p => p.id === providerId); if (!profile?.home) throw new DomainError('provider_home_unconfigured', 422);
    let discovery = this.discoveries.get(providerId);
    if (!discovery) { discovery = new SessionDiscovery(providerId, profile.home, this.config.projects.filter(p => p.providerId === providerId).map(p => ({ id: p.id, root: p.root }))); this.discoveries.set(providerId, discovery); }
    return discovery;
  }
  discover(providerId: string, cursor?: string) { return this.discovery(providerId).scan(cursor); }
  history(providerId: string, id: string, after = 0) { return this.discovery(providerId).history(id, after); }
  async close() {
    this.closing = true; await Promise.allSettled([...this.ownedOperations]);
    const historyJobs = [...this.historyJobs.values()];
    for (const job of historyJobs) job.cancel.abort();
    await Promise.allSettled(historyJobs.map(job => job.work));
    await Promise.allSettled([...this.updatePending]);
    for (const run of this.runs.values()) if (['running', 'starting'].includes((await run.adapter.reconcile(run.ref.runId)).state)) await this.interrupt(run.ref.runId);
    await Promise.all([...this.runs.values()].map(r => r.collecting));
    for (const adapter of this.adapters.values()) if ('close' in adapter) await (adapter as Adapter & { close(): Promise<void> }).close();
    for (const discovery of this.discoveries.values()) discovery.close();
  }
}
