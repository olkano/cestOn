import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { CommandService } from '../../apps/server/src/commands/service.js';
import { Scheduler } from '../../apps/server/src/scheduler/index.js';
import { BrokerWorker } from '../../apps/server/src/scheduler/broker-worker.js';
import { ArtifactVerifier } from '../../apps/server/src/verification/index.js';
import { recipeExecutor } from '../../apps/server/src/verification/recipes.js';
import { PlanningService, FixtureModel } from '../../apps/server/src/intents/model.js';
import { spawnBroker } from '../../apps/broker/src/client.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T12 a real coordinator service and separate fixture broker produce independently verified review artifacts', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true }); const projectId = randomUUID(); const device = randomUUID();
  mkdirSync(join(t.root, 'project'));
  const config = parseConfig({ projects: [{ id: projectId, displayName: 'Synthetic', root: join(t.root, 'project'), kind: 'documents', operations: ['read', 'edit', 'test'], recipes: [{ id: 'check', executable: 'fixture:assert-artifact', args: ['result.txt'], operation: 'test' }], providerId: 'fixture' }], providers: [{ id: 'fixture', kind: 'fixture', executable: '', version: '1', profile: 'constrained' }] }, { testMode: true });
  store.registerProject(config.projects[0]!); writeFileSync(join(t.root, 'state', 'config.json'), JSON.stringify(config));
  store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').run(device, 'Test', randomUUID(), Date.now(), Date.now(), Date.now() + 600000);
  const broker = await spawnBroker(t.root, store.installation().id, true);
  try {
    const commands = new CommandService(store, config);
    const verifier = new ArtifactVerifier(store, recipeExecutor(store, broker.client));
    const scheduler = new Scheduler(store, config, new BrokerWorker(store, broker.client, config), verifier);
    const planner = new PlanningService(store, scheduler, new FixtureModel(t.root));
    const receipt = commands.receive(device, randomUUID(), { type: 'task.create', payload: { projectId, title: 'A fixture result', goal: 'Create a synthetic result', requestedScope: { operations: ['read', 'edit', 'test'] } } });
    await planner.tick(); await scheduler.tick();
    const task = store.getTask(receipt.taskId!);
    expect(task.state).toBe('review_ready'); expect(task.evidence).toHaveLength(1);
    expect(readFileSync(join(t.root, 'project/result.txt'), 'utf8')).toContain('Synthetic cestOn fixture artifact');
    expect((store.db.prepare('SELECT broker_receipt,capability_json FROM runs').get() as { broker_receipt: number; capability_json: string }).broker_receipt).toBeGreaterThan(0);
    expect(store.db.prepare('SELECT * FROM leases').all()).toHaveLength(0);
    const verified = store.events(0, task.id).find(e => e.type === 'phase.verified');
    expect((JSON.parse(verified!.sanitized_payload_json) as { checks: unknown[] }).checks).toHaveLength(1);
  } finally { await broker.close(); store.close(); cleanupTestRoot(t.root, t.runId); }
});
