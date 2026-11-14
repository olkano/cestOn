import { it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { SessionOwnership } from '../../apps/server/src/projects/ownership.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T11 active and uncertain owners stay observe-only; a verified handoff records both sessions', () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const project = randomUUID(); const device = randomUUID(); mkdirSync(join(t.root, 'project'));
    store.registerProject({ id: project, displayName: 'Fixture', root: join(t.root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 60000);
    const task = new CommandService(store, parseConfig({})).receive(device, randomUUID(), { type: 'task.create', payload: { projectId: project, title: 'Continue', goal: 'Read safely', requestedScope: {} } }).taskId!;
    const old = randomUUID(); const next = randomUUID();
    const insert = store.db.prepare('INSERT INTO sessions(id,provider,provider_session_id,provider_home_id,project_id,ownership,observed_state,observed_at,task_id) VALUES(?,?,?,?,?,?,?,?,?)');
    insert.run(old, 'fixture', 'old-provider-session', 'fixture-home', project, 'observe_only', 'running', Date.now(), null);
    insert.run(next, 'fixture', 'new-provider-session', 'fixture-home', project, 'managed', 'stopped', Date.now(), task);
    const ownership = new SessionOwnership(store, randomBytes(32).toString('hex'));
    expect(() => ownership.adopt(task, old, next, 'forged')).toThrow('owner_active');
    store.db.prepare("UPDATE sessions SET observed_state='unknown' WHERE id=?").run(old);
    expect(() => ownership.adopt(task, old, next, 'forged')).toThrow('owner_unknown');
    store.db.prepare("UPDATE sessions SET observed_state='stopped' WHERE id=?").run(old);
    expect(() => ownership.adopt(task, old, next, 'forged')).toThrow('handoff_proof_required');
    const proof = ownership.signStoppedOwner(old);
    const handoff = ownership.adopt(task, old, next, proof);
    expect(handoff).toMatchObject({ oldSessionId: old, newSessionId: next, taskId: task });
    expect((store.db.prepare('SELECT ownership FROM sessions WHERE id=?').get(old) as { ownership: string }).ownership).toBe('handed_off');
    expect(store.events(0, task).some(e => e.type === 'session.handoff')).toBe(true);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
