import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { schemaSql } from '../../apps/server/src/db/schema.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T25 migrations preserve the v1 journal and reject changed history and future schemas', () => {
  const t = createTestRoot(); mkdirSync(join(t.root, 'state')); const file = join(t.root, 'state/ceston.sqlite'); const id = randomUUID();
  try {
    const old = new Database(file); old.exec(schemaSql); old.prepare('INSERT INTO migrations VALUES(1,?,?)').run(Date.now(), createHash('sha256').update(schemaSql).digest('hex')); old.prepare('INSERT INTO installations(id,schema_version,created_at) VALUES(?,1,?)').run(id, Date.now()); old.close();
    const current = new Store(t.root, { testMode: true }); expect(current.installation().id).toBe(id); expect(current.installation().schema_version).toBe(2); expect(current.db.prepare('SELECT * FROM migrations').all()).toHaveLength(2); current.db.prepare("UPDATE migrations SET hash='changed' WHERE version=1").run(); current.close();
    expect(() => new Store(t.root, { testMode: true })).toThrow('migration_hash_mismatch');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
