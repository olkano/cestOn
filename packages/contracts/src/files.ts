import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson } from './commands.js';
export function atomicWrite(path: string, value: string | Buffer) { mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx', 0o600); try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, path); }
export function atomicJson(path: string, value: unknown) { atomicWrite(path, canonicalJson(value)); }
export function fileHash(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
