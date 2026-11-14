import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, mkdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson } from './commands.js';
export function atomicWrite(path: string, value: string | Buffer) { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx', 0o600); try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, path); }
export function atomicJson(path: string, value: unknown) { atomicWrite(path, canonicalJson(value)); }
export function fileHash(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
// Copy only the primary byte stream. Windows CopyFile also copies unmanifested ADS.
export function copyPrimaryFile(source: string, target: string) {
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).nlink !== 1)) throw new Error('copy_path_denied');
  writeFileSync(target, readFileSync(source), { mode: stat.mode & 0o777 });
}
