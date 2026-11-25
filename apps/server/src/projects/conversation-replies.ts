import { randomUUID } from 'node:crypto';
import type { BrokerClient } from '../../../broker/src/client.js';
import type { RunRef } from '../../../../packages/adapters/src/types.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import type { Config } from '../../../../packages/contracts/src/config.js';
import type { CommandRow, Store } from '../db/store.js';
import { conversationFolderId, type ChatActivity, type Conversation } from './history.js';

type Thread = {
  id: string; task_id: string; project_id: string; provider: string;
  title: string; folder: string; canonical_root: string; observed_at: number; ended_at: number | null; working: number;
};
type Target = { runId: string; root: string; scopeId: string };
type Reply = { sessionId: string; text: string; runId?: string; attemptId?: string };
type ReplyState = 'ready' | 'working' | 'waiting' | 'paused' | 'unavailable' | 'offline' | 'uncertain';
const pending = "('queued','dispatching','accepted','reconciling')";
const commandType = 'conversation.reply';
const refusedBeforeSend = new Set(['conversation_busy', 'conversation_unavailable', 'provider_authentication_required',
  'resume_unavailable', 'resource_busy', 'concurrency_limit', 'scope_denied', 'budget_denied', 'broker_closing',
  'history_session_open', 'history_provider_unavailable', 'history_target_invalid', 'conversation_not_available']);
const savedHistory = (id: string) => /^[a-f0-9]{32}$/.test(id);
// Known ways a sent reply can end without an answer; each has its own message in the chat.
const replyOutcomes = new Set(['history_reply_stopped', 'history_reply_failed', 'history_reply_interrupted']);
const answerLimit = 32000;

export class ConversationReplies {
  private polling = false;
  private frozen = false;
  private roster = new Map<string,ChatActivity>();
  private observedAt = 0;
  private observing: Promise<void> | undefined;
  constructor(private store: Store, private config: Config, private broker: BrokerClient) {}
  freeze(frozen: boolean) { this.frozen = frozen; }

  private threads(id: string | null = null) {
    return this.store.db.prepare(`WITH recent AS (
      SELECT json_extract(payload_json,'$.sessionId') AS id,MAX(created_at) AS time,
        MAX(CASE WHEN state='succeeded' THEN resolved_at END) AS ended
      FROM commands WHERE type='conversation.reply' GROUP BY id
    ), work AS (
      SELECT session_id,MAX(ended_at) AS ended,
        MAX(CASE WHEN state='running' AND broker_receipt IS NOT NULL THEN 1 ELSE 0 END) AS working
      FROM runs WHERE session_id IS NOT NULL GROUP BY session_id
    )
      SELECT s.id,s.task_id,s.project_id,s.provider,t.title,p.display_name AS folder,
      p.canonical_root,MAX(s.observed_at,COALESCE(recent.time,0),COALESCE(recent.ended,0),COALESCE(work.ended,0)) AS observed_at,
      NULLIF(MAX(COALESCE(recent.ended,0),COALESCE(work.ended,0)),0) AS ended_at,COALESCE(work.working,0) AS working
      FROM sessions s JOIN tasks t ON t.id=s.task_id JOIN projects p ON p.id=s.project_id
      LEFT JOIN recent ON recent.id=s.id
      LEFT JOIN work ON work.session_id=s.id
      WHERE s.ownership='managed' AND t.project_id=p.id AND p.archived_at IS NULL
      AND (? IS NULL OR s.id=?) ORDER BY observed_at DESC,s.id LIMIT 4000`).all(id, id) as Thread[];
  }
  async activities() {
    if (this.config.history.claudeExecutable && this.config.history.claudeHome && Date.now() - this.observedAt >= 5000) {
      this.observing ??= this.broker.historyActivities().then(rows => {
        this.roster = new Map(rows.map(row => [row.id,{status:row.status}]));
      }).catch(() => { this.roster.clear(); }).finally(() => { this.observedAt = Date.now(); this.observing = undefined; });
      await this.observing;
    }
    const result = new Map(this.roster);
    const replies = this.store.db.prepare(`SELECT json_extract(payload_json,'$.sessionId') AS id,
      MAX(CASE WHEN state IN ('queued','dispatching','accepted') AND error_code IS NULL THEN created_at END) AS started,
      MAX(CASE WHEN state='succeeded' THEN resolved_at END) AS ended
      FROM commands WHERE type=? GROUP BY id`).all(commandType) as {id:string;started:number|null;ended:number|null}[];
    for (const row of replies) if (row.started || row.ended) result.set(row.id,{
      ...result.get(row.id), ...(row.started ? {status:'working',startedAt:new Date(row.started).toISOString()} : {}),
      ...(row.ended ? {endedAt:new Date(row.ended).toISOString()} : {}),
    });
    return result;
  }

