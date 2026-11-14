import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Store } from '../../apps/server/src/db/store.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T25 consistent SQLite backup includes live WAL and refuses outside roots', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const id = store.installation().id;
    store.event(id, 1, 'host.status', { dispatchPaused: false });
    const snapshot = await store.backupSnapshot('test.sqlite');
    expect(existsSync(join(t.root, 'backups', 'test.sqlite'))).toBe(true);
    const backup = new Database(snapshot.path, { readonly: true });
    try {
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
      expect((backup.prepare('SELECT id FROM installations').get() as { id: string }).id).toBe(id);
      expect((backup.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(1);
    } finally { backup.close(); }
    await expect(store.backupSnapshot('../escaped.sqlite')).rejects.toThrow();
    await expect(store.backupSnapshot('test.sqlite')).rejects.toThrow();
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
