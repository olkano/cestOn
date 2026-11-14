import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { Store } from '../../apps/server/src/db/store.js';
import { createApp } from '../../apps/server/src/create-app.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T19 authenticated HTTP preserves command identity, exact decisions, consistent snapshot and revoked SSE', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true }); mkdirSync(join(t.root, 'project')); const projectId = randomUUID();
  const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root: join(t.root, 'project'), kind: 'documents' }] }); store.registerProject(config.projects[0]!);
  const { app, auth } = await createApp({ store, config, origin: 'http://127.0.0.1:4317' });
  const headers: Record<string, string> = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317' };
  try {
    const paired = await app.inject({ method: 'POST', url: '/api/v1/pairing/redeem', headers, payload: { invitation: auth!.invite(), deviceName: 'Phone' } });
    headers.cookie = String(paired.headers['set-cookie']).split(';')[0]!; headers['x-csrf-token'] = paired.json().data.csrf as string; headers['idempotency-key'] = randomUUID();
    const payload = { type: 'task.create', payload: { projectId, title: 'HTTP task', goal: 'Synthetic work', requestedScope: { operations: ['read'] } } };
    const created = await app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload }); expect(created.statusCode).toBe(202);
    const again = await app.inject({ method: 'POST', url: '/api/v1/commands', headers, payload }); expect(again.json().data.id).toBe(created.json().data.id);
    const id = created.json().data.taskId as string; const decision = store.createDecision(id, 'Choose a route', [{ id: 'one', label: 'First', meaning: 'First meaning' }, { id: 'two', label: 'Second', meaning: 'Second meaning' }], Date.now() + 60000);
    const task = store.getTask(id);
    const answered = await app.inject({ method: 'POST', url: '/api/v1/conversation', headers, payload: { messageId: randomUUID(), text: 'option two', taskId: id, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, decisionId: decision.id, decisionRevision: decision.revision } }); expect(answered.json().data.kind).toBe('receipt');
    const snapshot = await app.inject({ url: '/api/v1/snapshot', headers }); expect(snapshot.json().data.cursor).toBe(store.latestCursor()); expect(snapshot.json().data.tasks[0].decision).toBeNull();
    const oldCursor = store.latestCursor(); store.event(id, store.taskRow(id).revision, 'task.changed', { state: 'queued' });
    expect((await app.inject({ url: `/api/v1/snapshot?after=100&expectedCursor=${oldCursor}`, headers })).statusCode).toBe(409);
    expect(JSON.stringify(snapshot.json())).not.toContain(t.root); expect(snapshot.headers['cache-control']).toBe('no-store');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const stream = await new Promise<IncomingMessage>(resolve => { httpRequest(`${address}/api/v1/events?after=0`, { headers, timeout: 3000 }, resolve).end(); }); expect(stream.statusCode).toBe(200);
    stream.setTimeout(3000, () => stream.destroy(new Error('SSE test timed out')));
    const chunks = stream[Symbol.asyncIterator](); let text = ''; while (!text.includes('event: task.changed')) text += String((await chunks.next()).value);
    auth!.revoke(paired.json().data.deviceId as string);
    let ended = false; for (let i = 0; i < 4 && !ended; i++) ended = (await chunks.next()).done === true;
    expect(ended).toBe(true); stream.destroy();
  } finally { await app.close(); store.close(); cleanupTestRoot(t.root, t.runId); }
});
