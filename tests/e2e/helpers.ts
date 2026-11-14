import { expect, type Page } from '@playwright/test';
import { Store } from '../../apps/server/src/db/store.js';
import { AuthService } from '../../apps/server/src/auth/service.js';
import { assertTestRoot } from '../../packages/test-support/src/index.js';
export function localStore() { const root = process.env.CESTON_E2E_ROOT!; assertTestRoot(root); return new Store(root, { testMode: true }); }
export async function pair(page: Page) {
  const store = localStore(); let invitation: string; try { invitation = new AuthService(store).invite(); } finally { store.close(); }
  await page.goto('/today'); await page.getByLabel('Pairing code').fill(invitation); await page.getByLabel('Device name').fill('Browser fixture'); await page.getByRole('button', { name: 'Connect device' }).click(); await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
}
export async function createTask(page: Page, title: string) {
  await page.getByRole('link', { name: 'Work', exact: true }).click(); await page.getByRole('button', { name: 'New task', exact: true }).click(); await page.getByLabel('Task title').fill(title); await page.getByLabel('Desired outcome').fill('Create a synthetic verified artifact for a browser test.'); await page.getByRole('button', { name: 'Create task', exact: true }).click(); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Accept verified outcome' })).toBeVisible();
}
