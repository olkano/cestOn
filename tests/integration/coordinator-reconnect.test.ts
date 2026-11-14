import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixtureConfig } from '../../scripts/fixture-config.js';
import { Store } from '../../apps/server/src/db/store.js';
import { coordinator } from '../../apps/server/src/runtime.js';
import { spawnBroker } from '../../apps/broker/src/client.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T29 coordinator replacement preserves an owned broker run, command identity and writer lease', async () => {
  const t = createTestRoot(); const config = fixtureConfig(t.root); const initial = new Store(t.root, { testMode: true }); const installationId = initial.installation().id; initial.close(); const broker = await spawnBroker(t.root, installationId, true, 1000);
  let first: Awaited<ReturnType<typeof coordinator>> | null = null; let second: Awaited<ReturnType<typeof coordinator>> | null = null;
  try {
    first = await coordinator(t.root, { testMode: true }); const deviceId = randomUUID(); first.store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(deviceId, 'Synthetic', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const receipt = first.commands!.receive(deviceId, randomUUID(), { type: 'task.create', payload: { projectId: config.projects[0]!.id, title: 'Survive replacement', goal: 'Synthetic artifact', requestedScope: { operations: ['read', 'edit', 'test'] } } });
    await expect.poll(() => first!.store.db.prepare('SELECT id FROM runs WHERE broker_receipt IS NOT NULL').get()).toBeTruthy(); const original = first.store.db.prepare('SELECT id,command_id FROM runs').get() as { id: string; command_id: string };
    await first.close(); first = null; expect(broker.child.exitCode).toBeNull();
    second = await coordinator(t.root, { testMode: true }); await expect.poll(() => second!.store.getTask(receipt.taskId!).state, { timeout: 7000 }).toBe('review_ready');
    expect(second.store.db.prepare('SELECT id,command_id FROM runs').all()).toEqual([original]); expect(second.store.db.prepare('SELECT * FROM leases').all()).toHaveLength(0); expect((await broker.client.lookup(original.command_id)).status).toBe('accepted');
  } finally { if (first) await first.close(); if (second) await second.close(); await broker.close(); cleanupTestRoot(t.root, t.runId); }
});
