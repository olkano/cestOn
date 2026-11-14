import { it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../apps/server/src/db/store.js';
import { BackupService, recoverBackup } from '../../apps/supervisor/src/backups.js';
import { TestProtector, OsProtector } from '../../apps/server/src/security/protection.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T25 encrypted WAL backup verifies, rejects tampering and restores to an empty frozen target', async () => {
  const t = createTestRoot(); const target = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try { store.event(store.installation().id, 1, 'fixture', { text: 'synthetic private content' }); const service = new BackupService(store, new TestProtector(t.root)); const created = await service.create(); const path = join(t.root, 'backups', created.name); expect(readFileSync(path).includes(Buffer.from('synthetic private content'))).toBe(false); expect((await service.verify(path)).cursor).toBe(1); expect((await service.restore(path, target.root, true)).state).toBe('restored_frozen'); const restored = new Store(target.root, { testMode: true }); try { expect(restored.latestCursor()).toBe(1); expect(restored.installation().dispatch_paused).toBe(1); } finally { restored.close(); }
    const bytes = readFileSync(path); bytes[bytes.length - 1] = bytes.at(-1)! ^ 1; writeFileSync(path, bytes); await expect(service.verify(path)).rejects.toThrow('backup_integrity_failed');
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); cleanupTestRoot(target.root, target.runId); }
});
it('T25 an owner can decrypt a backup when the original SQLite file no longer opens', async () => {
  const source = createTestRoot(); const target = createTestRoot(); const store = new Store(source.root, { testMode: true }); let closed = false;
  try { const id = store.installation().id; const service = new BackupService(store, new OsProtector(id)); const saved = await service.create(); store.close(); closed = true; writeFileSync(join(source.root, 'state/ceston.sqlite'), 'synthetic corrupt database'); expect((await recoverBackup(join(source.root, 'backups', saved.name), target.root, true)).state).toBe('restored_frozen'); const restored = new Store(target.root, { testMode: true }); try { expect(restored.installation().id).toBe(id); expect(restored.installation().dispatch_paused).toBe(1); } finally { restored.close(); } }
  finally { if (!closed) store.close(); cleanupTestRoot(source.root, source.runId); cleanupTestRoot(target.root, target.runId); }
});
