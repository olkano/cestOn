import { afterEach, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../../apps/server/src/create-app.js';
import { Store } from '../../apps/server/src/db/store.js';
import { parseConfig } from '../../packages/contracts/src/config.js';
import { createTestRoot, cleanupTestRoot } from '../../packages/test-support/src/index.js';

const host = 'ceston.example.com';
const origin = 'https://' + host;
const issuer = 'https://fixture.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const email = 'owner@example.com';
const configInput = { publicOrigin: origin, cloudflareAccess: { team: 'fixture', audience, ownerEmails: [email] } };

afterEach(() => vi.unstubAllGlobals());

it('requires a valid Access assertion and creates a normal CSRF-protected session without a pairing code', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), alg: 'RS256', kid: 'fixture' };
  const loads = vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe(issuer + '/cdn-cgi/access/certs');
    return Response.json({ keys: [key] });
  });
  vi.stubGlobal('fetch', loads);
  const t = createTestRoot();
  const store = new Store(t.root, { testMode: true });
  try {
    const { app, auth } = await createApp({ store, config: parseConfig(configInput) });
    try {
      const issue = (change: { email?: string; iss?: string; aud?: string; exp?: string; forged?: boolean; type?: string } = {}) =>
        new SignJWT({ email: change.email ?? email, type: change.type ?? 'app' })
          .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
          .setSubject('fixture-owner').setIssuedAt().setIssuer(change.iss ?? issuer)
          .setAudience(change.aud ?? audience).setExpirationTime(change.exp ?? '10m')
          .sign(change.forged ? other.privateKey : privateKey);
      const me = (headers: Record<string, string>) => app.inject({ url: '/api/v1/me', headers: { host, ...headers } });
      expect((await me({ 'cf-access-authenticated-user-email': email })).statusCode).toBe(403);
      expect((await me({ 'cf-access-jwt-assertion': 'not-a-token' })).statusCode).toBe(403);
      for (const change of [
        { forged: true }, { email: 'other@example.com' }, { iss: 'https://different.cloudflareaccess.com' },
        { aud: 'b'.repeat(64) }, { exp: '-1m' }, { type: 'org' },
      ]) {
        expect((await me({ 'cf-access-jwt-assertion': await issue(change) })).statusCode).toBe(403);
      }
      const assertion = await issue();
      expect((await me({ host: 'other.example.com', 'cf-access-jwt-assertion': assertion })).statusCode).toBe(403);
      expect(auth!.list()).toHaveLength(0);
      const signed = await me({ 'cf-access-jwt-assertion': assertion });
      expect(signed.statusCode).toBe(200);
      const cookie = String(signed.headers['set-cookie']).split(';')[0]!;
      expect(signed.headers['set-cookie']).toEqual(expect.stringContaining('Secure'));
      expect(signed.headers['set-cookie']).toEqual(expect.stringContaining('HttpOnly'));
      expect((await me({ cookie })).statusCode).toBe(403);
      const headers = { host, origin, cookie, 'cf-access-jwt-assertion': assertion };
      expect((await me(headers)).json().data.deviceId).toBe(signed.json().data.deviceId);
      expect(auth!.list()).toHaveLength(1);
      const note = { id: 'b52a4883-7dfe-467b-ab45-ba864dce31db', revision: 0, text: 'Cloudflare session fixture', projectId: null, relatedProjectId: null, importance: null, dueAt: null, reviewAt: null };
      const write = (extra: Record<string, string>) => app.inject({ method: 'POST', url: '/api/v1/memory', headers: { ...headers, ...extra }, payload: note });
      expect((await write({})).statusCode).toBe(403);
      expect((await write({ origin: 'https://other.example.com', 'x-csrf-token': signed.json().data.csrf })).statusCode).toBe(403);
      expect((await write({ 'x-csrf-token': signed.json().data.csrf })).statusCode).toBe(200);
      const bypass = await app.inject({ method: 'POST', url: '/api/v1/pairing/redeem', headers: { host, origin }, payload: { invitation: auth!.invite(), deviceName: 'Fixture' } });
      expect(bypass.statusCode).toBe(403);
      const validWithCode = await app.inject({ method: 'POST', url: '/api/v1/pairing/redeem', headers, payload: { invitation: auth!.invite(), deviceName: 'Fixture' } });
      expect(validWithCode.statusCode).toBe(403);
      auth!.revoke(signed.json().data.deviceId);
      expect((await app.inject({ url: '/api/v1/snapshot', headers })).statusCode).toBe(403);
      const reconnected = await me(headers);
      expect(reconnected.statusCode).toBe(200);
      expect(reconnected.json().data.deviceId).not.toBe(signed.json().data.deviceId);
      expect(loads).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('only allows configured Cloudflare teams with an HTTPS application origin', () => {
  expect(() => parseConfig({ cloudflareAccess: configInput.cloudflareAccess })).toThrow();
  expect(() => parseConfig({ ...configInput, cloudflareAccess: { ...configInput.cloudflareAccess, team: 'https://example.com' } })).toThrow();
});
