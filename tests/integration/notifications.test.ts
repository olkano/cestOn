import { it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { NotificationService } from '../../apps/server/src/notifications/index.js';
import { TestProtector } from '../../apps/server/src/security/protection.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T23 decisions persist independently of push; deliveries are encrypted, deduplicated, capped and remove gone subscriptions', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true }); const deviceId = randomUUID(); const projectId = randomUUID();
  try {
    mkdirSync(join(t.root, 'project')); const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root: join(t.root, 'project'), kind: 'documents' }] }); store.registerProject(config.projects[0]!);
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(deviceId, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const task = new CommandService(store, config).receive(deviceId, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Private customer title', goal: 'Synthetic', requestedScope: { operations: ['read'] } } }).taskId!;
    store.createDecision(task, 'Private choice', [{ id: 'one', label: 'One', meaning: 'Synthetic' }], Date.now() + 60000);
    let sends = 0; let mode = 'transient'; const delivered: string[] = [];
    const service = new NotificationService(store, new TestProtector(t.root), async (_subscription, payload) => { sends++; delivered.push(payload); return mode === 'gone' ? 410 : 503; });
    await service.tick(); expect(service.list()).toHaveLength(1); expect(sends).toBe(0);
    await expect(service.subscribe(deviceId, { endpoint: 'https://127.0.0.1/private', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } })).rejects.toThrow('push_endpoint_denied');
    const subscription = await service.subscribe(deviceId, { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } });
    const encrypted = store.db.prepare('SELECT endpoint_encrypted,keys_encrypted FROM push_subscriptions').get() as { endpoint_encrypted: string; keys_encrypted: string }; expect(encrypted.endpoint_encrypted).not.toContain('synthetic'); expect(encrypted.keys_encrypted).not.toContain('aaaa');
    for (let i = 0; i < 4; i++) { store.db.prepare('UPDATE notification_deliveries SET next_attempt_at=0').run(); await service.tick(); }
    expect(sends).toBe(3); expect(delivered.join('')).not.toContain('Private'); expect(service.list()).toHaveLength(1);
    await service.unsubscribe(deviceId, subscription.id); mode = 'gone';
    await service.subscribe(deviceId, { endpoint: 'https://fcm.googleapis.com/fcm/send/second', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }); await service.tick();
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE disabled_at IS NULL').get() as { n: number }).n).toBe(0);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
