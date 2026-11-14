import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { Scheduler } from '../../apps/server/src/scheduler/index.js';
import { BrokerWorker } from '../../apps/server/src/scheduler/broker-worker.js';
import { ArtifactVerifier } from '../../apps/server/src/verification/index.js';
import type { BrokerClient } from '../../apps/broker/src/client.js';
import type { Execution } from '../../apps/broker/src/runtime.js';
import type { BrokerEvent } from '../../apps/broker/src/events.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';
it('T12/T29 drains completion committed between the event read and terminal status without redispatching work', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true }); const projectId = randomUUID(); const device = randomUUID(); const root = join(t.root, 'project'); mkdirSync(root);
  const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root, kind: 'documents', providerId: 'fixture', operations: ['read', 'edit'] }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true });
  try {
    store.registerProject(config.projects[0]!); store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Synthetic', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
    const id = new CommandService(store, config).receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'Terminal race', goal: 'One verified artifact', requestedScope: { operations: ['read', 'edit'] } } }).taskId!;
    const ref = { runId: randomUUID(), sessionId: randomUUID(), turnId: randomUUID() }; const records: BrokerEvent[] = []; let completion: unknown; let starts = 0;
    const broker = { async lookup() { return { status: 'absent' }; }, async workspace() { return { root, sourceHash: 'synthetic' }; }, async start(input: Execution) { starts++; const context = input.workerContext!; const bytes = 'Synthetic terminal artifact'; writeFileSync(join(root, 'result.txt'), bytes); completion = { runId: context.runId, phaseId: context.phaseId, status: 'succeeded', summary: 'Verified independently', artifactRefs: [{ path: 'result.txt', sha256: createHash('sha256').update(bytes).digest('hex') }], claimedChecks: [], nextAction: 'Review' }; records.push({ sequence: 1, runId: ref.runId, event: { key: 'progress', sequence: 1, type: 'message.delta', data: { text: 'Progress is not a completion envelope.' } } }); return { ref, sequence: 1, capabilities: {} }; }, async events(_run: string, after: number) { return records.filter(record => record.sequence > after); }, async reconcile() { if (records.length === 1) records.push({ sequence: 2, runId: ref.runId, event: { key: 'completion', sequence: 2, type: 'turn.completed', data: { result: completion } } }); return { state: 'succeeded' }; } } as unknown as BrokerClient;
    const scheduler = new Scheduler(store, config, new BrokerWorker(store, broker, config), new ArtifactVerifier(store, async () => ({ exitCode: 0, outputHash: 'synthetic' })));
    scheduler.savePlan(id, { goal: 'One verified artifact', completionBoundary: 'user_review', phases: [{ id: 'one', ordinal: 1, goal: 'Produce artifact', dependsOn: [], allowedRecipeIds: [], expectedArtifacts: [{ path: 'result.txt' }], verificationRecipeIds: [], decisionBoundary: false }] });
    await scheduler.tick(); expect(store.getTask(id).state).toBe('review_ready'); expect(store.getTask(id).evidence).toHaveLength(1); expect(starts).toBe(1); expect(store.events(0, id).filter(event => event.type === 'provider.turn.completed')).toHaveLength(1);
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