  list(activity = new Map<string,ChatActivity>()): Conversation[] {
    return this.threads().map(row => {
      const kind = this.config.providers.find(profile => profile.id === row.provider)?.kind;
      const status = activity.get(row.id)?.status ?? (row.working ? 'working' : row.ended_at ? 'idle' : 'unknown');
      return {
        id: row.id, folderId: conversationFolderId(row.canonical_root), folder: row.folder, managed: true,
        provider: kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude' : kind === 'fixture' ? 'Fixture' : 'Managed',
        title: row.title, activityAt: new Date(row.observed_at).toISOString(), approximate: false, status,
        endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      };
    });
  }
  private findThread(id: string) { return this.threads(id)[0]; }
  private thread(id: string) {
    const row = this.findThread(id);
    if (!row) throw new DomainError('conversation_unavailable', 404);
    return row;
  }
  private target(thread: Thread): Target | null {
    const task = this.store.taskRow(thread.task_id);
    if (!['review_ready', 'completed'].includes(task.state)) return null;
    const project = this.config.projects.find(value => value.id === thread.project_id && value.providerId === thread.provider);
    const profile = this.config.providers.find(value => value.id === thread.provider);
    if (!project || !profile) return null;
    const grant = this.store.db.prepare('SELECT profile_hash FROM scope_profiles WHERE scope_revision_id=?').get(task.scope_revision_id) as { profile_hash: string } | undefined;
    if (grant?.profile_hash !== this.store.payloadHash({ project, provider: profile })) return null;
    const source = this.store.db.prepare(`SELECT r.usage_json,c.payload_json FROM runs r JOIN commands c ON c.id=r.command_id
      WHERE r.session_id=? AND r.task_id=? AND r.state='succeeded' AND c.type='phase.execute' AND c.scope_revision_id=?
      ORDER BY r.started_at DESC,r.id DESC LIMIT 1`).get(thread.id, task.id, task.scope_revision_id) as Pick<CommandRow, 'payload_json'> & { usage_json: string } | undefined;
    if (!source) return null;
    const runId = (JSON.parse(source.usage_json) as { providerRunId?: string }).providerRunId;
    const work = JSON.parse(source.payload_json) as { root: string; operations: string[] };
    return runId && work.operations.includes('read') ? { runId, root: work.root, scopeId: task.scope_revision_id } : null;
  }
  private active(id: string) {
    return this.store.db.prepare(`SELECT state,error_code FROM commands WHERE type=? AND state IN ${pending}
      AND json_extract(payload_json,'$.sessionId')=? LIMIT 1`).get(commandType, id) as Pick<CommandRow,'state'|'error_code'> | undefined;
  }
  private paused() { return this.frozen || this.store.installation().dispatch_paused !== 0; }
  private deviceActive(id: string) {
    return Boolean(this.store.db.prepare('SELECT 1 FROM devices WHERE id=? AND revoked_at IS NULL AND expires_at>?').get(id, this.store.now()));
  }
  private async state(id: string, target: Target | null): Promise<ReplyState> {
    const active = this.active(id);
    if (active?.state === 'reconciling') return 'uncertain';
    if (active) return active.error_code === 'history_session_open' ? 'waiting' : 'working';
    if (this.paused()) return 'paused';
    if (!target && !savedHistory(id)) return 'unavailable';
    try { return target ? await this.broker.replyState(target.runId) : await this.broker.historyReplyState(id); }
    catch { return 'offline'; }
  }
  async view(id: string, deviceId: string) {
    const thread = savedHistory(id) ? null : this.thread(id);
    const turns = this.store.db.prepare(`SELECT c.id,c.state,c.error_code,c.payload_json,c.created_at,e.sanitized_payload_json AS result,
      CASE WHEN c.device_id=? THEN c.idempotency_key END AS client_key
      FROM commands c LEFT JOIN events e ON e.provider_event_key='conversation.reply:'||c.id
      WHERE c.task_id IS ? AND c.type=? AND json_extract(c.payload_json,'$.sessionId')=?
      ORDER BY c.created_at DESC,c.rowid DESC LIMIT 50`).all(deviceId, thread?.task_id ?? null, commandType, id) as (Pick<CommandRow, 'id' | 'state' | 'payload_json' | 'error_code' | 'created_at'> & { result: string | null; client_key: string | null })[];
    const state = await this.state(id, thread ? this.target(thread) : null);
    const active = thread && turns.find(row => row.state === 'accepted');
    const preview = active ? await this.acceptedRun(active.id,id).then(run => run ? this.answer(run.ref.runId) : '').catch(()=>'') : '';
    return { state, opening: thread ? this.store.taskRow(thread.task_id).goal : null, turns: turns.reverse().map(row => ({
      id: row.id, state: row.state, ...(row.error_code ? { error: row.error_code } : {}), prompt: (JSON.parse(row.payload_json) as Reply).text, clientKey: row.client_key,
      createdAt:new Date(row.created_at).toISOString(), answer: row.result ? (JSON.parse(row.result) as { text: string }).text : null,
      preview:row.id === active?.id && preview ? preview : null,
    })) };
  }
  cancelWaiting(id: string, commandId: string) {
    return this.store.db.transaction(() => {
      const row = this.store.db.prepare(`SELECT * FROM commands WHERE id=? AND type=? AND state='queued'
        AND error_code='history_session_open' AND json_extract(payload_json,'$.sessionId')=?`).get(commandId,commandType,id) as CommandRow | undefined;
      if (!row) throw new DomainError('conversation_busy',409);
      this.finish(row,JSON.parse(row.payload_json) as Reply,'cancelled');
      return this.store.command(row.id);
    }).immediate();
  }
  // Stops a reply the provider is working on. The provider and the commands it started end; the reply is shown as stopped.
  async stop(id: string, commandId: string) {
    const row = this.store.db.prepare(`SELECT * FROM commands WHERE id=? AND type=? AND state='accepted'
      AND json_extract(payload_json,'$.sessionId')=?`).get(commandId,commandType,id) as CommandRow | undefined;
    const reply = row && JSON.parse(row.payload_json) as Reply;
    const run = row && reply && await this.acceptedRun(reply.attemptId ?? row.id, id);
    if (!row || !run) throw new DomainError('conversation_busy',409);
    await this.broker.interrupt(run.ref.runId);
    return this.store.command(row.id);
  }
  async send(id: string, deviceId: string, key: string, text: string) {
    const thread = savedHistory(id) ? null : this.thread(id);
    // The provider receives exactly what the owner typed, including paths and identifiers.
    const prompt = text;
    const fingerprint = this.store.payloadHash({ id, text });
    const existing = () => this.store.db.prepare('SELECT id,payload_hash FROM commands WHERE device_id=? AND idempotency_key=?').get(deviceId, key) as { id: string; payload_hash: string } | undefined;
    const receipt = (prior: { id: string; payload_hash: string }) => {
      if (prior.payload_hash !== fingerprint) throw new DomainError('idempotency_conflict', 409);
      return this.store.command(prior.id);
    };
    const prior = existing();
    if (prior) return receipt(prior);
    const target = thread ? this.target(thread) : null;
    if (await this.state(id, target) !== 'ready') throw new DomainError('conversation_unavailable', 409);
    return this.store.db.transaction(() => {
      const duplicate = existing();
      if (duplicate) return receipt(duplicate);
      if (this.paused() || this.active(id) || thread && this.target(thread)?.runId !== target?.runId) throw new DomainError('conversation_unavailable', 409);
      const commandId = randomUUID();
      const reply: Reply = { sessionId: id, text: prompt, ...(target ? {runId:target.runId} : {}) };
      this.store.db.prepare(`INSERT INTO commands(id,task_id,device_id,idempotency_key,payload_hash,type,payload_json,scope_revision_id,state,created_at)
        VALUES(?,?,?,?,?,?,?,?,'queued',?)`).run(commandId, thread?.task_id ?? null, deviceId, key, fingerprint, commandType, JSON.stringify(reply), target?.scopeId ?? null, this.store.now());
      this.store.db.prepare('INSERT INTO outbox(command_id,next_attempt_at) VALUES(?,?)').run(commandId, this.store.now());
      return this.store.command(commandId);
    }).immediate();
  }

