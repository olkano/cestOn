import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { Scheduler } from '../../apps/server/src/scheduler/index.js';
import { ArtifactVerifier } from '../../apps/server/src/verification/index.js';
import { DomainError } from '../../packages/contracts/src/commands.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T16 pause waits for acknowledgement, preserves retry budget and resumes only selected work', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const project = randomUUID(); const device = randomUUID(); const root = join(t.root, 'project'); mkdirSync(root);
    store.registerProject({ id: project, displayName: 'Fixture', root, kind: 'documents', providerId: 'fixture', allowedChildRoots: [], operations: ['read', 'edit'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const config = parseConfig({}); const commands = new CommandService(store, config);
    const taskId = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId: project, title: 'Pause', goal: 'A local result', requestedScope: { operations: ['read', 'edit'] } } }).taskId!;
    let rejectRun!: (error: Error) => void; let acknowledged = false;
    const scheduler = new Scheduler(store, config, { execute: async () => new Promise((_resolve, reject) => { rejectRun = reject; }), async interrupt() { if (acknowledged) rejectRun(new DomainError('worker_interrupted')); return { acknowledged }; } }, new ArtifactVerifier(store, async () => { throw new Error('No recipe'); }));
    scheduler.savePlan(taskId, { goal: 'A local result', completionBoundary: 'user_review', phases: [{ id: 'one', ordinal: 1, goal: 'Write', dependsOn: [], allowedRecipeIds: [], expectedArtifacts: [{ path: 'one.txt' }], verificationRecipeIds: [], decisionBoundary: false }] });
    const running = scheduler.tick(); await new Promise(resolve => setTimeout(resolve, 10));
    const task = store.getTask(taskId);
    commands.receive(device, randomUUID(), { type: 'task.pause', taskId, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: {} });
    await scheduler.tick(); expect(store.getTask(taskId).state).toBe('pausing'); expect(store.db.prepare('SELECT * FROM leases').all()).toHaveLength(1);
    acknowledged = true; await scheduler.tick(); await running;
    expect(store.getTask(taskId).state).toBe('paused'); expect(store.getTask(taskId).phases[0]?.attempt_count).toBe(0);
    expect(store.db.prepare('SELECT * FROM leases').all()).toHaveLength(0);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('T12/T13 verification failures retry only to the immutable phase cap', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const project = randomUUID(); const device = randomUUID(); const root = join(t.root, 'project'); mkdirSync(root); writeFileSync(join(root, 'one.txt'), 'present');
    store.registerProject({ id: project, displayName: 'Fixture', root, kind: 'documents', providerId: 'fixture', allowedChildRoots: [], operations: ['read', 'test'], recipes: [{ id: 'check', executable: 'fixture', args: [], operation: 'test', network: false, timeoutSeconds: 1 }] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const config = parseConfig({}); const commands = new CommandService(store, config);
    const taskId = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId: project, title: 'Bounded', goal: 'A tested local result', requestedScope: { operations: ['read', 'test'] } } }).taskId!;
    let runs = 0;
    const scheduler = new Scheduler(store, config, { async execute(r) { runs++; return { runId: r.runId, phaseId: r.phaseId, status: 'succeeded', summary: 'A claim', artifactRefs: [{ path: 'one.txt' }], claimedChecks: ['passed'], nextAction: 'verify' }; } }, new ArtifactVerifier(store, async () => ({ exitCode: 1, outputHash: 'known-failing-fixture' })));
    scheduler.savePlan(taskId, { goal: 'A tested local result', completionBoundary: 'user_review', phases: [{ id: 'one', ordinal: 1, goal: 'Verify', dependsOn: [], allowedRecipeIds: [], expectedArtifacts: [{ path: 'one.txt' }], verificationRecipeIds: ['check'], decisionBoundary: false }] });
    await scheduler.tick(); expect(store.getTask(taskId).state).toBe('queued');
    await scheduler.tick(); expect(store.getTask(taskId).state).toBe('blocked'); await scheduler.tick(); expect(runs).toBe(2);
    const task = store.getTask(taskId);
    expect(() => commands.receive(device, randomUUID(), { type: 'task.resume', taskId, expectedRevision: task.revision, scopeRevisionId: task.scopeRevisionId, payload: {} })).toThrow('attempt_budget_exhausted');
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
