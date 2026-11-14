import { existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';

type RecordEntry = { sequence: number; commandId: string; payloadHash: string; state: 'prepared' | 'accepted' | 'resolved'; result: Record<string, unknown> | null; context?: Record<string, string> };
export class ReceiptJournal {
  private records: RecordEntry[] = [];
  private pending = new Map<string, Promise<{ sequence: number; result: Record<string, unknown> }>>();
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) return;
    const raw = readFileSync(path, 'utf8');
    if (raw && !raw.endsWith('\n')) throw new DomainError('journal_corrupt');
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const record = JSON.parse(line) as { data: RecordEntry; hash: string };
        if (this.hash(record.data) !== record.hash || record.data.sequence !== this.records.length + 1) throw new Error();
        this.records.push(record.data);
      } catch { throw new DomainError('journal_corrupt'); }
    }
  }
  private hash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
  private append(entry: Omit<RecordEntry, 'sequence'>) {
    const data = { ...entry, sequence: this.records.length + 1 };
    const fd = openSync(this.path, 'a', 0o600);
    try { writeSync(fd, `${JSON.stringify({ data, hash: this.hash(data) })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    this.records.push(data); return data;
  }
  receipt(commandId: string) { return this.records.findLast(r => r.commandId === commandId); }
  list() { return [...this.records]; }
  async dispatch(commandId: string, payload: unknown, start: () => Promise<Record<string, unknown>>, context: Record<string, string> = {}) {
    const payloadHash = this.hash(payload); const prior = this.receipt(commandId);
    if (prior && prior.payloadHash !== payloadHash) throw new DomainError('idempotency_conflict');
    const pending = this.pending.get(commandId); if (pending) return pending;
    if (prior) { if (prior.state === 'prepared') throw new DomainError('reconciliation_required'); return { sequence: prior.sequence, result: prior.result! }; }
    this.append({ commandId, payloadHash, state: 'prepared', result: null, context });
    const promise = (async () => {
      const result = await start();
      const accepted = this.append({ commandId, payloadHash, state: 'accepted', result, context });
      return { sequence: accepted.sequence, result };
    })();
    this.pending.set(commandId, promise);
    try { return await promise; } finally { this.pending.delete(commandId); }
  }
  resolve(commandId: string, result: Record<string, unknown>) {
    const prior = this.receipt(commandId); if (!prior) throw new DomainError('unknown_receipt');
    return this.append({ commandId, payloadHash: prior.payloadHash, state: 'resolved', result, ...(prior.context ? { context: prior.context } : {}) });
  }
  compact() {
    if (this.pending.size) throw new DomainError('journal_busy');
    // Keep sequence identity and all prepared records. Compaction rewrites verified bytes atomically.
    const temp = `${this.path}.compact`; const fd = openSync(temp, 'wx', 0o600);
    try { for (const data of this.records) writeSync(fd, `${JSON.stringify({ data, hash: this.hash(data) })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
  }
}
