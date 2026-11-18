import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/server/src/db/store.js';
import { createApp } from '../../apps/server/src/create-app.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

it('T18 every private route rejects unauthenticated callers, and writes reject forged origin, host and CSRF', async () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  const { app, auth } = await createApp({ store, origin: 'http://127.0.0.1:4317' });
  try {
    for (const path of ['me', 'snapshot', 'tasks', 'projects', 'devices', 'events', 'sessions', 'memory', 'memory/folders', 'history', 'general', 'health/ready', `managed-conversations/${randomUUID()}`, `evidence/${randomUUID()}`]) expect((await app.inject(`/api/v1/${path}`)).statusCode).toBe(401);
    const invitation = auth!.invite(); const body = { invitation, deviceName: 'Test' };
    const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/pairing/redeem', headers: { ...headers, origin: 'https://evil.invalid' }, payload: body })).statusCode).toBe(403);
    const enrolled = await app.inject({ method: 'POST', url: '/api/v1/pairing/redeem', headers, payload: body }); expect(enrolled.statusCode).toBe(200);
    const cookie = String(enrolled.headers['set-cookie']).split(';')[0]!; const csrf = enrolled.json().data.csrf as string;
    expect(enrolled.headers['set-cookie']).toContain('HttpOnly'); expect(enrolled.headers['set-cookie']).toContain('SameSite=Strict');
    expect((await app.inject({ url: '/api/v1/me', headers: { host: headers.host, cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: { host: 'evil.invalid', cookie } })).statusCode).toBe(403);
    for (const extra of [{}, { 'x-csrf-token': 'wrong' }, { 'x-csrf-token': csrf, origin: 'https://evil.invalid' }]) expect((await app.inject({ method: 'POST', url: '/api/v1/commands', headers: { ...headers, cookie, ...extra }, payload: {} })).statusCode).toBe(403);
    const deviceId = enrolled.json().data.deviceId as string;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}`, headers: { ...headers, cookie, 'x-csrf-token': csrf } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: { host: headers.host, cookie } })).statusCode).toBe(401);
  } finally { await app.close(); store.close(); cleanupTestRoot(t.root, t.runId); }
});
