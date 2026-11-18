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
import { ConversationReplies } from '../../apps/server/src/projects/conversation-replies.js';
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

    const replies = new ConversationReplies(store, config, broker.client);
    const [thread] = replies.list();
    expect(thread).toMatchObject({ title: task.title, managed: true });
    expect((await replies.view(thread!.id, device)).state).toBe('ready');
    const external = randomUUID();
    store.db.prepare(`INSERT INTO sessions(id,provider,provider_session_id,provider_home_id,project_id,ownership,observed_state,observed_at)
      VALUES(?,'fixture','external-session','other-home',?,'observe_only','stopped',?)`).run(external, projectId, Date.now());
    await expect(replies.send(external, device, randomUUID(), 'Must stay read only')).rejects.toThrow('conversation_unavailable');
    const key = randomUUID();
    const reply = await replies.send(thread!.id, device, key, 'Explain the verified result');
    expect(replies.list(await replies.activities())[0]).toMatchObject({ id:thread!.id, status:'working' });
    expect(await replies.send(thread!.id, device, key, 'Explain the verified result')).toEqual(reply);
    await expect(replies.send(thread!.id, device, key, 'Different content')).rejects.toThrow('idempotency_conflict');
    const original = store.db.prepare('SELECT s.provider_session_id,r.usage_json FROM sessions s JOIN runs r ON r.session_id=s.id WHERE s.id=?').get(thread!.id) as { provider_session_id: string; usage_json: string };
    const parentRunId = (JSON.parse(original.usage_json) as { providerRunId: string }).providerRunId;
    replies.freeze(true);
    await replies.tick();
    expect(await broker.client.lookup(reply.id)).toEqual({ status: 'absent' });
    // Simulate a lost coordinator after the durable write and broker acceptance.
    store.db.prepare("UPDATE commands SET state='dispatching' WHERE id=?").run(reply.id);
    store.acquireLease(config.projects[0]!.root, task.id, reply.id, reply.id);
    const delivery = await broker.client.reply(parentRunId, reply.id, 'Explain the verified result');
    expect(delivery.ref.sessionId).toBe(original.provider_session_id);
    expect(delivery.ref.runId).not.toBe(parentRunId);
    const restarted = new ConversationReplies(store, config, broker.client);
    await expect.poll(async () => {
      await restarted.tick();
      return store.command(reply.id).state;
    }, { timeout: 5000 }).toBe('succeeded');
    const times = store.db.prepare('SELECT created_at,resolved_at FROM commands WHERE id=?').get(reply.id) as {created_at:number;resolved_at:number};
    expect((await restarted.view(thread!.id, device)).turns).toEqual([{
      id: reply.id, clientKey: key, state: 'succeeded', prompt: 'Explain the verified result',
      answer: 'Synthetic worker result. Verification is required.', preview:null,
      createdAt:new Date(times.created_at).toISOString(),
    }]);
    expect(restarted.list(await restarted.activities())[0]).toMatchObject({
      id:thread!.id, status:'idle', endedAt:new Date(times.resolved_at).toISOString(),
    });
    expect(store.db.prepare('SELECT * FROM leases').all()).toHaveLength(0);
    const interrupted = await restarted.send(thread!.id, device, randomUUID(), 'An unacknowledged prompt');
    store.db.prepare("UPDATE commands SET state='dispatching' WHERE id=?").run(interrupted.id);
    await restarted.tick();
    expect(store.command(interrupted.id).state).toBe('reconciling');
    expect(await broker.client.lookup(interrupted.id)).toEqual({ status: 'absent' });
    expect((await restarted.view(thread!.id, device)).state).toBe('uncertain');
  } finally { await broker.close(); store.close(); cleanupTestRoot(t.root, t.runId); }
}, 15000);
