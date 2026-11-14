import { existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync, renameSync, mkdirSync, statSync } from 'node:fs';
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
    if (statSync(path).size > 128 * 1048576) throw new DomainError('journal_storage_limit');
    const raw = readFileSync(path, 'utf8');
    if (raw && !raw.endsWith('\n')) throw new DomainError('journal_corrupt');
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const record = JSON.parse(line) as { data: RecordEntry; hash: string };
        if (this.hash(record.data) !== record.hash || !Number.isSafeInteger(record.data.sequence) || record.data.sequence <= (this.records.at(-1)?.sequence ?? 0)) throw new Error();
        this.records.push(record.data);
      } catch { throw new DomainError('journal_corrupt'); }
    }
  }
  private hash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
  private append(entry: Omit<RecordEntry, 'sequence'>) {
    const data = { ...entry, sequence: (this.records.at(-1)?.sequence ?? 0) + 1 };
    if (existsSync(this.path) && statSync(this.path).size > 127 * 1048576) throw new DomainError('journal_storage_limit');
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
    if (prior.state === 'resolved' && this.hash(prior.result) === this.hash(result)) return prior;
    return this.append({ commandId, payloadHash: prior.payloadHash, state: 'resolved', result, ...(prior.context ? { context: prior.context } : {}) });
  }
  compact() {
    if (this.pending.size) throw new DomainError('journal_busy');
    // One durable latest record per command keeps original sequence identity and all uncertain effects.
    const latest = new Map(this.records.map(record => [record.commandId, record])); const retained = [...latest.values()].sort((a,b) => a.sequence-b.sequence);
    const temp = `${this.path}.compact`; const fd = openSync(temp, 'wx', 0o600);
    try { for (const data of retained) writeSync(fd, `${JSON.stringify({ data, hash: this.hash(data) })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
    this.records = retained;
  }
}
