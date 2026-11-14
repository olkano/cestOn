import { test, expect } from '@playwright/test';
import { pair, localStore } from './helpers.js';

test('T04 T19 a lost creation acknowledgement survives reload and retries the original identity once explicitly', async ({ page }) => {
  await pair(page); await page.getByRole('link', { name: 'Work', exact: true }).click(); await page.getByRole('button', { name: 'New task', exact: true }).click(); await page.getByLabel('Task title').fill('Lost acknowledgement fixture'); await page.getByLabel('Desired outcome').fill('Create one synthetic artifact.');
  let key: string | undefined;
  let dropped!: () => void; const acknowledgementLost = new Promise<void>(resolve => { dropped = resolve; });
  await page.route('**/api/v1/commands', async route => { key = route.request().headers()['idempotency-key']; await route.fetch(); await route.abort('failed'); dropped(); });
  await page.getByRole('button', { name: 'Create task', exact: true }).click(); await acknowledgementLost; await expect(page.getByRole('button', { name: 'Check or retry this request' })).toBeVisible(); await page.reload();
  await expect(page.getByRole('button', { name: 'Check or retry this request' })).toBeVisible();
  const before = localStore(); try { expect(before.db.prepare("SELECT id FROM tasks WHERE title='Lost acknowledgement fixture'").all()).toHaveLength(1); } finally { before.close(); }
  await page.unroute('**/api/v1/commands'); const sent = page.waitForRequest(request => request.url().endsWith('/api/v1/commands'));
  await page.getByRole('button', { name: 'Check or retry this request' }).click(); expect((await sent).headers()['idempotency-key']).toBe(key); await expect(page.getByRole('button', { name: 'Check or retry this request' })).not.toBeVisible();
  const after = localStore(); try { expect(after.db.prepare("SELECT id FROM tasks WHERE title='Lost acknowledgement fixture'").all()).toHaveLength(1); } finally { after.close(); }
});
