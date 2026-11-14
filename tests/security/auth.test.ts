import { it, expect } from 'vitest';
import { Store } from '../../apps/server/src/db/store.js';
import { AuthService } from '../../apps/server/src/auth/service.js';
import { createTestRoot, cleanupTestRoot, FakeClock } from '../../packages/test-support/src/index.js';

it('T18 pairing is single use, sessions expire, and revocation invalidates cookies immediately', () => {
  const t = createTestRoot(); const clock = new FakeClock(); const store = new Store(t.root, { testMode: true, now: () => clock.now });
  try {
    const auth = new AuthService(store); const invitation = auth.invite();
    const enrolled = auth.redeem(invitation, 'Phone', 'test');
    expect(() => auth.redeem(invitation, 'Second', 'test')).toThrow('invalid_invitation');
    const device = auth.authenticate(enrolled.token); expect(device.id).toBe(enrolled.device.id);
    expect(auth.csrf(enrolled.token)).toBe(enrolled.csrf);
    expect(() => auth.checkCsrf(device, 'wrong')).toThrow('csrf_rejected');
    auth.checkCsrf(device, enrolled.csrf); auth.revoke(device.id);
    expect(() => auth.authenticate(enrolled.token)).toThrow('authentication_required');
    const next = auth.redeem(auth.invite(), 'Desktop', 'test'); clock.advance(7 * 86400000 + 1);
    expect(() => auth.authenticate(next.token)).toThrow('authentication_required');
    const expired = auth.invite(); clock.advance(600001);
    expect(() => auth.redeem(expired, 'Expired', 'test')).toThrow('invalid_invitation');
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});

it('T18 invitation guessing and per-device command bursts are capped', () => {
  const t = createTestRoot(); const store = new Store(t.root, { testMode: true });
  try {
    const auth = new AuthService(store);
    for (let i = 0; i < 5; i++) expect(() => auth.redeem('invalid', 'Phone', 'test')).toThrow('invalid_invitation');
    expect(() => auth.redeem(auth.invite(), 'Phone', 'test')).toThrow('rate_limited');
    for (let i = 0; i < 60; i++) auth.commandLimit('device');
    expect(() => auth.commandLimit('device')).toThrow('rate_limited');
  } finally { store.close(); cleanupTestRoot(t.root, t.runId); }
});
