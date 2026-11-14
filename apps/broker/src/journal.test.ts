import { it, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestRoot, cleanupTestRoot } from '../../../packages/test-support/src/index.js';
import { ReceiptJournal } from './journal.js';

it('T05 durable receipt deduplicates before and after dispatch; torn tail never replays a possible effect', async () => {
  const t = createTestRoot(); let calls = 0;
  try {
    let journal = new ReceiptJournal(join(t.root, 'receipts.jsonl'));
    const first = await journal.dispatch('one', { taskId: 'synthetic' }, async () => { calls++; return { runId: 'run-one' }; });
    journal = new ReceiptJournal(join(t.root, 'receipts.jsonl'));
    expect((await journal.dispatch('one', { taskId: 'synthetic' }, async () => { calls++; return {}; })).sequence).toBe(first.sequence);
    expect(calls).toBe(1);
    await expect(journal.dispatch('uncertain', {}, async () => { calls++; throw new Error('lost after start'); })).rejects.toThrow();
    journal = new ReceiptJournal(join(t.root, 'receipts.jsonl'));
    await expect(journal.dispatch('uncertain', {}, async () => { calls++; return {}; })).rejects.toThrow('reconciliation_required');
    expect(calls).toBe(2);
    appendFileSync(join(t.root, 'receipts.jsonl'), '{"torn":');
    expect(() => new ReceiptJournal(join(t.root, 'receipts.jsonl'))).toThrow('journal_corrupt');
  } finally { cleanupTestRoot(t.root, t.runId); }
});
