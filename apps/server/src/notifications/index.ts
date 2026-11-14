import type { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import * as webpush from 'web-push';
import type { Store, DecisionRow } from '../db/store.js';
import type { Protector } from '../security/protection.js';
import type { Config } from '../../../../packages/contracts/src/config.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';
import { subscriptionSchema } from '../../../../packages/contracts/src/http.js';
type Subscription = z.infer<typeof subscriptionSchema>;
type PushSender = (subscription: Subscription, payload: string) => Promise<number>;
export function configuredPush(config: Config): PushSender | null {
  const push = config.push; const secret = push.privateKeyEnv ? process.env[push.privateKeyEnv] : undefined;
  if (!push.enabled || !push.subject || !push.publicKey || !secret) return null;
  return async (subscription, payload) => { try { return (await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, { vapidDetails: { subject: push.subject!, publicKey: push.publicKey!, privateKey: secret }, timeout: 10000, TTL: 600, urgency: 'normal' })).statusCode; } catch (error) { const code = (error as { statusCode?: number }).statusCode; return code ?? 503; } };
}
export class NotificationService {
  private busy = false;
  get pushAvailable() { return this.send !== null; }
  constructor(private store: Store, private protection: Protector, private send: PushSender | null) { this.store.db.prepare("UPDATE notification_deliveries SET status='uncertain',last_error='restart_during_submission' WHERE status='submitting'").run(); }
  async subscribe(deviceId: string, input: unknown) {
    const value = subscriptionSchema.parse(input); const url = new URL(value.endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)) throw new DomainError('push_endpoint_denied', 403);
    const hash = createHash('sha256').update(value.endpoint).digest('hex'); const prior = this.store.db.prepare('SELECT id,device_id FROM push_subscriptions WHERE endpoint_hash=?').get(hash) as { id: string; device_id: string } | undefined;
    if (prior && prior.device_id !== deviceId) throw new DomainError('subscription_owner_mismatch', 403);
    const id = prior?.id ?? randomUUID(); const purpose = `push:${deviceId}:${id}`;
    const endpoint = await this.protection.seal(value.endpoint, `${purpose}:endpoint`); const keys = await this.protection.seal(JSON.stringify(value.keys), `${purpose}:keys`);
    this.store.db.prepare('INSERT INTO push_subscriptions(id,device_id,endpoint_encrypted,keys_encrypted,endpoint_hash,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint_encrypted=excluded.endpoint_encrypted,keys_encrypted=excluded.keys_encrypted,disabled_at=NULL').run(id, deviceId, endpoint, keys, hash, this.store.now());
    return { id };
  }
  async unsubscribe(deviceId: string, id: string) { const result = this.store.db.prepare('UPDATE push_subscriptions SET disabled_at=? WHERE id=? AND device_id=?').run(this.store.now(), id, deviceId); if (!result.changes) throw new DomainError('subscription_not_found', 404); }
  list() { return this.store.db.prepare('SELECT id,task_id AS taskId,decision_id AS decisionId,status,created_at AS createdAt,read_at AS readAt FROM notifications ORDER BY created_at DESC LIMIT 100').all() as { id: string; taskId: string; decisionId: string | null; status: string; createdAt: number; readAt: number | null }[]; }
  markRead(id: string) { const result = this.store.db.prepare('UPDATE notifications SET read_at=? WHERE id=?').run(this.store.now(), id); if (!result.changes) throw new DomainError('notification_not_found', 404); this.store.event(this.store.installation().id, this.store.installation().revision, 'notification.changed', { notificationId: id }); }
  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      this.store.db.transaction(() => {
        this.store.db.prepare("INSERT OR IGNORE INTO service_checkpoints(name,cursor) VALUES('notifications',0)").run(); const checkpoint = this.store.db.prepare("SELECT cursor FROM service_checkpoints WHERE name='notifications'").get() as { cursor: number };
        const events = this.store.events(checkpoint.cursor);
        for (const event of events) {
          if (event.type === 'decision.changed') { const payload = JSON.parse(event.sanitized_payload_json) as { decisionId: string }; const decision = this.store.db.prepare('SELECT * FROM decisions WHERE id=?').get(payload.decisionId) as DecisionRow | undefined;
            if (decision && decision.state === 'open' && decision.expires_at > this.store.now()) this.store.db.prepare("INSERT OR IGNORE INTO notifications(id,task_id,decision_id,dedup_key,status,created_at) VALUES(?,?,?,?,'unread',?)").run(randomUUID(), decision.task_id, decision.id, `decision:${decision.id}:${decision.revision}`, this.store.now()); }
          if (event.type === 'task.changed') { const payload = JSON.parse(event.sanitized_payload_json) as { state?: string }; if (['review_ready', 'blocked'].includes(payload.state ?? '')) this.store.db.prepare("INSERT OR IGNORE INTO notifications(id,task_id,dedup_key,status,created_at) VALUES(?,?,?,'unread',?)").run(randomUUID(), event.aggregate_id, `event:${event.event_id}`, this.store.now()); }
        }
        if (events.length) this.store.db.prepare("UPDATE service_checkpoints SET cursor=? WHERE name='notifications'").run(events.at(-1)!.sequence);
        this.store.db.prepare("INSERT OR IGNORE INTO notification_deliveries(notification_id,subscription_id,status,next_attempt_at) SELECT n.id,s.id,'pending',? FROM notifications n JOIN push_subscriptions s JOIN devices d ON d.id=s.device_id WHERE n.read_at IS NULL AND s.disabled_at IS NULL AND d.revoked_at IS NULL AND d.expires_at>? AND n.created_at>? ORDER BY n.created_at LIMIT 100").run(this.store.now(), this.store.now(), this.store.now() - 86400000);
      })();
      if (!this.send) return;
      const deliveries = this.store.db.prepare("SELECT q.notification_id,q.subscription_id,s.device_id,s.endpoint_encrypted,s.keys_encrypted,n.task_id,n.decision_id,q.attempts FROM notification_deliveries q JOIN push_subscriptions s ON s.id=q.subscription_id JOIN devices d ON d.id=s.device_id JOIN notifications n ON n.id=q.notification_id WHERE q.status='pending' AND q.attempts<3 AND q.next_attempt_at<=? AND s.disabled_at IS NULL AND d.revoked_at IS NULL AND d.expires_at>? AND n.read_at IS NULL LIMIT 20").all(this.store.now(), this.store.now()) as { notification_id: string; subscription_id: string; device_id: string; endpoint_encrypted: string; keys_encrypted: string; task_id: string; decision_id: string | null; attempts: number }[];
      for (const row of deliveries) {
        const purpose = `push:${row.device_id}:${row.subscription_id}`; let code = 503;
        this.store.db.prepare("UPDATE notification_deliveries SET status='submitting',attempts=attempts+1 WHERE notification_id=? AND subscription_id=?").run(row.notification_id, row.subscription_id);
        try { const endpoint = await this.protection.open(row.endpoint_encrypted, `${purpose}:endpoint`); const keys = JSON.parse(await this.protection.open(row.keys_encrypted, `${purpose}:keys`)) as Subscription['keys']; code = await this.send({ endpoint, keys }, JSON.stringify({ title: 'cestOn', body: row.decision_id ? 'cestOn needs a decision.' : 'cestOn has work for your review.', tag: row.notification_id, route: row.decision_id ? `/decisions/${row.decision_id}` : `/tasks/${row.task_id}` })); } catch { code = 503; }
        this.store.db.transaction(() => { if ([404, 410].includes(code)) this.store.db.prepare('UPDATE push_subscriptions SET disabled_at=? WHERE id=?').run(this.store.now(), row.subscription_id);
          const status = code >= 200 && code < 300 ? 'submitted' : row.attempts + 1 >= 3 || (code >= 400 && code < 500 && code !== 429) ? 'failed' : 'pending';
          this.store.db.prepare('UPDATE notification_deliveries SET status=?,next_attempt_at=?,last_error=? WHERE notification_id=? AND subscription_id=?').run(status, this.store.now() + 1000 * 2 ** (row.attempts + 1), status === 'submitted' ? null : `push_${code}`, row.notification_id, row.subscription_id);
        })();
      }
    } finally { this.busy = false; }
  }
}
