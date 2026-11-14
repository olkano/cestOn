import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { parseConfig } from '../../packages/contracts/src/config.js';

describe('T03-T07 durable authority and commands', () => {
  let t: ReturnType<typeof createTestRoot>;
  let store: Store; let commands: CommandService;
  const device = randomUUID(); const projectId = randomUUID();
  let now = 100000;
  beforeEach(() => {
    t = createTestRoot(); mkdirSync(join(t.root, 'project'));
    store = new Store(t.root, { testMode: true, now: () => now });
    store.registerProject({ id: projectId, displayName: 'Synthetic project', root: join(t.root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read', 'edit', 'test', 'build'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test device', randomUUID(), now, now, now + 1000000);
    commands = new CommandService(store, parseConfig({}));
  });
  afterEach(() => { store.close(); cleanupTestRoot(t.root, t.runId); now = 100000; });
  function create(title = 'A task') {
    return commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title, goal: 'Create a verified local result', requestedScope: { operations: ['read', 'edit', 'test'], budgets: {}, completionBoundary: 'user_review' } } });
  }
  it('survives reopen; immutable scope cannot be edited', () => {
    const receipt = create(); const task = store.getTask(receipt.taskId!);
    expect(task.revision).toBe(1); expect(task.state).toBe('queued');
    expect(() => store.db.prepare('UPDATE scope_revisions SET allowed_operations_json=?').run('["publish"]')).toThrow();
    store.close(); store = new Store(t.root, { testMode: true, now: () => now });
    expect(store.getTask(receipt.taskId!).goal).toBe(task.goal);
    expect(store.events(0).length).toBeGreaterThan(0);
  });
  it('returns one receipt for duplicate canonical payload and rejects changed reuse', () => {
    const key = randomUUID(); const body = { type: 'task.create', payload: { projectId, title: 'One', goal: 'A result', requestedScope: {} } };
    const a = commands.receive(device, key, body); const b = commands.receive(device, key, body);
    expect(a.id).toBe(b.id); expect(store.listTasks()).toHaveLength(1);
    expect(() => commands.receive(device, key, { ...body, payload: { ...body.payload, title: 'Changed' } })).toThrow('idempotency_conflict');
  });
  it('rolls back command, task and outbox together on crash before commit', () => {
    commands = new CommandService(store, parseConfig({}), point => { if (point === 'before_commit') throw new Error('crash'); });
    expect(() => create()).toThrow('crash');
    expect(store.listTasks()).toHaveLength(0); expect(store.db.prepare('SELECT * FROM commands').all()).toHaveLength(0);
    expect(store.db.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
  });
  it('rejects scope expansion, unknown JSON fields, and stale task revisions', () => {
    expect(() => commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Bad', goal: 'Bad', requestedScope: { operations: ['publish'] } } })).toThrow('scope_denied');
    const r = create(); const task = store.getTask(r.taskId!);
    const pause = { type: 'task.pause', taskId: task.id, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: {} };
    commands.receive(device, randomUUID(), pause);
    expect(() => commands.receive(device, randomUUID(), pause)).toThrow('stale_revision');
    expect(() => commands.receive(device, randomUUID(), { ...pause, shell: 'unsafe' })).toThrow('invalid_command');
  });
  it('answers one exact decision, replays same choice receipt and rejects a conflicting choice', () => {
    const r = create(); let task = store.getTask(r.taskId!);
    const decision = store.createDecision(task.id, 'Choose a scope-preserving approach', [{ id: 'a', label: 'First', meaning: 'Read the existing evidence' }, { id: 'b', label: 'Second', meaning: 'Run the registered tests' }], now + 60000);
    task = store.getTask(task.id);
    const command = { type: 'decision.answer', taskId: task.id, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: { decisionId: decision.id, decisionRevision: decision.revision, optionId: 'b' } };
    const answer = commands.receive(device, randomUUID(), command);
    expect(commands.receive(device, randomUUID(), command).id).toBe(answer.id);
    expect(() => commands.receive(device, randomUUID(), { ...command, payload: { ...command.payload, optionId: 'a' } })).toThrow('decision_conflict');
    expect(store.db.prepare('SELECT * FROM outbox WHERE command_id=?').all(answer.id)).toHaveLength(1);
  });
  it('expires a decision and takes a consistent reconnect snapshot', () => {
    const r = create(); const decision = store.createDecision(r.taskId!, 'A choice', [{ id: 'a', label: 'First', meaning: 'Read only' }], now + 1000);
    const task = store.getTask(r.taskId!); now += 2000;
    expect(() => commands.receive(device, randomUUID(), { type: 'decision.answer', taskId: task.id, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: { decisionId: decision.id, decisionRevision: 1, optionId: 'a' } })).toThrow('decision_expired');
    const snapshot = store.snapshot();
    expect(snapshot.cursor).toBe(store.latestCursor()); expect(snapshot.tasks[0]?.id).toBe(task.id);
    expect(JSON.stringify(snapshot.projects)).not.toContain(t.root);
  });
  it('holds canonical writer leases until proven terminal reconciliation and rejects cycles', () => {
    const a = create('A').taskId!; const b = create('B').taskId!;
    store.acquireLease(join(t.root, 'project'), a, 'run-a', 'owner-a');
    expect(() => store.acquireLease(join(t.root, 'project'), b, 'run-b', 'owner-b')).toThrow('resource_busy');
    now += 100000000;
    expect(() => store.releaseLease(join(t.root, 'project'), 'owner-a', false)).toThrow('reconciliation_required');
    store.releaseLease(join(t.root, 'project'), 'owner-a', true);
    store.acquireLease(join(t.root, 'project'), b, 'run-b', 'owner-b');
    store.setDependencies(b, [a]);
    expect(() => store.setDependencies(a, [b])).toThrow('dependency_cycle');
  });
  it('global resume preserves individual pauses; unresolved commands survive pruning', () => {
    const a = create('A'); const task = store.getTask(a.taskId!);
    commands.receive(device, randomUUID(), { type: 'task.pause', taskId: task.id, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: {} });
    commands.receive(device, randomUUID(), { type: 'installation.pause', expectedRevision: store.installation().revision, payload: {} });
    commands.receive(device, randomUUID(), { type: 'installation.resume', expectedRevision: store.installation().revision, payload: {} });
    expect(store.installation().dispatch_paused).toBe(0); expect(store.getTask(task.id).state).toBe('paused');
    now += 365 * 86400000; store.prune();
    expect(store.command(a.id)).toBeDefined();
  });
});
