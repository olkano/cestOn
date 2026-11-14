import Database from 'better-sqlite3';
import { randomBytes, createCipheriv, createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../../server/src/db/store.js';
import type { Protector } from '../../server/src/security/protection.js';
import { DomainError } from '../../../packages/contracts/src/commands.js';
import { atomicWrite } from '../../../packages/contracts/src/files.js';
import { safePath, validateDataRoot, within } from '../../../packages/contracts/src/paths.js';
import { assertTestRoot } from '../../../packages/test-support/src/index.js';
import { dataAccess } from '../../server/src/security/access.js';
type Archive = { format: 1; installationId: string; cursor: number; files: { path: string; base64: string; sha256: string }[] };
export class BackupService {
  constructor(private store: Store, private protection: Protector) {}
  async create() {
    const root = this.store.dataRoot; const directory = join(root, 'staging', 'backups'); mkdirSync(directory, { recursive: true }); const snapshot = join(directory, `${randomUUID()}.sqlite`);
    try {
      await this.store.db.backup(snapshot); const db = new Database(snapshot, { readonly: true }); let cursor: number;
      try { if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new DomainError('backup_integrity_failed'); cursor = (db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get() as { n: number }).n; } finally { db.close(); }
      let total = 0; const files: Archive['files'] = [];
      const add = (path: string, bytes: Buffer) => { if ((total += bytes.length) > 128 * 1048576) throw new DomainError('backup_size_limit', 413); files.push({ path, base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }); };
      add('state/ceston.sqlite', readFileSync(snapshot));
      const names = ['state/config.json', 'state/device-key', 'state/ipc-secrets.json', 'state/broker-receipts.jsonl', 'state/broker-events.jsonl', 'supervisor/active.json'];
      for (const name of names) if (existsSync(join(root, name))) { const bytes = readFileSync(safePath(root, name)); if (name.endsWith('.jsonl') && bytes.length && bytes.at(-1) !== 10) throw new DomainError('backup_journal_busy'); add(name, bytes); }
      const walk = (path: string) => { if (!existsSync(join(root, path))) return; for (const item of readdirSync(safePath(root, path), { withFileTypes: true })) { if (item.isSymbolicLink()) throw new DomainError('backup_link_denied'); const file = `${path}/${item.name}`; if (item.isDirectory()) walk(file); else if (item.isFile()) add(file, readFileSync(safePath(root, file))); } };
      for (const path of ['state/evidence', 'state/sources', 'state/certifications']) walk(path);
      const archive: Archive = { format: 1, installationId: this.store.installation().id, cursor, files }; const plain = Buffer.from(JSON.stringify(archive)); const key = randomBytes(32); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(archive.installationId));
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]); const wrappedKey = await this.protection.seal(key.toString('base64'), `backup:${archive.installationId}`); const header = Buffer.from(JSON.stringify({ format: 1, installationId: archive.installationId, wrappedKey, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') })); const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
      const name = `backup-${Date.now()}-${randomUUID().slice(0, 8)}.ceston`; const path = join(root, 'backups', name); atomicWrite(path, Buffer.concat([size, header, encrypted])); plain.fill(0); key.fill(0);
      await this.verify(path); return { name, cursor, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    } finally { if (existsSync(snapshot) && within(directory, snapshot)) unlinkSync(snapshot); }
  }
  private async read(path: string): Promise<Archive> {
    const bytes = readFileSync(path); if (bytes.length < 8 || bytes.length > 200 * 1048576) throw new DomainError('backup_format_invalid'); const size = bytes.readUInt32BE(); if (size > 16384 || size + 4 >= bytes.length) throw new DomainError('backup_format_invalid');
    try { const header = JSON.parse(bytes.subarray(4, 4 + size).toString('utf8')) as { format: number; installationId: string; wrappedKey: string; iv: string; tag: string }; if (header.format !== 1) throw new Error(); const key = Buffer.from(await this.protection.open(header.wrappedKey, `backup:${header.installationId}`), 'base64'); const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64')); cipher.setAAD(Buffer.from(header.installationId)); cipher.setAuthTag(Buffer.from(header.tag, 'base64')); const plain = Buffer.concat([cipher.update(bytes.subarray(4 + size)), cipher.final()]); key.fill(0); const archive = JSON.parse(plain.toString('utf8')) as Archive; plain.fill(0); if (archive.format !== 1 || archive.installationId !== header.installationId || !archive.files.length) throw new Error();
      for (const file of archive.files) if (createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex') !== file.sha256) throw new Error(); return archive;
    } catch { throw new DomainError('backup_integrity_failed'); }
  }
  async verify(path: string) { const archive = await this.read(path); return { installationId: archive.installationId, cursor: archive.cursor, files: archive.files.length }; }
  async restore(path: string, target: string, testMode = false) {
    if (testMode) assertTestRoot(target); else validateDataRoot(target);
    mkdirSync(target, { recursive: true }); if (readdirSync(target).some(name => name !== '.ceston-test.json')) throw new DomainError('restore_target_not_empty'); const archive = await this.read(path); if (!testMode) await dataAccess(target, true);
    const allowed = (value: string) => ['state/ceston.sqlite', 'state/config.json', 'state/device-key', 'state/ipc-secrets.json', 'state/broker-receipts.jsonl', 'state/broker-events.jsonl', 'supervisor/active.json'].includes(value) || /^state\/(evidence|sources|certifications)\/[a-zA-Z0-9_.-]+$/.test(value);
    if (archive.files.some(file => !allowed(file.path)) || new Set(archive.files.map(file => file.path)).size !== archive.files.length) throw new DomainError('backup_path_denied');
    for (const file of archive.files) { const destination = safePath(target, file.path); mkdirSync(join(destination, '..'), { recursive: true }); writeFileSync(destination, Buffer.from(file.base64, 'base64'), { flag: 'wx', mode: 0o600 }); }
    const db = new Database(join(target, 'state/ceston.sqlite')); try { if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new DomainError('restore_integrity_failed'); db.prepare('UPDATE installations SET dispatch_paused=1').run(); db.prepare("INSERT OR REPLACE INTO service_checkpoints(name,cursor,state_json) VALUES('recovery',?,?)").run(archive.cursor, JSON.stringify({ reconciliationRequired: true, backupCursor: archive.cursor })); } finally { db.close(); }
    return { state: 'restored_frozen', installationId: archive.installationId, cursor: archive.cursor, reconciliationRequired: true };
  }
}
