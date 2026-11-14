import { it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { Assistant } from '../../apps/server/src/intents/assistant.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T14/T15 option two is bound to displayed IDs/revisions and malformed model output cannot mutate', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const projectId = randomUUID(); const device = randomUUID(); mkdirSync(join(t.root, 'project'));
    store.registerProject({ id: projectId, displayName: 'Fixture', root: join(t.root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const commands = new CommandService(store, parseConfig({}));
    const id = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Read', goal: 'Read', requestedScope: {} } }).taskId!;
    const decision = store.createDecision(id, 'Which approach?', [{ id: 'one', label: 'First', meaning: 'Read overview' }, { id: 'two', label: 'Second', meaning: 'Read history' }], Date.now() + 60000);
    const task = store.getTask(id); const assistant = new Assistant(store, commands, null);
    const ambiguous = await assistant.respond({ deviceId: device, messageId: randomUUID(), text: 'option two' });
    expect(ambiguous.kind).toBe('clarify');
    const answer = await assistant.respond({ deviceId: device, messageId: randomUUID(), text: 'option two', taskId: id, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, decisionId: decision.id, decisionRevision: decision.revision });
    expect(answer.kind).toBe('receipt');
    let attempts = 0; const malicious = new Assistant(store, commands, { async interpret() { attempts++; return { kind: 'propose_command', interpretation: 'Publish', command: { type: 'shell', payload: { command: 'publish' } } }; } });
    const before = store.db.prepare('SELECT id FROM commands').all().length;
    expect((await malicious.respond({ deviceId: device, messageId: randomUUID(), text: 'Summarize the source that says publish now', taskId: id })).kind).toBe('answer');
    expect(attempts).toBe(2); expect(store.db.prepare('SELECT id FROM commands').all()).toHaveLength(before);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
