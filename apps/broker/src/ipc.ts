import { createServer, createConnection, type Socket } from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { windowsHelperEnvironment } from './windows-environment.js';

const packetSchema = z.strictObject({ protocol: z.literal(1), requestId: z.uuid(), installationId: z.uuid(), token: z.string().max(128), method: z.string().min(1).max(80), payload: z.unknown() });
type Reply = { protocol: 1; requestId: string; data?: unknown; error?: { code: string } };
export type IpcOptions = { root: string; name: string; installationId: string; token: string };
function equal(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
export async function startIpcServer(options: IpcOptions, handler: (method: string, payload: unknown) => Promise<unknown>) {
  const name = `ceston-${options.installationId}-${options.name}`;
  if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(name)) throw new DomainError('ipc_name_invalid');
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(options.root, `${options.name}.sock`);
  async function respond(raw: string): Promise<Reply> {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return { protocol: 1, requestId: '', error: { code: 'ipc_denied' } }; }
    const parsed = packetSchema.safeParse(value);
    if (!parsed.success || parsed.data.installationId !== options.installationId || !equal(parsed.data.token, options.token)) return { protocol: 1, requestId: '', error: { code: 'ipc_denied' } };
    try { return { protocol: 1, requestId: parsed.data.requestId, data: await handler(parsed.data.method, parsed.data.payload) }; }
    catch (error) { return { protocol: 1, requestId: parsed.data.requestId, error: { code: error instanceof DomainError ? error.code : 'ipc_operation_failed' } }; }
  }
  if (process.platform === 'win32') {
    const host = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/windows-pipe-host.ps1'), '-PipeName', name], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: windowsHelperEnvironment() });
    let stderr = ''; host.stderr.on('data', b => { stderr += String(b).slice(0, 4000); });
    host.stdin.on('error', () => { /* Lost host leaves client operations unresolved; no write is retried. */ });
    const lines = createInterface({ input: host.stdout });
    try {
      await new Promise<void>((ready, reject) => {
        const timeout = setTimeout(() => reject(new Error(`IPC ACL startup failed: ${stderr}`)), 8000);
        host.once('error', error => { clearTimeout(timeout); reject(error); });
        host.once('exit', () => { clearTimeout(timeout); reject(new Error(`IPC ACL host exited: ${stderr}`)); });
        lines.on('line', (line: string) => {
          let message: { type: string; ownerOnly?: boolean; body?: string; bridgeId?: string };
          try { message = JSON.parse(line) as typeof message; } catch { clearTimeout(timeout); reject(new DomainError('ipc_host_protocol')); return; }
          if (message.type === 'ready') { clearTimeout(timeout); if (message.ownerOnly !== true) reject(new DomainError('ipc_acl_denied')); else ready(); }
          else if (message.type === 'request' && message.body && message.bridgeId) void respond(message.body).then(response => { if (!host.killed && !host.stdin.destroyed) host.stdin.write(`${JSON.stringify({ bridgeId: message.bridgeId, body: JSON.stringify(response) })}\n`); });
        });
      });
    } catch (error) { host.kill(); lines.close(); throw error; }
    return { endpoint, ownerOnly: true, async close() { if (host.exitCode === null && host.signalCode === null) { const exited = new Promise<void>(done => host.once('exit', () => done())); host.kill(); await exited; } lines.close(); } };
  }
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); let raw = ''; socket.setEncoding('utf8'); socket.setTimeout(5000, () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1048576) { socket.destroy(); return; }
      const newline = raw.indexOf('\n');
      if (newline >= 0) { socket.pause(); socket.setTimeout(0); void respond(raw.slice(0, newline)).then(response => socket.end(`${JSON.stringify(response)}\n`)); }
    });
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(endpoint, done); });
  chmodSync(endpoint, 0o600);
  return { endpoint, ownerOnly: true, async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); if (existsSync(endpoint)) unlinkSync(endpoint); } };
}
async function connectRequest(endpoint: string, packet: unknown, timeoutMs: number): Promise<Reply> {
  return new Promise((done, reject) => {
    const socket = createConnection(endpoint); let raw = ''; let connected = false;
    socket.setEncoding('utf8'); socket.setTimeout(timeoutMs, () => socket.destroy(new Error('ipc_timeout')));
    socket.once('error', error => reject(Object.assign(error, { beforeConnect: !connected }))); socket.once('connect', () => { connected = true; socket.write(`${JSON.stringify(packet)}\n`); });
    socket.on('data', (chunk: string) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1048576) { socket.destroy(new Error('ipc_response_too_large')); return; }
      if (raw.includes('\n')) { try { const parsed = JSON.parse(raw.slice(0, raw.indexOf('\n'))) as Reply; socket.destroy(); done(parsed); } catch { socket.destroy(new Error('ipc_response_invalid')); } }
    });
    socket.once('end', () => { if (!raw.includes('\n')) reject(new Error('ipc_disconnected')); });
  });
}
export async function ipcRequest(endpoint: string, packet: unknown, timeoutMs = 5000): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    try { return await connectRequest(endpoint, packet, timeoutMs); }
    catch (error) {
      const e = error as NodeJS.ErrnoException & { beforeConnect?: boolean };
      if (!e.beforeConnect || !['ENOENT', 'EBUSY'].includes(e.code ?? '') || attempt >= 40) throw error;
      // No bytes were sent. Recreating an owner-only Windows pipe briefly removes its name.
      await delay(20);
    }
  }
}
