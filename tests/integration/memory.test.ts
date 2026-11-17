import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from '../../apps/server/src/db/store.js';
import { ProjectMemory } from '../../apps/server/src/db/memory.js';
import { createApp } from '../../apps/server/src/create-app.js';
import { BackupService } from '../../apps/supervisor/src/backups.js';
import { TestProtector } from '../../apps/server/src/security/protection.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

const blank = { text: 'An unassigned commitment', projectId: null, relatedProjectId: null, importance: null, dueAt: null, reviewAt: null, revision: 0 } as const;

it('learns only after a verified outcome is accepted and deduplicates even after forgetting', () => {
  const t = createTestRoot();
  const store = new Store(t.root, { testMode: true });
  try {
    const projectId = randomUUID();
    const device = randomUUID();
    const config = parseConfig({ projects: [{ id: projectId, displayName: 'Fixture', root: join(t.root, 'project'), kind: 'documents' }] });
    store.registerProject(config.projects[0]!);
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test device', randomUUID(), Date.now(), Date.now(), Date.now() + 60000);
    const commands = new CommandService(store, config);
    const taskId = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Fixture result', goal: 'Verify fixture', requestedScope: {} } }).taskId!;
    const memory = new ProjectMemory(store);
    memory.learnAcceptedTask(taskId);
    expect(memory.list().entries).toEqual([]);
    store.db.prepare("UPDATE tasks SET state='review_ready' WHERE id=?").run(taskId);
    store.db.prepare("INSERT INTO phases(id,task_id,ordinal,goal,dependencies_json,verification_json,state,attempt_count,max_attempts,revision) VALUES(?,?,1,'fixture','[]','{}','done',0,1,1)").run(randomUUID(), taskId);
    const task = store.taskRow(taskId);
    commands.receive(device, randomUUID(), { type: 'task.accept', taskId, expectedRevision: task.revision, scopeRevisionId: task.scope_revision_id, payload: {} });
    expect(memory.list().entries).toMatchObject([{ text: 'Accepted verified work: Fixture result', source: 'observation', sourceTaskId: taskId }]);
    memory.forget(taskId, 1);
    memory.learnAcceptedTask(taskId);
    expect(memory.list().entries).toEqual([]);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('retains plain notes, checks concurrent revisions and blocks reappearance from an older backup', async () => {
  const source = createTestRoot();
  const target = createTestRoot();
  let store = new Store(source.root, { testMode: true });
  try {
    const first = new ProjectMemory(store);
    const note = { ...blank, id: randomUUID() };
    expect(first.save(note).revision).toBe(1);
    expect(first.save(note).revision).toBe(1);
    const backup = new BackupService(store, new TestProtector(source.root));
    const snapshot = await backup.create();
    store.close();
    store = new Store(source.root, { testMode: true });
    const memory = new ProjectMemory(store);
    expect(memory.list('commitment').entries[0]?.text).toBe(blank.text);
    const edit = { ...note, text: 'Updated commitment', revision: 1 };
    expect(memory.save(edit).revision).toBe(2);
    expect(() => memory.save({ ...edit, text: 'Competing edit' })).toThrow('memory_changed');
    expect(memory.list().entries.map(entry => entry.text)).toEqual(['Updated commitment']);
    memory.forget(note.id, 2);
    memory.forget(note.id, 2);
    expect(() => memory.save(note)).toThrow('memory_forgotten');
    expect(memory.list().entries).toEqual([]);
    expect(store.db.prepare('SELECT * FROM memory_revisions').all()).toEqual([]);
    expect(JSON.stringify(store.events(0))).not.toContain('commitment');
    await backup.restore(join(source.root, 'backups', snapshot.name), target.root, true);
    const restored = new Store(target.root, { testMode: true });
    try {
      expect(() => new ProjectMemory(restored).list()).toThrow('restored_memory_needs_reconciliation');
      expect(restored.installation().dispatch_paused).toBe(1);
    } finally { restored.close(); }
  } finally {
    store.close();
    cleanupTestRoot(source.root, source.runId);
    cleanupTestRoot(target.root, target.runId);
  }
});

it('keeps links, importance and dates independent and hides notes crossing an excluded project', () => {
  const t = createTestRoot();
  let now = Date.parse('2026-11-17T16:00Z');
  const store = new Store(t.root, { testMode: true, now: () => now });
  try {
    const [a, b] = ['A', 'B'].map(displayName => {
      const id = randomUUID();
      store.registerProject({ id, displayName, root: join(t.root, displayName), kind: 'documents', allowedChildRoots: [], operations: ['read'], recipes: [] });
      return id;
    }) as [string, string];
    const memory = new ProjectMemory(store);
    const input = { ...blank, id: randomUUID(), text: 'A shares a deployment checklist with B', projectId: a, relatedProjectId: b, importance: 'high' as const, dueAt: '2026-11-20T16:00:00Z', reviewAt: '2026-11-19T16:00:00Z' };
    expect(memory.save(input)).toMatchObject({ urgency: 'later', importance: 'high', needsReview: false });
    expect(memory.list('', b).entries).toHaveLength(1);
    now += 2 * 86400000;
    expect(memory.list().entries[0]).toMatchObject({ urgency: 'soon', importance: 'high', needsReview: true });
    memory.setExcluded(b, true);
    expect(memory.list('', a).entries).toEqual([]);
    expect(() => memory.save({ ...input, id: randomUUID() })).toThrow('project_memory_excluded');
    memory.setExcluded(b, false);
    expect(memory.list('', a).entries).toHaveLength(1);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('keeps a note and relationship identity after an explicitly confirmed folder move', () => {
  const t = createTestRoot();
  const store = new Store(t.root, { testMode: true });
  try {
    const memory = new ProjectMemory(store);
    const [from, to, related] = ['Old name', 'New name', 'Other project'].map(name => ({ id: randomUUID(), name })) as [{ id: string; name: string }, { id: string; name: string }, { id: string; name: string }];
    memory.rememberFolders([from, to, related]);
    const note = memory.save({ ...blank, id: randomUUID(), projectId: from.id, relatedProjectId: related.id, text: 'Shares its documentation with the other project.' });
    memory.confirmFolderMove(from.id, to.id);
    memory.confirmFolderMove(from.id, to.id);
    memory.rememberFolders([from, to, related]);
    expect(memory.folders()).toContainEqual({ id: from.id, displayName: to.name });
    expect(memory.folders().map(folder => folder.id)).not.toContain(to.id);
    expect(memory.list('', related.id).entries[0]).toMatchObject({ id: note.id, projectId: from.id, relatedProjectId: related.id });
    expect(store.snapshot().projects).toEqual([]);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('requires an authenticated device and CSRF, and remembers an explicit conversation without echoing text into the journal', async () => {
  const t = createTestRoot();
  const store = new Store(t.root, { testMode: true });
  const { app, auth } = await createApp({ store });
  const headers: Record<string, string> = { host: '127.0.0.1:4318', origin: 'http://127.0.0.1:4318' };
  try {
    expect((await app.inject({ url: '/api/v1/memory', headers })).statusCode).toBe(401);
    const paired = await app.inject({ method: 'POST', url: '/api/v1/pairing/redeem', headers, payload: { invitation: auth!.invite(), deviceName: 'Fixture' } });
    headers.cookie = String(paired.headers['set-cookie']).split(';')[0]!;
    const payload = { messageId: randomUUID(), text: 'Remember: private example note' };
    const send = () => app.inject({ method: 'POST', url: '/api/v1/conversation', headers, payload });
    expect((await send()).statusCode).toBe(403);
    headers['x-csrf-token'] = paired.json().data.csrf as string;
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const response = await app.inject({ url: '/api/v1/memory', headers });
    expect(response.json().data.entries).toHaveLength(1);
    expect(response.json().data.entries[0]).toMatchObject({ text: 'private example note', projectId: null, source: 'you' });
    expect(JSON.stringify(store.events(0))).not.toContain('private example note');
  } finally { await app.close(); store.close(); cleanupTestRoot(t.root, t.runId); }
});
