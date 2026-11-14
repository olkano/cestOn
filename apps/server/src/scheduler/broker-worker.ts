import { BrokerClient } from '../../../broker/src/client.js';
import type { Store } from '../db/store.js';
import type { WorkRequest, Worker } from './index.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { workerCompletionSchema } from '../../../../packages/contracts/src/model.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { Config } from '../../../../packages/contracts/src/config.js';

type RunMetadata = { providerRunId?: string; cursor?: number; text?: string; completion?: unknown; usage?: unknown };
export class BrokerWorker implements Worker {
  constructor(private store: Store, private broker: BrokerClient, private config: Config) {}
  async execute(request: WorkRequest): Promise<unknown> {
    const prior = await this.broker.lookup(request.commandId);
    if (prior.status === 'uncertain') throw new DomainError('reconciliation_required');
    let ref; let sequence: number; let capabilities: unknown;
    if (prior.status === 'accepted') { ref = prior.result.ref as { runId: string; sessionId: string; turnId: string }; sequence = prior.sequence; capabilities = prior.result.capabilities; }
    else {
      const run = await this.broker.start({ commandId: request.commandId, taskId: request.taskId, projectId: request.projectId, scopeRevisionId: request.scopeRevisionId, providerId: request.providerId, root: request.root, operations: request.operations as ('read' | 'edit')[], limits: { turns: request.limits.turns, runMinutes: request.limits.runMinutes, ...(request.limits.spendUsd ? { spendUsd: request.limits.spendUsd } : {}) }, prompt: JSON.stringify({ instruction: 'Follow project instructions and the immutable task scope. Produce the requested phase artifacts. Return only the worker completion JSON matching the supplied schema. Claimed checks will be independently verified.', taskId: request.taskId, runId: request.runId, phaseId: request.phaseId, goal: request.goal, userInstructions: request.instructions, operations: request.operations, artifacts: request.artifacts, schema: workerCompletionSchema.toJSONSchema() }), workerContext: { runId: request.runId, phaseId: request.phaseId, artifacts: request.artifacts.map(a => a.path) } });
      ref = run.ref; sequence = run.sequence; capabilities = run.capabilities;
    }
    const row = this.store.db.prepare('SELECT usage_json FROM runs WHERE id=?').get(request.runId) as { usage_json: string };
    const metadata = JSON.parse(row.usage_json) as RunMetadata; metadata.providerRunId = ref.runId;
    this.store.db.transaction(() => {
      const profile = this.config.providers.find(p => p.id === request.providerId); const homeId = createHash('sha256').update(profile?.home ?? request.providerId).digest('hex');
      this.store.db.prepare("INSERT OR IGNORE INTO sessions(id,provider,provider_session_id,provider_home_id,project_id,task_id,ownership,observed_state,observed_at) VALUES(?,?,?,?,?,?,'managed','running',?)").run(randomUUID(), request.providerId, ref.sessionId, homeId, request.projectId, request.taskId, this.store.now());
      const session = this.store.db.prepare('SELECT id FROM sessions WHERE provider=? AND provider_home_id=? AND provider_session_id=?').get(request.providerId, homeId, ref.sessionId) as { id: string };
      this.store.db.prepare('UPDATE runs SET provider_turn_id=?,session_id=?,broker_receipt=?,capability_json=?,usage_json=? WHERE id=?').run(ref.turnId, session.id, sequence, JSON.stringify(capabilities ?? {}), JSON.stringify(metadata), request.runId);
      this.store.db.prepare("UPDATE commands SET state='accepted',accepted_at=? WHERE id=?").run(this.store.now(), request.commandId);
      this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(request.commandId);
      for (const instruction of request.instructions) { this.store.db.prepare("UPDATE commands SET state='accepted',accepted_at=? WHERE id=?").run(this.store.now(), instruction.id); this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(instruction.id); }
      this.store.event(request.taskId, this.store.taskRow(request.taskId).revision, 'command.changed', { commandId: request.commandId, state: 'accepted' });
    })();
    const deadline = Date.now() + request.limits.runMinutes * 60000;
    while (Date.now() < deadline) {
      const events = await this.broker.events(ref.runId, metadata.cursor ?? 0);
      for (const record of events) {
        const event = record.event; metadata.cursor = record.sequence;
        if (event.type === 'message.delta') {
          const text = typeof event.data.text === 'string' ? event.data.text : JSON.stringify(event.data.message ?? '');
          metadata.text = ((metadata.text ?? '') + text).slice(-32768);
        }
        if (event.type === 'usage.updated') metadata.usage = event.data;
        if (event.type === 'turn.completed' && event.data.result !== undefined) metadata.completion = event.data.result;
        this.store.event(request.taskId, this.store.taskRow(request.taskId).revision, `provider.${event.type}`, event.type === 'message.delta' ? { runId: request.runId, text: String(event.data.text ?? '').slice(0, 2000) } : { runId: request.runId, ...event.data }, event.key);
      }
      this.store.db.prepare('UPDATE runs SET usage_json=? WHERE id=?').run(JSON.stringify(metadata), request.runId);
      if (events.length === 100) continue;
      const state = (await this.broker.reconcile(ref.runId)).state;
      if (state === 'succeeded') {
        this.store.db.prepare("UPDATE sessions SET observed_state='stopped',observed_at=? WHERE id=(SELECT session_id FROM runs WHERE id=?)").run(this.store.now(), request.runId);
        let result = metadata.completion ?? metadata.text;
        if (typeof result === 'string') { try { result = JSON.parse(result.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new DomainError('worker_envelope_invalid'); } }
        return result;
      }
      if (state === 'interrupted') { this.store.db.prepare("UPDATE sessions SET observed_state='stopped',observed_at=? WHERE id=(SELECT session_id FROM runs WHERE id=?)").run(this.store.now(), request.runId); throw new DomainError('worker_interrupted'); }
      if (['needs_attention', 'reconciling', 'unknown'].includes(state)) throw new DomainError('reconciliation_required');
      if (state === 'failed') throw new DomainError('worker_failed');
      await delay(100);
    }
    const stopped = await this.interrupt(request.runId);
    throw new DomainError(stopped.acknowledged ? 'run_timeout' : 'reconciliation_required');
  }
  async interrupt(runId: string) {
    const row = this.store.db.prepare('SELECT usage_json FROM runs WHERE id=?').get(runId) as { usage_json: string } | undefined;
    const ref = row ? (JSON.parse(row.usage_json) as RunMetadata).providerRunId : undefined;
    if (!ref) return { acknowledged: false };
    return this.broker.interrupt(ref);
  }
}
