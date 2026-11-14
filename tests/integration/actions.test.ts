import { it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { ActionService, FixtureActionAdapter } from '../../apps/server/src/authority/actions.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T06/T15 action approval is immutable, detects drift, and reconciles a lost write acknowledgement', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const projectId = randomUUID(); const device = randomUUID(); mkdirSync(join(t.root, 'project'));
    store.registerProject({ id: projectId, displayName: 'Fixture', root: join(t.root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read', 'external.write'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const commands = new CommandService(store, parseConfig({}));
    const taskId = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Approval', goal: 'A synthetic external change', requestedScope: { operations: ['read', 'external.write'] } } }).taskId!;
    const adapter = new FixtureActionAdapter({ value: 'old' }); const actions = new ActionService(store, commands, new Map([['fixture', adapter]]));
    const approval = await actions.prepare(taskId, 'fixture', { objectId: 'synthetic' }, { value: 'new' }, ['Change this synthetic value']);
    const task = store.getTask(taskId);
    const command = { type: 'action.approve', taskId, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: { approvalId: approval.id, revision: approval.revision, proposedHash: approval.proposedHash } };
    const receipt = commands.receive(device, randomUUID(), command);
    adapter.loseAcknowledgement = true; await actions.tick();
    expect(store.command(receipt.id).state).toBe('reconciling'); expect(adapter.writes).toBe(1);
    await actions.tick(); expect(store.command(receipt.id).state).toBe('succeeded'); expect(adapter.writes).toBe(1);
    expect(commands.receive(device, randomUUID(), command).id).toBe(receipt.id);
    const drift = await actions.prepare(taskId, 'fixture', { objectId: 'synthetic' }, { value: 'next' }, ['Another synthetic change']);
    adapter.current = { value: 'changed elsewhere' };
    const current = store.getTask(taskId);
    const stale = commands.receive(device, randomUUID(), { ...command, expectedRevision: current.revision, payload: { approvalId: drift.id, revision: drift.revision, proposedHash: drift.proposedHash } });
    await actions.tick(); expect(store.command(stale.id).errorCode).toBe('action_drift'); expect(adapter.writes).toBe(1);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
