import { randomUUID } from 'node:crypto';
import { RpcProcess, type ProcessSpec } from '../rpc.js';
import { AsyncQueue } from '../queue.js';
import { CapabilityError, type Adapter, type Capabilities, type ProviderEvent, type RunRef, type RunRequest } from '../types.js';
import { sanitizeValue } from '../../../contracts/src/logging.js';
import { permissionConfig } from './permissions.js';

type ManagedRun = { ref: RunRef; queue: AsyncQueue<ProviderEvent>; state: string; sequence: number; pending: { method: string; params: Record<string, unknown> }[] };
export class CodexAdapter implements Adapter {
  private rpc: RpcProcess | null = null; private connecting: Promise<RpcProcess> | null = null; private runs = new Map<string, ManagedRun>(); private commandKeys = new Map<string, RunRef>(); private starts = new Map<string, Promise<RunRef>>();
  constructor(private spec: ProcessSpec, private options: { version: string; model?: string; certified?: boolean; billingMode?: 'subscription' | 'metered' | 'unknown'; readOnly?: boolean } ) {}
  private async connection() { if (!this.connecting) this.connecting = this.openConnection(); return this.connecting; }
  private async openConnection() {
    const rpc = new RpcProcess(this.spec); this.rpc = rpc;
    rpc.onRequest = async (method, params) => {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(method)) {
        const run = [...this.runs.values()].find(run => run.ref.sessionId === params.threadId && (!params.turnId || !run.ref.turnId || run.ref.turnId === params.turnId));
        if (run) run.queue.push({ key: `${run.ref.runId}:${++run.sequence}`, sequence: run.sequence, type: 'tool.requested', data: { tool: method, allowed: false, reason: 'Approval is outside the immutable worker policy' } });
      }
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') return { decision: 'decline' };
      if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
      throw new CapabilityError('unsupported_provider_request');
    };
    rpc.on('notification', (method: string, params: Record<string, unknown>) => this.notification(method, params));
    rpc.on('lost', () => { for (const run of this.runs.values()) if (['starting', 'running', 'interrupting'].includes(run.state)) { run.state = 'reconciling'; run.queue.end(); } });
    try { await rpc.request('initialize', { clientInfo: { name: 'ceston', version: '0.1.0' }, capabilities: { experimentalApi: false } }); rpc.notify('initialized'); }
    catch (error) { await rpc.close(); this.rpc = null; throw error; }
    return rpc;
  }
  private notification(method: string, params: Record<string, unknown>) {
    const turn = params.turn as { id?: string; status?: string } | undefined;
    const turnId = method === 'turn/completed' ? turn?.id : params.turnId;
    const run = [...this.runs.values()].findLast(r => r.ref.sessionId === params.threadId && (r.state === 'starting' || (r.state === 'running' || r.state === 'interrupting') && (!turnId || r.ref.turnId === turnId)));
    if (!run) return;
    if (run.state === 'starting') { if (run.pending.length >= 100) { run.state = 'reconciling'; run.queue.end(); return; } run.pending.push({ method, params }); return; }
    let type: ProviderEvent['type'] | null = null; let data: Record<string, unknown> = {};
    if (method === 'item/agentMessage/delta') { type = 'message.delta'; data = { text: String(params.delta ?? '') }; }
    if (method === 'thread/tokenUsage/updated') { type = 'usage.updated'; data = params; }
    if (method === 'item/started') { type = 'tool.started'; data = { itemId: (params.item as Record<string, unknown> | undefined)?.id }; }
    if (method === 'item/completed') { type = 'tool.completed'; data = { itemId: (params.item as Record<string, unknown> | undefined)?.id }; }
    if (method === 'turn/completed') {
      if (!turn || turn.id !== run.ref.turnId) return;
      run.state = turn.status === 'completed' ? 'succeeded' : turn.status === 'interrupted' ? 'interrupted' : 'failed';
      type = turn.status === 'completed' ? 'turn.completed' : 'provider.error'; data = { status: run.state };
    }
    if (method === 'error') { type = 'provider.error'; data = { code: 'provider_error' }; }
    if (type) run.queue.push({ key: `${run.ref.runId}:${++run.sequence}`, sequence: run.sequence, type, data: sanitizeValue(data) as Record<string, unknown> });
    if (['succeeded', 'interrupted', 'failed'].includes(run.state)) run.queue.end();
  }
  async probe() {
    const rpc = await this.connection();
    const account = await rpc.request<{ account: { type: string } | null }>('account/read', { refreshToken: false });
    return { version: this.options.version, transport: 'owned-stdio', authenticated: !!account.account, verifiedAt: new Date().toISOString(), capabilities: { discover: true, readHistory: true, start: this.options.certified === true, resumeExact: this.options.certified === true, steerActive: this.options.certified === true, interruptOwned: true, toolApproval: true, usage: true, structuredResult: true, sandbox: this.options.certified === true, reattachOwned: false, billingMode: account.account?.type === 'apiKey' ? 'metered' : account.account?.type === 'chatgpt' ? 'subscription' : 'unknown' } satisfies Capabilities };
  }
  async listSessions(cursor?: string) { const response = await (await this.connection()).request<{ data: { id: string; name?: string; status?: { type: string } }[]; nextCursor?: string }>('thread/list', { cursor: cursor ?? null, limit: 100, cwd: this.spec.cwd, useStateDbOnly: true }); return { sessions: response.data.map(t => ({ id: t.id, title: t.name ?? 'Codex session', state: t.status?.type ?? 'unknown' })), ...(response.nextCursor ? { cursor: response.nextCursor } : {}) }; }
  async readHistory(sessionId: string, cursor?: string) {
    const response = await (await this.connection()).request<{ data: unknown[]; nextCursor?: string }>('thread/turns/list', { threadId: sessionId, cursor: cursor ?? null, limit: 30 });
    return { events: response.data.map((item, sequence) => ({ key: `${sessionId}:${sequence}:${cursor ?? ''}`, sequence, type: 'message.delta' as const, data: sanitizeValue({ excerpt: JSON.stringify(item).slice(0, 32768) }) as Record<string, unknown> })), ...(response.nextCursor ? { cursor: response.nextCursor } : {}) };
  }
  async start(request: RunRequest) { return this.once(request); }
  async resume(sessionId: string, request: RunRequest) {
    const owned = [...this.runs.values()].filter(r => r.ref.sessionId === sessionId);
    if (!owned.length || owned.some(r => !['succeeded', 'failed', 'interrupted'].includes(r.state))) throw new CapabilityError('unmanaged_or_active_session');
    return this.once(request, sessionId);
  }
  private async once(request: RunRequest, sessionId?: string) { const existing = this.starts.get(request.commandId); if (existing) return existing; const start = this.begin(request, sessionId); this.starts.set(request.commandId, start); return start; }
  private async begin(request: RunRequest, sessionId?: string): Promise<RunRef> {
    const previous = this.commandKeys.get(request.commandId); if (previous) return previous;
    if (this.options.version !== '0.160.0' || !this.options.certified) throw new CapabilityError('uncertified_provider_profile');
    const rpc = await this.connection();
    const readOnly = request.operations ? !request.operations.includes('edit') : this.options.readOnly;
    const thread = await rpc.request<{ thread: { id: string } }>(sessionId ? 'thread/resume' : 'thread/start', { ...(sessionId ? { threadId: sessionId, excludeTurns: true } : {}), cwd: request.workspace, approvalPolicy: 'untrusted', ...(this.options.model ? { model: this.options.model } : {}), config: permissionConfig(request.workspace, readOnly === true) });
    if (sessionId && thread.thread.id !== sessionId) throw new CapabilityError('wrong_session');
    const ref = { runId: randomUUID(), sessionId: thread.thread.id, turnId: '' }; const run: ManagedRun = { ref, queue: new AsyncQueue(), state: 'starting', sequence: 0, pending: [] };
    this.runs.set(ref.runId, run); this.commandKeys.set(request.commandId, ref);
    const response = await rpc.request<{ turn: { id: string } }>('turn/start', { threadId: ref.sessionId, input: [{ type: 'text', text: request.prompt, text_elements: [] }], approvalPolicy: 'untrusted', ...(request.outputSchema ? { outputSchema: request.outputSchema } : {}) });
    ref.turnId = response.turn.id; if (run.state !== 'reconciling') run.state = 'running';
    run.queue.push({ key: `${ref.runId}:${++run.sequence}`, sequence: run.sequence, type: 'session.created', data: { sessionId: ref.sessionId } });
    run.queue.push({ key: `${ref.runId}:${++run.sequence}`, sequence: run.sequence, type: 'turn.started', data: { turnId: ref.turnId } });
    for (const event of run.pending.splice(0)) this.notification(event.method, event.params);
    return ref;
  }
  async enqueue(ref: RunRef, text: string): Promise<{ state: 'accepted' }> {
    const run = this.runs.get(ref.runId); if (!run || run.state !== 'running' || run.ref.turnId !== ref.turnId || run.ref.sessionId !== ref.sessionId) throw new CapabilityError('stale_run');
    await (await this.connection()).request('turn/steer', { threadId: ref.sessionId, expectedTurnId: ref.turnId, input: [{ type: 'text', text, text_elements: [] }] }); return { state: 'accepted' };
  }
  async interrupt(ref: RunRef) { const run = this.runs.get(ref.runId); if (!run || run.ref.turnId !== ref.turnId || run.ref.sessionId !== ref.sessionId) throw new CapabilityError('unmanaged_run'); if (run.state === 'interrupted') return { acknowledged: true }; run.state = 'interrupting'; await (await this.connection()).request('turn/interrupt', { threadId: ref.sessionId, turnId: ref.turnId }); return { acknowledged: run.state === 'interrupted' }; }
  async reconcile(runId: string) { return { state: this.runs.get(runId)?.state ?? 'unknown' }; }
  events(runId: string) { const run = this.runs.get(runId); if (!run) throw new CapabilityError('unknown_run'); return run.queue; }
  async close() { await this.rpc?.close(); }
}
