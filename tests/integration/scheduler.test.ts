import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { Scheduler } from '../../apps/server/src/scheduler/index.js';
import { ArtifactVerifier } from '../../apps/server/src/verification/index.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T12/T13 continues verified phases and blocks a convincing false worker completion', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const projectId = randomUUID(); const device = randomUUID(); const root = join(t.root, 'project'); mkdirSync(root);
    store.registerProject({ id: projectId, displayName: 'Fixture', root, kind: 'documents', providerId: 'fixture', allowedChildRoots: [], operations: ['read', 'edit'], recipes: [] });
    store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const config = parseConfig({}); const commands = new CommandService(store, config);
    const taskId = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Two phases', goal: 'Two local artifacts', requestedScope: { operations: ['read', 'edit'] } } }).taskId!;
    let calls = 0;
    const worker = { async execute(request: { runId: string; phaseId: string; root: string; artifacts: { path: string }[] }) {
      calls++; const path = request.artifacts[0]!.path; writeFileSync(join(request.root, path), `phase-${calls}`);
      return { runId: request.runId, phaseId: request.phaseId, status: 'succeeded', summary: 'Independently verify this', artifactRefs: [{ path, sha256: calls === 1 ? createHash('sha256').update(readFileSync(join(root, path))).digest('hex') : '0'.repeat(64) }], claimedChecks: ['all passed'], nextAction: 'continue' };
    } };
    const scheduler = new Scheduler(store, config, worker, new ArtifactVerifier(store, async () => ({ exitCode: 0, outputHash: 'synthetic' })));
    scheduler.savePlan(taskId, { goal: 'Two local artifacts', completionBoundary: 'user_review', phases: [
      { id: 'one', ordinal: 1, goal: 'First', dependsOn: [], allowedRecipeIds: [], expectedArtifacts: [{ path: 'one.txt' }], verificationRecipeIds: [], decisionBoundary: false },
      { id: 'two', ordinal: 2, goal: 'Second', dependsOn: ['one'], allowedRecipeIds: [], expectedArtifacts: [{ path: 'two.txt' }], verificationRecipeIds: [], decisionBoundary: false },
    ] });
    await scheduler.tick(); expect(store.getTask(taskId).phases[0]?.state).toBe('done');
    await scheduler.tick(); expect(store.getTask(taskId).state).toBe('blocked');
    expect(store.getTask(taskId).phases[1]?.state).not.toBe('done'); expect(calls).toBe(2);
    expect(store.getTask(taskId).evidence).toHaveLength(1);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
