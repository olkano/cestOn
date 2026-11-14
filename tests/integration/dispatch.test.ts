import { it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { OutboxDispatcher, type BrokerReceipt } from '../../apps/server/src/commands/outbox.js';
import { ReceiptJournal } from '../../apps/broker/src/journal.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T05 recovers accepted dispatch after coordinator acknowledgement loss without starting twice', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    mkdirSync(join(t.root, 'project')); const projectId = randomUUID(); const device = randomUUID();
    store.registerProject({ id: projectId, displayName: 'Fixture', root: join(t.root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 60000);
    const command = new CommandService(store, parseConfig({})).receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'One task', goal: 'Read', requestedScope: {} } });
    const journal = new ReceiptJournal(join(t.root, 'receipts.jsonl')); let starts = 0;
    const broker = {
      async accept(id: string, payload: unknown): Promise<BrokerReceipt> { const receipt = await journal.dispatch(id, payload, async () => { starts++; return { runId: 'fixture-run' }; }); return { status: 'accepted', sequence: receipt.sequence, result: receipt.result }; },
      async lookup(id: string): Promise<BrokerReceipt> { const r = journal.receipt(id); return r?.state === 'accepted' ? { status: 'accepted', sequence: r.sequence, result: r.result! } : { status: r ? 'uncertain' : 'absent' }; },
    };
    const crashing = new OutboxDispatcher(store, broker, point => { if (point === 'after_broker_accept') throw new Error('coordinator died'); });
    await expect(crashing.dispatchOne()).rejects.toThrow('coordinator died');
    expect(store.command(command.id).state).toBe('dispatching');
    await new OutboxDispatcher(store, broker).dispatchOne();
    expect(store.command(command.id).state).toBe('accepted'); expect(starts).toBe(1);
    expect(store.db.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('T05 a broker that cannot prove acceptance leaves work unresolved', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    mkdirSync(join(t.root, 'project')); const projectId = randomUUID(); const device = randomUUID();
    store.registerProject({ id: projectId, displayName: 'Fixture', root: join(t.root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 60000);
    const command = new CommandService(store, parseConfig({})).receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'One task', goal: 'Read', requestedScope: {} } });
    let attempts = 0;
    const dispatcher = new OutboxDispatcher(store, { async accept() { attempts++; throw new Error('connection lost after possible acceptance'); }, async lookup() { return { status: 'uncertain' as const }; } });
    expect(await dispatcher.dispatchOne()).toBe(true);
    expect(store.command(command.id).state).toBe('reconciling');
    store.db.prepare('UPDATE outbox SET next_attempt_at=0').run();
    await dispatcher.dispatchOne();
    expect(attempts).toBe(1); expect(store.command(command.id).state).toBe('reconciling');
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
