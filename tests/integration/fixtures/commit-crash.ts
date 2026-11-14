import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../../apps/server/src/db/store.js';
import { CommandService } from '../../../apps/server/src/commands/service.js';
import { parseConfig } from '../../../packages/contracts/src/config.js';

const root = process.argv[2]!; const boundary = process.argv[3]!;
const store = new Store(root, { testMode: true }); const project = randomUUID(); const device = randomUUID();
mkdirSync(join(root, 'project'));
store.registerProject({ id: project, displayName: 'Crash fixture', root: join(root, 'project'), kind: 'documents', allowedChildRoots: [], operations: ['read'], recipes: [] });
store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Synthetic', randomUUID(), Date.now(), Date.now(), Date.now() + 60000);
function stopAt(point: string) { if (point === boundary) { process.send?.({ boundary: point }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); } }
new CommandService(store, parseConfig({}), stopAt).receive(device, randomUUID(), { type: 'task.create', payload: { projectId: project, title: 'Durable', goal: 'A synthetic request', requestedScope: {} } });
stopAt('after_commit');
