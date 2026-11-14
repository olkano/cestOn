import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeInstallation, localStatus, doctor } from '../../apps/supervisor/src/operations.js';
import { startup } from '../../apps/supervisor/src/startup.js';
import { RotatingLog } from '../../apps/supervisor/src/logs.js';
import { ReceiptJournal } from '../../apps/broker/src/journal.js';
import { BrokerEvents } from '../../apps/broker/src/events.js';
import { inventory } from '../../apps/supervisor/src/releases.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T30 installation prepares only its own immutable supervisor and startup plan; doctor reports unavailable capabilities', async () => {
  const source = createTestRoot(); const target = createTestRoot();
  try { const bundle = join(source.root, 'bundle'); mkdirSync(bundle); writeFileSync(join(bundle, 'package-lock.json'), '{}'); atomicJson(join(bundle, 'release-manifest.json'), { releaseId: 'synthetic', sourceRevision: 'fixture', sourceSnapshotHash: 'a'.repeat(64), createdAt: new Date().toISOString(), requestId: randomUUID(), baseReleaseId: null, files: inventory(bundle), nodeMajor: 24, lockfileHash: fileHash(join(bundle, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: [], activationClass: 'manual' });
    expect((await initializeInstallation(target.root, bundle, {}, true)).state).toBe('installed_stopped'); expect((await localStatus(target.root, true)).releaseId).toBe('synthetic'); const plan = await startup(target.root, 'Install', true, true); expect(plan.changesPersistence).toBe(false); expect(plan.args).toContain(target.root); expect(plan.taskName).toMatch(/^cestOn-/); await expect(startup(target.root, 'Install', false, true)).rejects.toThrow('startup_registration_denied'); expect((await doctor(target.root, true)).checks.find(check => check.capability === 'supervisor')?.status).toBe('blocked'); await expect(initializeInstallation(target.root, bundle, {}, true)).rejects.toThrow('installation_target_not_empty');
  } finally { cleanupTestRoot(source.root, source.runId); cleanupTestRoot(target.root, target.runId); }
});
it('T25 pruning preserves uncertain receipts, monotonic event cursors and active runs; logs stay bounded and redact secrets', async () => {
  const t = createTestRoot();
  try { const path = join(t.root, 'receipts.jsonl'); const journal = new ReceiptJournal(path); const id = randomUUID(); await journal.dispatch(id, { synthetic: true }, async () => ({ state: 'succeeded' })); journal.resolve(id, { state: 'succeeded' }); const uncertain = randomUUID(); await expect(journal.dispatch(uncertain, {}, async () => { throw new Error('crash'); })).rejects.toThrow('crash'); journal.compact(); const restored = new ReceiptJournal(path); expect(restored.list()).toHaveLength(2); expect(restored.receipt(uncertain)?.state).toBe('prepared'); let called = false; await restored.dispatch(id, { synthetic: true }, async () => { called = true; return {}; }); expect(called).toBe(false);
    const eventsPath = join(t.root, 'events.jsonl'); const events = new BrokerEvents(eventsPath); const event = (key: string) => ({ key, type: 'message.delta' as const, provider: 'fixture', sequence: 1, runId: 'run', sessionId: 'session', turnId: 'turn', at: new Date().toISOString(), data: { text: 'synthetic' } }); events.append('done', event('one')); events.append('active', event('two')); expect(events.prune(new Map([['done', 1]]))).toBe(1); const reloaded = new BrokerEvents(eventsPath); expect(reloaded.read('active', 0)[0]?.sequence).toBe(2); reloaded.append('new', event('three')); expect(reloaded.read('new', 0)[0]?.sequence).toBe(3);
    const log = new RotatingLog(t.root, 'test', 128, 3); for (let index = 0; index < 20; index++) log.write({ operation: 'synthetic', result: 'pass', token: 'private', text: 'private' }); const files = readdirSync(join(t.root, 'logs')); expect(files).toHaveLength(3); expect(files.every(file => !readFileSync(join(t.root, 'logs', file), 'utf8').includes('private'))).toBe(true);
  } finally { cleanupTestRoot(t.root, t.runId); }
});
