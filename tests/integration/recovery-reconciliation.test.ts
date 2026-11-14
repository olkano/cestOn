import { it, expect } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { inventory, verifyRelease } from '../../apps/supervisor/src/releases.js';
import { atomicJson, fileHash } from '../../packages/contracts/src/files.js';
import { ReceiptJournal } from '../../apps/broker/src/journal.js';
import { join } from 'node:path';
import { Store } from '../../apps/server/src/db/store.js';
import { BackupService } from '../../apps/supervisor/src/backups.js';
import { TestProtector } from '../../apps/server/src/security/protection.js';
import { reconcileRestore } from '../../apps/supervisor/src/recovery.js';
import { installationSecrets } from '../../apps/broker/src/certification.js';
import { acquireInstance } from '../../apps/broker/src/instance.js';
import { startInstallation } from '../../apps/supervisor/src/operations.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T25 restoration can reconcile an unchanged stopped source but never loses later acknowledged state', async () => {
  const source = createTestRoot(); const target = createTestRoot(); const store = new Store(source.root, { testMode: true });
  try { installationSecrets(source.root); for (const relative of ['releases/base', 'supervisor/runtime']) { const path = join(source.root, relative); mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'program.js'), 'synthetic bootstrap bytes'); writeFileSync(join(path, 'package-lock.json'), '{}'); atomicJson(join(path, 'release-manifest.json'), { releaseId: 'base', sourceRevision: 'synthetic', sourceSnapshotHash: 'a'.repeat(64), createdAt: new Date().toISOString(), requestId: randomUUID(), baseReleaseId: null, files: inventory(path), nodeMajor: 24, lockfileHash: fileHash(join(path, 'package-lock.json')), apiProtocol: 1, brokerProtocolRange: [1, 1], schemaReadRange: [3, 3], schemaWriteVersion: 3, migrationIds: [1, 2, 3], testEvidenceHashes: [], activationClass: 'manual' }); } atomicJson(join(source.root, 'supervisor/active.json'), { current: 'base', previous: null, updateId: null, phase: 'stable' }); store.db.prepare("UPDATE installations SET active_release='base'").run(); store.event(store.installation().id, 1, 'synthetic', {}); const service = new BackupService(store, new TestProtector(source.root)); const backup = await service.create(); await service.restore(join(source.root, 'backups', backup.name), target.root, true); expect((await reconcileRestore(target.root, source.root, true)).state).toBe('reconciled_paused'); expect(verifyRelease(join(target.root, 'supervisor/runtime')).hash).toBe(verifyRelease(join(source.root, 'supervisor/runtime')).hash); expect(readFileSync(join(target.root, 'releases/base/program.js'), 'utf8')).toBe('synthetic bootstrap bytes'); await expect(startInstallation(source.root, true)).rejects.toThrow('installation_retired_for_restore'); const restored = new Store(target.root, { testMode: true }); try { expect(restored.installation().dispatch_paused).toBe(1); } finally { restored.close(); } store.event(store.installation().id, 1, 'synthetic.later', {}); expect((await reconcileRestore(target.root, source.root, true)).state).toBe('reconciliation_required'); expect(store.latestCursor()).toBe(2); const blocked = new Store(target.root, { testMode: true }); try { expect((JSON.parse((blocked.db.prepare("SELECT state_json FROM service_checkpoints WHERE name='recovery'").get() as { state_json: string }).state_json) as { reconciliationRequired: boolean }).reconciliationRequired).toBe(true); } finally { blocked.close(); }
  } finally { store.close(); cleanupTestRoot(source.root, source.runId); cleanupTestRoot(target.root, target.runId); }
}, 30000);
it('T30 the OS prevents concurrent owners and releases only the exact held mutex', async () => {
  const t = createTestRoot(); const first = await acquireInstance(t.root, 'synthetic', 'synthetic');
  try { await expect(acquireInstance(t.root, 'synthetic', 'synthetic')).rejects.toThrow('instance_already_running'); } finally { await first.release(); }
  const second = await acquireInstance(t.root, 'synthetic', 'synthetic'); await second.release(); cleanupTestRoot(t.root, t.runId);
});

it('T25 unknown update-worker activity survives backup and blocks source retirement', async () => {
  const source = createTestRoot(); const target = createTestRoot(); const store = new Store(source.root, { testMode: true });
  try { installationSecrets(source.root); const journal = new ReceiptJournal(join(source.root, 'state/update-worker.jsonl')); await expect(journal.dispatch(randomUUID(), { synthetic: true }, async () => { throw new Error('Synthetic uncertain dispatch'); })).rejects.toThrow(); const backups = new BackupService(store, new TestProtector(source.root)); const saved = await backups.create(); await backups.restore(join(source.root, 'backups', saved.name), target.root, true); expect(readFileSync(join(target.root, 'state/update-worker.jsonl'), 'utf8')).toBe(readFileSync(join(source.root, 'state/update-worker.jsonl'), 'utf8')); expect((await reconcileRestore(target.root, source.root, true)).code).toBe('unresolved_update_work'); expect(existsSync(join(source.root, 'state/recovery-fence.json'))).toBe(false); }
  finally { store.close(); cleanupTestRoot(source.root, source.runId); cleanupTestRoot(target.root, target.runId); }
}, 30000);
