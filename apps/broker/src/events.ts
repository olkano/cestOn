import { existsSync, readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import type { ProviderEvent } from '../../../packages/adapters/src/types.js';
import { sanitizeValue } from '../../../packages/contracts/src/logging.js';

export type BrokerEvent = { sequence: number; runId: string; event: ProviderEvent };
export class BrokerEvents {
  private records: BrokerEvent[] = []; private keys = new Set<string>(); private sequence = 0;
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) return;
    if (statSync(path).size > 128 * 1048576) throw new DomainError('broker_event_storage_limit');
    const text = readFileSync(path, 'utf8'); if (text && !text.endsWith('\n')) throw new DomainError('broker_events_corrupt');
    for (const line of text.split('\n').filter(Boolean)) {
      const checkpoint = JSON.parse(line) as { checkpoint?: number; hash: string }; if (checkpoint.checkpoint !== undefined) { if (this.records.length || this.sequence || !Number.isSafeInteger(checkpoint.checkpoint) || checkpoint.checkpoint < 0 || checkpoint.hash !== this.hash({ checkpoint: checkpoint.checkpoint })) throw new DomainError('broker_events_corrupt'); this.sequence = checkpoint.checkpoint; continue; }
      const { record, hash } = JSON.parse(line) as { record: BrokerEvent; hash: string };
      if (this.hash(record) !== hash || !Number.isSafeInteger(record.sequence) || record.sequence <= (this.records.at(-1)?.sequence ?? 0)) throw new DomainError('broker_events_corrupt');
      this.sequence = Math.max(this.sequence, record.sequence);
      this.records.push(record); this.keys.add(record.event.key);
    }
  }
  private hash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
  append(runId: string, event: ProviderEvent) {
    if (this.keys.has(event.key)) return;
    if (existsSync(this.path) && statSync(this.path).size > 127 * 1048576) throw new DomainError('broker_event_storage_limit');
    const record = { sequence: this.sequence + 1, runId, event: sanitizeValue(event) as ProviderEvent };
    const fd = openSync(this.path, 'a', 0o600);
    try { writeSync(fd, `${JSON.stringify({ record, hash: this.hash(record) })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    this.records.push(record); this.sequence = record.sequence; this.keys.add(event.key);
  }
  read(runId: string, after: number) { return this.records.filter(r => r.runId === runId && r.sequence > after).slice(0, 100); }
  prune(acknowledgedTerminal: Map<string, number>) {
    const retained = this.records.filter(record => record.sequence > (acknowledgedTerminal.get(record.runId) ?? -1)); const removed = this.records.length - retained.length; if (!removed) return 0;
    const temp = `${this.path}.compact`; const fd = openSync(temp, 'wx', 0o600); const checkpoint = { checkpoint: this.sequence };
    try { writeSync(fd, `${JSON.stringify({ ...checkpoint, hash: this.hash(checkpoint) })}\n`); for (const record of retained) writeSync(fd, `${JSON.stringify({ record, hash: this.hash(record) })}\n`); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, this.path); this.records = retained; this.keys = new Set(retained.map(record => record.event.key)); return removed;
  }
}
