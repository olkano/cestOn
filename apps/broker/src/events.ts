import { existsSync, readFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, DomainError } from '../../../packages/contracts/src/commands.js';
import type { ProviderEvent } from '../../../packages/adapters/src/types.js';
import { sanitizeValue } from '../../../packages/contracts/src/logging.js';

export type BrokerEvent = { sequence: number; runId: string; event: ProviderEvent };
export class BrokerEvents {
  private records: BrokerEvent[] = []; private keys = new Set<string>();
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8'); if (text && !text.endsWith('\n')) throw new DomainError('broker_events_corrupt');
    for (const line of text.split('\n').filter(Boolean)) {
      const { record, hash } = JSON.parse(line) as { record: BrokerEvent; hash: string };
      if (this.hash(record) !== hash || record.sequence !== this.records.length + 1) throw new DomainError('broker_events_corrupt');
      this.records.push(record); this.keys.add(record.event.key);
    }
  }
  private hash(value: unknown) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
  append(runId: string, event: ProviderEvent) {
    if (this.keys.has(event.key)) return;
    const record = { sequence: this.records.length + 1, runId, event: sanitizeValue(event) as ProviderEvent };
    const fd = openSync(this.path, 'a', 0o600);
    try { writeSync(fd, `${JSON.stringify({ record, hash: this.hash(record) })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    this.records.push(record); this.keys.add(event.key);
  }
  read(runId: string, after: number) { return this.records.filter(r => r.runId === runId && r.sequence > after).slice(0, 100); }
}
