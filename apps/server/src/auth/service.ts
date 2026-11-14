import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../db/store.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';

export type Device = { id: string; display_name: string; created_at: number; last_seen_at: number; expires_at: number; revoked_at: number | null; csrf_hash: string };
export class AuthService {
  private key: Buffer;
  private limits = new Map<string, { start: number; count: number }>();
  constructor(private store: Store) {
    const file = join(store.dataRoot, 'state', 'device-key');
    try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    this.key = readFileSync(file); if (this.key.length !== 32) throw new DomainError('device_key_invalid');
  }
  private hash(value: string) { return createHmac('sha256', this.key).update(value).digest('hex'); }
  csrf(token: string) { return this.hash(`csrf:${token}`); }
  invite() {
    const token = randomBytes(32).toString('base64url');
    this.store.db.prepare('INSERT INTO pairing_invitations VALUES(?,?,?,NULL)').run(this.hash(token), this.store.now(), this.store.now() + 600000);
    return token;
  }
  private limit(key: string, max: number, window: number, consume = true) {
    const now = this.store.now();
    for (const [id, record] of this.limits) if (now - record.start > Math.max(window, 900000)) this.limits.delete(id);
    const entry = this.limits.get(key) ?? { start: now, count: 0 };
    if (now - entry.start >= window) { entry.start = now; entry.count = 0; }
    if (entry.count >= max || (!this.limits.has(key) && this.limits.size >= 10000)) throw new DomainError('rate_limited', 429);
    if (consume) entry.count++; this.limits.set(key, entry);
  }
  commandLimit(deviceId: string) { this.limit(`command:${deviceId}`, 60, 60000); }
  redeem(invitation: string, name: string, source: string) {
    this.limit(`pair:${source}`, 5, 900000, false); this.limit('pair:installation', 5, 900000, false);
    try { return this.store.db.transaction(() => {
      if (typeof invitation !== 'string' || invitation.length > 100 || !name.trim() || name.length > 80) throw new DomainError('invalid_invitation', 401);
      const consumed = this.store.db.prepare('UPDATE pairing_invitations SET redeemed_at=? WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>?').run(this.store.now(), this.hash(invitation), this.store.now());
      if (!consumed.changes) throw new DomainError('invalid_invitation', 401);
      const token = randomBytes(32).toString('base64url'); const id = randomUUID(); const now = this.store.now(); const csrf = this.csrf(token);
      this.store.db.prepare('INSERT INTO devices(id,display_name,token_hash,created_at,last_seen_at,expires_at,csrf_hash) VALUES(?,?,?,?,?,?,?)').run(id, name.trim(), this.hash(token), now, now, now + 7 * 86400000, this.hash(csrf));
      return { token, csrf, device: this.device(id) };
    })(); } catch (error) { if (error instanceof DomainError && error.code === 'invalid_invitation') { this.limit(`pair:${source}`, 5, 900000); this.limit('pair:installation', 5, 900000); } throw error; }
  }
  device(id: string) { return this.store.db.prepare('SELECT id,display_name,created_at,last_seen_at,expires_at,revoked_at,csrf_hash FROM devices WHERE id=?').get(id) as Device; }
  authenticate(token: string | undefined): Device {
    if (!token || token.length !== 43) throw new DomainError('authentication_required', 401);
    const row = this.store.db.prepare('SELECT id FROM devices WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND created_at>?').get(this.hash(token), this.store.now(), this.store.now() - 30 * 86400000) as { id: string } | undefined;
    if (!row) throw new DomainError('authentication_required', 401);
    const device = this.device(row.id);
    this.store.db.prepare('UPDATE devices SET last_seen_at=?,expires_at=? WHERE id=?').run(this.store.now(), Math.min(this.store.now() + 7 * 86400000, device.created_at + 30 * 86400000), row.id);
    return this.device(row.id);
  }
  checkCsrf(device: Device, value: unknown) {
    if (typeof value !== 'string' || value.length !== 64 || !timingSafeEqual(Buffer.from(device.csrf_hash, 'hex'), Buffer.from(this.hash(value), 'hex'))) throw new DomainError('csrf_rejected', 403);
  }
  revoke(id: string) {
    this.store.db.transaction(() => {
      const row = this.store.db.prepare('UPDATE devices SET revoked_at=?,revision=revision+1 WHERE id=? AND revoked_at IS NULL').run(this.store.now(), id);
      if (!row.changes) throw new DomainError('device_not_found', 404);
      this.store.db.prepare('UPDATE push_subscriptions SET disabled_at=? WHERE device_id=?').run(this.store.now(), id);
      this.store.event(this.store.installation().id, this.store.installation().revision, 'device.revoked', { deviceId: id });
    })();
  }
  list() { return this.store.db.prepare('SELECT id,display_name AS displayName,last_seen_at AS lastSeenAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM devices ORDER BY created_at DESC LIMIT 100').all(); }
}