  async tick() {
    if (this.polling) return;
    this.polling = true;
    try {
      const rows = this.store.db.prepare(`SELECT c.* FROM outbox o JOIN commands c ON c.id=o.command_id
        WHERE c.type=? AND c.state IN ${pending} AND o.next_attempt_at<=? ORDER BY o.next_attempt_at,c.created_at LIMIT 12`).all(commandType, this.store.now()) as CommandRow[];
      for (const row of rows) {
        await this.advance(row).catch(() => { /* Retry receipt lookup without sending an uncertain command again. */ });
        this.store.db.prepare('UPDATE outbox SET next_attempt_at=MAX(next_attempt_at,?) WHERE command_id=?').run(this.store.now() + 750, row.id);
      }
    } finally { this.polling = false; }
  }
  private async advance(row: CommandRow) {
    const reply = JSON.parse(row.payload_json) as Reply;
    const attemptId = reply.attemptId ?? row.id;
    if (row.state === 'queued') {
      if (this.paused()) return;
      const external = savedHistory(reply.sessionId);
      const thread = external ? undefined : this.findThread(reply.sessionId);
      const target = thread && this.target(thread);
      if ((!external && (!target || target.runId !== reply.runId || target.scopeId !== row.scope_revision_id)) || !this.deviceActive(row.device_id)) {
        this.finish(row, reply, 'failed'); return;
      }
      let state: 'working' | 'ready' | 'unavailable';
      try { state = target ? await this.broker.replyState(target.runId) : await this.broker.historyReplyState(reply.sessionId); }
      catch (error) {
        if (error instanceof DomainError && refusedBeforeSend.has(error.code) && this.store.command(row.id).state === 'queued') this.finish(row, reply, 'failed',undefined,error.code);
        return;
      }
      if (state === 'working' || this.paused()) return;
      if (state !== 'ready') {
        if (this.store.command(row.id).state === 'queued') this.finish(row, reply, 'failed');
        return;
      }
      const dispatch = this.store.db.transaction(() => {
        if (!this.store.db.prepare("SELECT 1 FROM commands WHERE id=? AND state='queued'").get(row.id)) return false;
        if (this.paused() || !this.deviceActive(row.device_id) || target && this.target(this.thread(reply.sessionId))?.runId !== target.runId) throw new DomainError('conversation_unavailable');
        if (target) this.store.acquireLease(target.root, row.task_id!, row.id, row.id);
        this.store.db.prepare("UPDATE commands SET state='dispatching' WHERE id=?").run(row.id);
        return true;
      }).immediate();
      if (!dispatch) return;
      // Persist the send boundary first. A recovered dispatch only looks up the broker receipt.
      try {
        if (target) await this.broker.reply(target.runId, row.id, reply.text);
        else await this.broker.historyReply(reply.sessionId, attemptId, reply.text);
      }
      catch (error) {
        if (error instanceof DomainError && refusedBeforeSend.has(error.code) && (await this.broker.lookup(attemptId)).status === 'absent') {
          if (external && error.code === 'history_session_open') this.waitForSession(row,reply);
          else this.finish(row, reply, 'failed',undefined,error.code);
        }
        return;
      }
    }
    const run = await this.acceptedRun(attemptId,reply.sessionId);
    if (!run) {
      this.store.db.prepare("UPDATE commands SET state='reconciling' WHERE id=?").run(row.id);
      return;
    }
    const {ref,receipt} = run;
    const { state } = await this.broker.reconcile(ref.runId);
    if (state === 'succeeded') {
      const text = await this.answer(ref.runId);
      this.finish(row, reply, text.trim() ? 'succeeded' : 'failed', text);
    } else if (state === 'failed' && savedHistory(reply.sessionId) && receipt.result.errorCode === 'history_session_open') {
      // The broker recorded a provider refusal before any turn. Preserve this receipt and use a new attempt.
      this.waitForSession(row,{ ...reply, attemptId:randomUUID() });
    } else if (['interrupted', 'failed'].includes(state)) {
      const reason = receipt.result.errorCode;
      this.finish(row, reply, 'failed', undefined, typeof reason === 'string' && replyOutcomes.has(reason) ? reason : undefined);
    }
    else this.store.db.prepare('UPDATE commands SET state=?,error_code=NULL,accepted_at=COALESCE(accepted_at,?) WHERE id=?').run(
      ['starting', 'running'].includes(state) ? 'accepted' : 'reconciling', this.store.now(), row.id);
  }
  private waitForSession(row: CommandRow, reply: Reply) {
    this.store.db.transaction(() => {
      this.store.db.prepare("UPDATE commands SET state='queued',error_code='history_session_open',payload_json=? WHERE id=?").run(JSON.stringify(reply),row.id);
      const attempts = this.store.db.prepare('SELECT attempts FROM outbox WHERE command_id=?').get(row.id) as {attempts:number};
      const delay = Math.min(60000,10000 * 2 ** Math.min(attempts.attempts,3));
      this.store.db.prepare('UPDATE outbox SET next_attempt_at=?,attempts=attempts+1 WHERE command_id=?').run(this.store.now() + delay,row.id);
    }).immediate();
  }
  private async acceptedRun(commandId: string, sessionId: string) {
    const receipt = await this.broker.lookup(commandId);
    if (receipt.status !== 'accepted') return null;
    const ref = receipt.result.ref as RunRef | undefined;
    const original = this.store.db.prepare('SELECT provider_session_id FROM sessions WHERE id=?').get(sessionId) as {provider_session_id:string} | undefined;
    if (!ref || (savedHistory(sessionId) ? receipt.result.historyId !== sessionId : ref.sessionId !== original?.provider_session_id)) return null;
    return {ref,receipt};
  }
  private async answer(runId: string) {
    let text = '';
    let after = 0;
    for (let batch = 0; batch < 32 && text.length < answerLimit; batch++) {
      const events = await this.broker.events(runId,after);
      for (const {event} of events) if (event.type === 'message.delta') {
        if (typeof event.data.text === 'string') text += event.data.text;
        else {
          const blocks = (event.data.message as {content?:unknown} | undefined)?.content;
          if (Array.isArray(blocks)) text += blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
        }
      }
      if (events.length < 100) break;
      after = events.at(-1)!.sequence;
    }
    return text.slice(0,answerLimit);
  }
  private finish(row: CommandRow, reply: Reply, state: 'succeeded' | 'failed' | 'cancelled', text?: string, error?: string) {
    this.store.db.transaction(() => {
      if (state === 'succeeded' && text) this.store.event(reply.sessionId, 1, 'conversation.reply', { text }, `conversation.reply:${row.id}`);
      this.store.db.prepare('UPDATE commands SET state=?,resolved_at=?,error_code=? WHERE id=?').run(state, this.store.now(), error ?? null, row.id);
      this.store.db.prepare('DELETE FROM outbox WHERE command_id=?').run(row.id);
      this.store.db.prepare('DELETE FROM leases WHERE run_id=? AND broker_owner_nonce=?').run(row.id, row.id);
    }).immediate();
  }
}
