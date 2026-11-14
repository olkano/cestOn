import { it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Broker } from './runtime.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
import { FixtureAdapter } from '../../../packages/adapters/src/fixture/index.js';

it('T09/T29 broker owns a long fixture run across client reconnect and deduplicates dispatch', async () => {
  const t = createTestRoot(); const projectId = randomUUID(); mkdirSync(join(t.root, 'project'));
  const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root: join(t.root, 'project'), kind: 'documents', providerId: 'fixture' }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true });
  const broker = new Broker(t.root, config, { testMode: true, fixtureDelayMs: 25 });
  try {
    const request = { commandId: randomUUID(), taskId: randomUUID(), projectId, scopeRevisionId: randomUUID(), providerId: 'fixture', root: join(t.root, 'project'), operations: ['read'], prompt: 'Long synthetic job', limits: { turns: 4, runMinutes: 1 } };
    const a = await broker.start(request); const b = await broker.start(request);
    expect(a).toEqual(b);
    await expect(broker.start({ ...request, commandId: randomUUID(), taskId: randomUUID() })).rejects.toThrow('resource_busy');
    await expect.poll(() => broker.events(a.ref.runId, 0).some(e => e.event.type === 'turn.completed'), { timeout: 3000 }).toBe(true);
    const events = broker.events(a.ref.runId, 0);
    expect(events.some(e => e.event.type === 'turn.completed')).toBe(true);
    expect(broker.lookup(request.commandId).status).toBe('accepted');
    expect((await broker.reconcile(a.ref.runId)).state).toBe('succeeded');
    await expect(broker.start({ ...request, prompt: 'Different payload' })).rejects.toThrow('idempotency_conflict');
    await expect(broker.start({ ...request, commandId: randomUUID(), root: t.root })).rejects.toThrow('scope_denied');
  } finally { await broker.close(); cleanupTestRoot(t.root, t.runId); }
});
it('T29 success is not observable before the collector commits its terminal event', async () => {
  const t = createTestRoot(); const projectId = randomUUID(); mkdirSync(join(t.root, 'project'));
  const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root: join(t.root, 'project'), kind: 'documents', providerId: 'fixture' }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true });
  const broker = new Broker(t.root, config, { testMode: true, fixtureDelayMs: 25 }); const status = vi.spyOn(FixtureAdapter.prototype, 'reconcile').mockResolvedValue({ state: 'succeeded' });
  try {
    const run = await broker.start({ commandId: randomUUID(), taskId: randomUUID(), projectId, scopeRevisionId: randomUUID(), providerId: 'fixture', root: join(t.root, 'project'), operations: ['read'], prompt: 'Synthetic completion ordering', limits: { turns: 1, runMinutes: 1 } });
    expect((await broker.reconcile(run.ref.runId)).state).toBe('running');
    await expect.poll(async () => (await broker.reconcile(run.ref.runId)).state).toBe('succeeded'); expect(broker.events(run.ref.runId, 0).at(-1)?.event.type).toBe('turn.completed');
  } finally { status.mockRestore(); await broker.close(); cleanupTestRoot(t.root, t.runId); }
});
