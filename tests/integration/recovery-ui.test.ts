import { request } from 'node:http';
import { it, expect } from 'vitest';
import { recoveryInterface } from '../../apps/supervisor/src/recovery-ui.js';
it('T34 the loopback recovery interface is read-only, Host-bound and escapes its sanitized metadata', async () => {
  let reads = 0; const page = await recoveryInterface(async () => { reads++; return { state: 'frozen_recovery', current: '<script>synthetic</script>', previous: 'prior', releases: [{ id: 'prior', integrity: 'verified' }], backups: [{ name: 'synthetic', verification: 'failed' }] }; });
  try { const response = await fetch(page.url); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); const html = await response.text(); expect(html).toContain('Dispatch stays frozen'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>synthetic'); expect(response.headers.get('content-security-policy')).toContain("form-action 'none'"); expect((await fetch(page.url, { method: 'POST' })).status).toBe(403); const denied = await new Promise<number>(done => { request(page.url, { headers: { Host: 'foreign.invalid' } }, response => { response.resume(); done(response.statusCode!); }).end(); }); expect(denied).toBe(403); expect(reads).toBe(1); }
  finally { await page.close(); }
});
