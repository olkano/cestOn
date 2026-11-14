import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { CapabilityError } from './types.js';

export type ProcessSpec = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
export class RpcProcess extends EventEmitter {
  readonly child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
  private sequence = 0; private raw = ''; private dead = false;
  onRequest: (method: string, params: Record<string, unknown>) => Promise<unknown> = async () => { throw new CapabilityError('unsupported_provider_request'); };
  constructor(spec: ProcessSpec) {
    super();
    this.child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdin.on('error', () => this.fail(new CapabilityError('provider_pipe_lost')));
    this.child.stdout.on('data', (text: string) => {
      this.raw += text;
      if (Buffer.byteLength(this.raw) > 1048576) { this.abortProtocol('provider_message_too_large'); return; }
      let index: number;
      while ((index = this.raw.indexOf('\n')) !== -1) {
        const line = this.raw.slice(0, index); this.raw = this.raw.slice(index + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line) as RpcMessage); } catch { this.abortProtocol('provider_protocol_error'); return; }
      }
    });
    this.child.stderr.on('data', () => { /* Raw provider stderr never enters logs. Exit/error classification is retained. */ });
    this.child.once('error', () => this.fail(new CapabilityError('provider_process_unavailable')));
    this.child.once('exit', () => { this.dead = true; this.fail(new CapabilityError('provider_process_lost')); this.emit('lost'); });
  }
  private fail(error: Error) { for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(error); } this.pending.clear(); }
  private abortProtocol(code: string) { this.dead = true; this.fail(new CapabilityError(code)); this.emit('lost'); this.child.kill(); }
  private receive(message: RpcMessage) {
    if (message.id !== undefined && message.method) {
      void this.onRequest(message.method, message.params ?? {}).then(result => this.send({ id: message.id, result }), () => this.send({ id: message.id, error: { code: -32601, message: 'Unsupported or denied provider operation' } }));
    } else if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timeout); this.pending.delete(message.id);
      if (message.error) pending.reject(new CapabilityError('provider_rpc_rejected')); else pending.resolve(message.result);
    } else if (message.method) this.emit('notification', message.method, message.params ?? {});
  }
  private send(message: unknown) { if (this.dead || this.child.stdin.destroyed) return; this.child.stdin.write(`${JSON.stringify(message)}\n`); }
  async request<T = Record<string, unknown>>(method: string, params: unknown, timeoutMs = 10000): Promise<T> {
    if (this.dead) throw new CapabilityError('provider_process_lost');
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new CapabilityError('provider_rpc_timeout')); }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timeout }); this.send({ id, method, params });
    });
  }
  notify(method: string, params: unknown = {}) { this.send({ method, params }); }
  async close() { if (this.child.exitCode !== null || this.child.signalCode !== null) return; const exit = new Promise<void>(resolve => this.child.once('exit', () => resolve())); this.child.stdin.end(); const timeout = setTimeout(() => this.child.kill(), 2000); await exit; clearTimeout(timeout); }
}
