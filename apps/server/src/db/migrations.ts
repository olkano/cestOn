import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { schemaSql } from './schema.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
export const currentSchemaVersion = 3;
export const migrations = [schemaSql, `
CREATE TABLE service_checkpoints(name TEXT PRIMARY KEY, cursor INTEGER NOT NULL, state_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE notification_deliveries(notification_id TEXT NOT NULL REFERENCES notifications(id),subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id),status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,last_error TEXT,PRIMARY KEY(notification_id,subscription_id));
`, `
CREATE TABLE scope_profiles(scope_revision_id TEXT PRIMARY KEY REFERENCES scope_revisions(id),project_json TEXT NOT NULL,provider_json TEXT NOT NULL,profile_hash TEXT NOT NULL);
CREATE TRIGGER immutable_scope_profile BEFORE UPDATE ON scope_profiles BEGIN SELECT RAISE(ABORT,'immutable_scope_profile'); END;
`];
export function migrate(db: Database.Database, now: number) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,hash TEXT NOT NULL)');
  const applied = db.prepare('SELECT version,hash FROM migrations ORDER BY version').all() as { version: number; hash: string }[];
  if (applied.some((m, index) => m.version !== index + 1) || applied.length > currentSchemaVersion) throw new DomainError('schema_incompatible');
  for (const [index, sql] of migrations.entries()) {
    const hash = createHash('sha256').update(sql).digest('hex'); const old = applied[index];
    if (old && old.hash !== hash) throw new DomainError('migration_hash_mismatch');
    if (!old) { db.exec(sql); db.prepare('INSERT INTO migrations VALUES(?,?,?)').run(index + 1, now, hash); }
  }
  const installation = db.prepare('SELECT schema_version FROM installations').get() as { schema_version: number } | undefined;
  if (installation && installation.schema_version !== applied.length) throw new DomainError('schema_incompatible');
  if (installation && installation.schema_version !== currentSchemaVersion) db.prepare('UPDATE installations SET schema_version=?').run(currentSchemaVersion);
}
