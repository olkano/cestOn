import { it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { CodexAdapter } from '../../packages/adapters/src/codex/index.js';

it('T09/T10 Codex handshake, duplicate starts, exact targeting and fast completion survive stdio batching', async () => {
  const t = createTestRoot(); const record = join(t.root, 'protocol.jsonl');
  const adapter = new CodexAdapter({ command: process.execPath, args: [resolve('tests/integration/fixtures/codex-rpc.mjs'), record], cwd: t.root, env: {} }, { version: '0.160.0', certified: true });
  try {
    const request = { commandId: 'one', taskId: 'task', prompt: 'synthetic artifact', workspace: t.root };
    const [a, b] = await Promise.all([adapter.start(request), adapter.start(request)]);
    expect(a).toEqual(b);
    const events = []; for await (const event of adapter.events(a.runId)) events.push(event);
    expect(events.some(e => e.type === 'turn.completed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('wrong target');
    const recorded = readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { method: string });
    expect(recorded.slice(0, 2).map(r => r.method)).toEqual(['initialize', 'initialized']);
    expect(recorded.filter(r => r.method === 'thread/start')).toHaveLength(1);
    const slow = await adapter.start({ ...request, commandId: 'two', prompt: 'slow synthetic' });
    await expect(adapter.enqueue({ ...slow, turnId: 'stale' }, 'wrong')).rejects.toThrow('stale_run');
    await adapter.interrupt(slow);
    for await (const _event of adapter.events(slow.runId)) { void _event; }
    expect((await adapter.reconcile(slow.runId)).state).toBe('interrupted');
    const malformed = await adapter.start({ ...request, commandId: 'three', prompt: 'malformed stream' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await adapter.reconcile(malformed.runId)).state).toBe('reconciling');
  } finally { await adapter.close(); cleanupTestRoot(t.root, t.runId); }
});
