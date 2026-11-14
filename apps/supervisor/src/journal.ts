import { existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac } from 'node:crypto';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
export type ActivationRecord = { sequence: number; updateId: string; phase: string; current: string; previous: string | null; candidate: string; candidateHash: string; requestHash: string; occurredAt: number; checkpoint?: string; error?: string };
export class ActivationJournal {
  private records: ActivationRecord[] = [];
  constructor(private path: string, private key: string) {
    mkdirSync(dirname(path), { recursive: true }); if (!existsSync(path)) return; const raw = readFileSync(path, 'utf8'); if (raw && !raw.endsWith('\n')) throw new DomainError('activation_journal_corrupt');
    for (const line of raw.split('\n').filter(Boolean)) { const entry = JSON.parse(line) as { record: ActivationRecord; hash: string }; if (entry.record.sequence !== this.records.length + 1 || entry.hash !== this.hash(entry.record)) throw new DomainError('activation_journal_corrupt'); this.records.push(entry.record); }
  }
  private hash(value: unknown) { return createHmac('sha256', this.key).update(canonicalJson(value)).digest('hex'); }
  append(input: Omit<ActivationRecord, 'sequence'>) { const record = { ...input, sequence: this.records.length + 1 }; const fd = openSync(this.path, 'a', 0o600); try { writeSync(fd, `${JSON.stringify({ record, hash: this.hash(record) })}\n`); fsyncSync(fd); } finally { closeSync(fd); } this.records.push(record); return record; }
  latest() { return this.records.at(-1); }
  forUpdate(updateId: string) { return this.records.filter(record => record.updateId === updateId); }
}
