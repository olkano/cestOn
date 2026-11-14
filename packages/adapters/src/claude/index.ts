import { query, getSessionMessages, type Query, type Options, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { AsyncQueue } from '../queue.js';
import { CapabilityError, type Adapter, type RunRequest, type RunRef, type ProviderEvent, type Capabilities } from '../types.js';
import { sanitizeValue } from '../../../contracts/src/logging.js';

type PermissionCheck = (name: string, input: Record<string, unknown>) => { allowed: boolean; reason: string };
type ManagedRun = { ref: RunRef; query: Query; queue: AsyncQueue<ProviderEvent>; state: string; sequence: number; cancelRequested: boolean; timer: NodeJS.Timeout };
export type ClaudeOptions = {
  executable: string; version: string; workspace: string; env: NodeJS.ProcessEnv; model?: string;
  certified: boolean; billingMode: 'subscription' | 'metered' | 'unknown'; check: PermissionCheck;
  queryFactory?: (params: { prompt: string; options: Options }) => Query;
  tools?: string[];
};
export class ClaudeAdapter implements Adapter {
  private runs = new Map<string, ManagedRun>(); private keys = new Map<string, Promise<RunRef>>();
  constructor(private options: ClaudeOptions) {}
  async probe() {
    let authenticated = false;
    try { const result = await promisify(execFile)(this.options.executable, ['auth', 'status', '--json'], { cwd: this.options.workspace, env: this.options.env, timeout: 5000, windowsHide: true, maxBuffer: 65536 }); const auth = JSON.parse(result.stdout) as { loggedIn?: boolean }; authenticated = auth.loggedIn === true; } catch { /* Availability is an explicit gate, not a guessed login. */ }
    const certified = this.options.certified && this.options.version === '2.1.317';
    return { version: this.options.version, transport: 'agent-sdk-0.3.325', authenticated, verifiedAt: new Date().toISOString(), capabilities: { discover: true, readHistory: true, start: certified, resumeExact: certified, steerActive: false, interruptOwned: true, toolApproval: true, usage: true, structuredResult: true, sandbox: certified, reattachOwned: false, billingMode: this.options.billingMode } satisfies Capabilities };
  }
  async listSessions() { return { sessions: [...this.runs.values()].map(r => ({ id: r.ref.sessionId, title: 'Managed Claude session', state: r.state })) }; }
  async readHistory(sessionId: string, cursor?: string) {
    if (![...this.runs.values()].some(r => r.ref.sessionId === sessionId)) throw new CapabilityError('unmanaged_session');
    const offset = Math.max(0, Math.min(1000000, Number(cursor ?? 0)));
    const messages = await getSessionMessages(sessionId, { dir: this.options.workspace, limit: 30, offset });
    return { events: messages.map((m, sequence) => ({ key: `${sessionId}:${offset + sequence}`, sequence: offset + sequence, type: 'message.delta' as const, data: sanitizeValue({ excerpt: JSON.stringify(m).slice(0, 32768) }) as Record<string, unknown> })), ...(messages.length === 30 ? { cursor: String(offset + 30) } : {}) };
  }
  async start(request: RunRequest) { return this.begin(request); }
  async resume(sessionId: string, request: RunRequest) {
    const owned = [...this.runs.values()].filter(r => r.ref.sessionId === sessionId);
    if (!owned.length || owned.some(r => !['succeeded', 'interrupted', 'failed'].includes(r.state))) throw new CapabilityError('unmanaged_or_active_session');
    return this.begin(request, sessionId);
  }
  private async begin(request: RunRequest, sessionId?: string): Promise<RunRef> {
    const previous = this.keys.get(request.commandId); if (previous) return previous;
    if (!this.options.certified || this.options.version !== '2.1.317') throw new CapabilityError('uncertified_provider_profile');
    if (this.options.billingMode === 'metered' && !request.limits?.spendUsd) throw new CapabilityError('spend_ceiling_required');
    const start = this.startQuery(request, sessionId); this.keys.set(request.commandId, start); return start;
  }
  private async startQuery(request: RunRequest, sessionId?: string): Promise<RunRef> {
    const ref: RunRef = { runId: randomUUID(), sessionId: sessionId ?? '', turnId: randomUUID() };
    const permissions: { tool: string; allowed: boolean; reason: string }[] = [];
    const hook: HookCallback = async input => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const permission = this.options.check(input.tool_name, input.tool_input as Record<string, unknown>);
      permissions.push({ tool: input.tool_name, ...permission });
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: permission.allowed ? 'allow' : 'deny', permissionDecisionReason: permission.reason } };
    };
    const abort = new AbortController();
    const options: Options = {
      cwd: request.workspace, pathToClaudeCodeExecutable: this.options.executable, env: this.options.env,
      settingSources: [], skills: [], plugins: [], mcpServers: {}, tools: this.options.tools ?? ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
      permissionMode: 'default', allowedTools: [], disallowedTools: ['Bash', 'Agent', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit'],
      canUseTool: async (name, input) => { const permission = this.options.check(name, input); return permission.allowed ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: permission.reason }; },
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [hook], onFailure: 'block', timeout: 5 }] },
      maxTurns: request.limits?.turns ?? 32, abortController: abort,
      ...(sessionId ? { resume: sessionId } : {}), ...(this.options.model ? { model: this.options.model } : {}),
      ...(request.limits?.spendUsd ? { maxBudgetUsd: request.limits.spendUsd } : {}),
      ...(request.outputSchema ? { outputFormat: { type: 'json_schema' as const, schema: request.outputSchema } } : {}),
    };
    const q = (this.options.queryFactory ?? query)({ prompt: request.prompt, options });
    const timer = setTimeout(() => { abort.abort(); q.close(); }, (request.limits?.runMinutes ?? 45) * 60000);
    const run: ManagedRun = { ref, query: q, queue: new AsyncQueue(), state: 'starting', sequence: 0, cancelRequested: false, timer };
    this.runs.set(ref.runId, run);
    const started = new Promise<RunRef>((resolve, reject) => {
      const timeout = setTimeout(() => { abort.abort(); q.close(); reject(new CapabilityError('provider_start_timeout')); }, 30000);
      void (async () => {
        try {
          for await (const message of q) {
            for (const permission of permissions.splice(0)) this.emit(run, 'tool.requested', permission);
            const m = message as unknown as Record<string, unknown>;
            if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
              if (sessionId && m.session_id !== sessionId) throw new CapabilityError('wrong_session');
              ref.sessionId = m.session_id; run.state = 'running'; this.emit(run, 'session.created', { sessionId: ref.sessionId }); this.emit(run, 'turn.started', { turnId: ref.turnId }); clearTimeout(timeout); resolve(ref);
            } else if (m.type === 'assistant') this.emit(run, 'message.delta', { message: m.message });
            else if (m.type === 'tool_progress') this.emit(run, 'tool.started', { toolName: m.tool_name, toolUseId: m.tool_use_id });
            else if (m.type === 'result') {
              if (typeof m.session_id === 'string' && m.session_id !== ref.sessionId) throw new CapabilityError('wrong_session');
              this.emit(run, 'usage.updated', { usage: m.usage, costUsd: this.options.billingMode === 'metered' ? m.total_cost_usd : null });
              run.state = run.cancelRequested ? 'interrupted' : m.subtype === 'success' && m.is_error !== true ? 'succeeded' : 'failed';
              this.emit(run, run.state === 'succeeded' ? 'turn.completed' : 'provider.error', { status: run.state, result: m.structured_output ?? m.result });
            }
          }
          if (!['succeeded', 'failed', 'interrupted'].includes(run.state)) run.state = run.cancelRequested ? 'interrupted' : 'reconciling';
          if (!ref.sessionId) reject(new CapabilityError('provider_missing_session'));
        } catch { run.state = run.cancelRequested ? 'interrupted' : 'reconciling'; this.emit(run, 'provider.error', { code: 'provider_execution_interrupted' }); reject(new CapabilityError('provider_execution_interrupted')); }
        finally { for (const permission of permissions.splice(0)) this.emit(run, 'tool.requested', permission); clearTimeout(timeout); clearTimeout(timer); run.queue.end(); q.close(); }
      })();
    });
    return started;
  }
  private emit(run: ManagedRun, type: ProviderEvent['type'], data: Record<string, unknown>) { run.queue.push({ key: `${run.ref.runId}:${++run.sequence}`, sequence: run.sequence, type, data: sanitizeValue(data) as Record<string, unknown> }); }
  async enqueue(ref: RunRef, text: string): Promise<{ state: 'queued' }> { if (!text || !this.runs.has(ref.runId)) throw new CapabilityError('unmanaged_run'); throw new CapabilityError('queue_at_coordinator_turn_boundary'); }
  async interrupt(ref: RunRef) {
    const run = this.runs.get(ref.runId); if (!run || run.ref.sessionId !== ref.sessionId || run.ref.turnId !== ref.turnId) throw new CapabilityError('unmanaged_run');
    if (run.state === 'interrupted') return { acknowledged: true };
    run.cancelRequested = true; await run.query.interrupt(); run.query.close(); return { acknowledged: run.state === 'interrupted' };
  }
  async reconcile(runId: string) { return { state: this.runs.get(runId)?.state ?? 'unknown' }; }
  events(runId: string) { const run = this.runs.get(runId); if (!run) throw new CapabilityError('unknown_run'); return run.queue; }
  async close() { for (const run of this.runs.values()) { clearTimeout(run.timer); run.query.close(); run.queue.end(); } }
}
