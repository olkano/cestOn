import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnBroker, BrokerClient } from '../../apps/broker/src/client.js';
import { installationSecrets } from '../../apps/broker/src/certification.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T29 an independent broker survives a coordinator client disconnect and cleanly stops its pipe host', async () => {
  const t = createTestRoot(); const projectId = randomUUID(); mkdirSync(join(t.root, 'project')); mkdirSync(join(t.root, 'state'));
  const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root: join(t.root, 'project'), kind: 'documents', providerId: 'fixture' }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true });
  writeFileSync(join(t.root, 'state', 'config.json'), JSON.stringify(config));
  const process = await spawnBroker(t.root, t.installationId, true);
  try {
    expect(await process.client.profileProbe('fixture')).toMatchObject({ authenticated: true, fixture: true, modelTurns: 0 });
    const run = await process.client.start({ commandId: randomUUID(), taskId: randomUUID(), projectId, scopeRevisionId: randomUUID(), providerId: 'fixture', root: join(t.root, 'project'), operations: ['read'], prompt: 'Long synthetic work', limits: { turns: 4, runMinutes: 1 } });
    expect((await process.client.activity()).activeOperations).toBeGreaterThan(0);
    const reconnected = new BrokerClient(process.client.endpoint, t.installationId, installationSecrets(t.root).broker);
    await expect.poll(async () => (await reconnected.events(run.ref.runId, 0)).some(e => e.event.type === 'turn.completed'), { timeout: 3000 }).toBe(true);
    const events = await reconnected.events(run.ref.runId, 0);
    expect(events.filter(e => e.event.type === 'turn.completed')).toHaveLength(1);
    expect((await reconnected.reconcile(run.ref.runId)).state).toBe('succeeded'); await expect.poll(async () => (await reconnected.activity()).activeOperations).toBe(0);
  } finally { await process.close(); cleanupTestRoot(t.root, t.runId); }
});
