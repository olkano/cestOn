import { it, expect } from 'vitest';
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
  try { installationSecrets(source.root); store.event(store.installation().id, 1, 'synthetic', {}); const service = new BackupService(store, new TestProtector(source.root)); const backup = await service.create(); await service.restore(join(source.root, 'backups', backup.name), target.root, true); expect((await reconcileRestore(target.root, source.root, true)).state).toBe('reconciled_paused'); await expect(startInstallation(source.root, true)).rejects.toThrow('installation_retired_for_restore'); const restored = new Store(target.root, { testMode: true }); try { expect(restored.installation().dispatch_paused).toBe(1); } finally { restored.close(); } store.event(store.installation().id, 1, 'synthetic.later', {}); expect((await reconcileRestore(target.root, source.root, true)).state).toBe('reconciliation_required'); expect(store.latestCursor()).toBe(2); const blocked = new Store(target.root, { testMode: true }); try { expect((JSON.parse((blocked.db.prepare("SELECT state_json FROM service_checkpoints WHERE name='recovery'").get() as { state_json: string }).state_json) as { reconciliationRequired: boolean }).reconciliationRequired).toBe(true); } finally { blocked.close(); }
  } finally { store.close(); cleanupTestRoot(source.root, source.runId); cleanupTestRoot(target.root, target.runId); }
}, 30000);
it('T30 the OS prevents concurrent owners and releases only the exact held mutex', async () => {
  const t = createTestRoot(); const first = await acquireInstance(t.root, 'synthetic', 'synthetic');
  try { await expect(acquireInstance(t.root, 'synthetic', 'synthetic')).rejects.toThrow('instance_already_running'); } finally { await first.release(); }
  const second = await acquireInstance(t.root, 'synthetic', 'synthetic'); await second.release(); cleanupTestRoot(t.root, t.runId);
});
