import { join } from 'node:path';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { ReceiptJournal } from './journal.js';
import { BrokerEvents } from './events.js';
import { ToolPolicy, childEnvironment } from './policy/index.js';
import { certificationValid } from './certification.js';
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

export const executionSchema = z.strictObject({
  commandId: z.uuid(), taskId: z.uuid(), projectId: z.uuid(), scopeRevisionId: z.uuid(), providerId: z.string(), root: z.string(),
  operations: z.array(operationSchema).min(1), prompt: z.string().min(1).max(32768),
  limits: z.strictObject({ turns: z.number().int().min(1).max(128), runMinutes: z.number().min(1).max(180), spendUsd: z.number().positive().optional() }),
  resumeSessionId: z.string().optional(),
});
export type Execution = z.infer<typeof executionSchema>;
type OwnedRun = { ref: RunRef; adapter: Adapter; providerId: string; taskId: string; commandId: string; state: string; collecting: Promise<void>; collectingStarted: boolean };
export class Broker {
  readonly journal: ReceiptJournal; private log: BrokerEvents; private runs = new Map<string, OwnedRun>(); private adapters = new Map<string, Adapter>(); private discoveries = new Map<string, SessionDiscovery>();
  private roots = new Map<string, string>();
  constructor(readonly root: string, readonly config: Config, private options: { testMode?: boolean; fixtureDelayMs?: number; liveCertification?: boolean } = {}) {
    if (options.testMode) assertTestRoot(root); else validateDataRoot(root, config.projects.map(p => p.root));
    if (options.liveCertification && (!options.testMode || process.env.CESTON_LIVE_TESTS !== '1')) throw new DomainError('live_test_scope_required');
    this.journal = new ReceiptJournal(join(root, 'state', 'broker-receipts.jsonl')); this.log = new BrokerEvents(join(root, 'state', 'broker-events.jsonl'));
    const latest = new Map(this.journal.list().map(r => [r.commandId, r]));
    for (const receipt of latest.values()) if (receipt.state !== 'resolved' && receipt.context?.root) this.roots.set(receipt.commandId, receipt.context.root);
  }
  private adapter(execution: Execution): Adapter {
    const profile = this.config.providers.find(p => p.id === execution.providerId);
    const project = this.config.projects.find(p => p.id === execution.projectId);
    if (!profile || !project) throw new DomainError('provider_unavailable', 503);
    const key = profile.kind === 'codex' ? profile.id : `${profile.id}:${project.id}:${execution.scopeRevisionId}`;
    const existing = this.adapters.get(key); if (existing) return existing;
    let adapter: Adapter;
    if (profile.kind === 'fixture') {
      if (!this.options.testMode) throw new DomainError('fixture_denied', 403);
      adapter = new FixtureAdapter({ delayMs: this.options.fixtureDelayMs ?? 0 });
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
  async start(input: unknown) {
    const parsed = executionSchema.safeParse(input); if (!parsed.success) throw new DomainError('invalid_execution', 400);
    const execution = parsed.data; const project = this.config.projects.find(p => p.id === execution.projectId);
    if (!project || project.providerId !== execution.providerId || canonicalPath(project.root) !== canonicalPath(execution.root) || execution.operations.some(op => !project.operations.includes(op))) throw new DomainError('scope_denied', 403);
    if (this.options.testMode && !within(this.root, execution.root)) throw new DomainError('test_workspace_denied', 403);
    if (this.options.liveCertification && (execution.limits.turns > 4 || execution.limits.runMinutes > 5)) throw new DomainError('live_test_budget_denied', 403);
    if (execution.limits.turns > this.config.limits.turns || execution.limits.runMinutes > this.config.limits.runMinutes) throw new DomainError('budget_denied', 403);
    const profile = this.config.providers.find(p => p.id === execution.providerId);
    if (profile?.billingMode === 'metered' && (!execution.limits.spendUsd || !this.config.limits.spendUsd || execution.limits.spendUsd > this.config.limits.spendUsd)) throw new DomainError('spend_ceiling_required', 403);
    const adapter = this.adapter(execution);
    if (!this.journal.receipt(execution.commandId)) {
      for (const [commandId, root] of this.roots) if (commandId !== execution.commandId && (within(root, execution.root) || within(execution.root, root))) throw new DomainError('resource_busy');
      if (!this.roots.has(execution.commandId) && this.roots.size >= this.config.limits.concurrency) throw new DomainError('concurrency_limit');
      this.roots.set(execution.commandId, canonicalPath(execution.root));
    }
    const receipt = await this.journal.dispatch(execution.commandId, execution, async () => {
      const request: RunRequest = { commandId: execution.commandId, taskId: execution.taskId, workspace: execution.root, prompt: execution.prompt, operations: execution.operations, limits: execution.limits };
      const ref = execution.resumeSessionId ? await adapter.resume(execution.resumeSessionId, request) : await adapter.start(request);
      const owned: OwnedRun = { ref, adapter, providerId: execution.providerId, taskId: execution.taskId, commandId: execution.commandId, state: 'running', collecting: Promise.resolve(), collectingStarted: false };
      this.runs.set(ref.runId, owned);
      return { ref, providerId: execution.providerId, taskId: execution.taskId };
    }, { root: canonicalPath(execution.root), taskId: execution.taskId, projectId: execution.projectId });
    const owned = this.runs.get((receipt.result.ref as RunRef).runId);
    if (owned && !owned.collectingStarted) { owned.collectingStarted = true; owned.collecting = this.collect(owned); }
    return { sequence: receipt.sequence, ref: receipt.result.ref as RunRef, providerId: String(receipt.result.providerId) };
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
  async reconcile(runId: string) { const run = this.runs.get(runId); return run ? { state: run.state === 'reconciling' ? 'reconciling' : (await run.adapter.reconcile(runId)).state } : { state: 'needs_attention' }; }
  async steer(runId: string, text: string, turnId: string) { const run = this.runs.get(runId); if (!run || run.ref.turnId !== turnId) throw new DomainError('stale_run'); return run.adapter.enqueue(run.ref, text); }
  async interrupt(runId: string) {
    const run = this.runs.get(runId); if (!run) throw new DomainError('unmanaged_run');
    await run.adapter.interrupt(run.ref);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const state = (await run.adapter.reconcile(runId)).state; if (['interrupted', 'succeeded', 'failed'].includes(state)) return { acknowledged: true, state }; await delay(50); }
    return { acknowledged: false, state: 'stop_pending' };
  }
  async probes() { return Promise.all([...this.adapters.entries()].map(async ([id, adapter]) => ({ id, ...(await adapter.probe()) }))); }
  sessions() { return [...this.runs.values()].map(r => ({ sessionId: r.ref.sessionId, runId: r.ref.runId, providerId: r.providerId, taskId: r.taskId, state: r.state, ownership: 'managed' })); }
  private discovery(providerId: string) {
    const profile = this.config.providers.find(p => p.id === providerId); if (!profile?.home) throw new DomainError('provider_home_unconfigured', 422);
    let discovery = this.discoveries.get(providerId);
    if (!discovery) { discovery = new SessionDiscovery(providerId, profile.home, this.config.projects.filter(p => p.providerId === providerId).map(p => ({ id: p.id, root: p.root }))); this.discoveries.set(providerId, discovery); }
    return discovery;
  }
  discover(providerId: string, cursor?: string) { return this.discovery(providerId).scan(cursor); }
  history(providerId: string, id: string, after = 0) { return this.discovery(providerId).history(id, after); }
  async close() {
    for (const run of this.runs.values()) if (['running', 'starting'].includes((await run.adapter.reconcile(run.ref.runId)).state)) await this.interrupt(run.ref.runId);
    await Promise.all([...this.runs.values()].map(r => r.collecting));
    for (const adapter of this.adapters.values()) if ('close' in adapter) await (adapter as Adapter & { close(): Promise<void> }).close();
    for (const discovery of this.discoveries.values()) discovery.close();
  }
}
