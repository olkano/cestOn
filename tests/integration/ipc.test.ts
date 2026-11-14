import { it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { startIpcServer, ipcRequest } from '../../apps/broker/src/ipc.js';

it('T27 owner-restricted IPC rejects forged installation, version and token from a separate process', async () => {
  const t = createTestRoot(); const token = randomBytes(32).toString('hex');
  const server = await startIpcServer({ root: t.root, name: 'test', installationId: t.installationId, token }, async (method, payload) => ({ method, payload }));
  try {
    expect(server.ownerOnly).toBe(true);
    const request = { protocol: 1, requestId: randomUUID(), installationId: t.installationId, token, method: 'probe', payload: {} };
    expect((await ipcRequest(server.endpoint, request)).data).toEqual({ method: 'probe', payload: {} });
    const unicode = { label: 'Decisión ñ 漢字 🧪' };
    expect((await ipcRequest(server.endpoint, { ...request, payload: unicode })).data).toEqual({ method: 'probe', payload: unicode });
    for (const change of [{ token: 'wrong' }, { installationId: randomUUID() }, { protocol: 2 }]) expect((await ipcRequest(server.endpoint, { ...request, ...change })).error?.code).toBe('ipc_denied');
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tests/integration/fixtures/ipc-client.ts', server.endpoint, JSON.stringify({ ...request, token: 'forged' })], { timeout: 5000, windowsHide: true });
    expect(JSON.parse(child.stdout)).toEqual({ code: 'ipc_denied' });
  } finally { await server.close(); cleanupTestRoot(t.root, t.runId); }
});

it('T29 a long provider request cannot block receipt reconciliation on another connection', async () => {
  const t = createTestRoot(); const token = randomBytes(32).toString('hex'); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const server = await startIpcServer({ root: t.root, name: 'parallel', installationId: t.installationId, token }, async method => { if (method === 'slow') await gate; return { method }; });
  const packet = (method: string) => ({ protocol: 1, requestId: randomUUID(), installationId: t.installationId, token, method, payload: {} });
  const slow = ipcRequest(server.endpoint, packet('slow')); await new Promise(resolve => setTimeout(resolve, 30));
  const fast = ipcRequest(server.endpoint, packet('receipt')); let timer: NodeJS.Timeout | undefined;
  try {
    const response = await Promise.race([fast, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('receipt blocked by long request')), 500); })]);
    expect(response.data).toEqual({ method: 'receipt' });
  } finally { clearTimeout(timer); release(); await Promise.allSettled([slow, fast]); await server.close(); cleanupTestRoot(t.root, t.runId); }
});
