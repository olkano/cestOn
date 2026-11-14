import { test, expect } from '@playwright/test';
import { pair, createTask, localStore } from './helpers.js';

test('U04 U07 U08 real API and separate broker verify a task, preserve offline draft, and accept review', async ({ page, context }) => {
  await pair(page); await createTask(page, 'Browser verified result');
  await expect(page.getByRole('link', { name: 'Download verified artifact' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect changes' }).click(); await expect(page.getByRole('heading', { name: 'result.txt', exact: true })).toBeVisible(); await expect(page.locator('.diff pre').last()).toHaveText('Synthetic cestOn fixture artifact for ' + page.url().split('/').at(-1) + '.');
  const composer = page.getByRole('textbox', { name: 'Instruction for Browser verified result' });
  await context.setOffline(true); await expect(page.getByText('Your host is unavailable.', { exact: false })).toBeVisible();
  await composer.fill('Keep this unsent while offline.'); await page.getByRole('link', { name: 'Today', exact: true }).first().click(); await page.getByRole('link', { name: 'Browser verified result', exact: true }).click(); await expect(composer).toHaveValue('Keep this unsent while offline.');
  await context.setOffline(false); await expect(page.locator('footer .connection')).toContainText('connected');
  const store = localStore(); try { expect(store.db.prepare("SELECT 1 FROM commands WHERE type='task.instruct' AND payload_json LIKE '%Keep this unsent%'").get()).toBeUndefined(); } finally { store.close(); }
  await page.getByRole('button', { name: 'Accept verified outcome' }).click(); await expect(page.locator('.status-completed').or(page.locator('.card .badge').filter({ hasText: /^completed$/ }))).toBeVisible();
});

test('U06 U15 a phone answers the displayed exact decision and device revocation removes private data', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await pair(page); await createTask(page, 'Decision fixture');
  const id = page.url().split('/').at(-1)!; const store = localStore();
  try { store.db.transaction(() => { store.changeTask(id, 'queued', 'Synthetic decision rehearsal.'); store.createDecision(id, 'Which synthetic direction?', [{ id: 'first', label: 'First route', meaning: 'Preserve the initial route.' }, { id: 'second', label: 'Second route', meaning: 'Use the second synthetic route.' }], Date.now() + 600000); })(); } finally { store.close(); }
  await expect(page.getByRole('heading', { name: 'Your decision' })).toBeVisible(); await page.getByRole('button', { name: 'Second route Use the second synthetic route.' }).click(); await expect(page.getByRole('heading', { name: 'Your decision' })).not.toBeVisible();
  const check = localStore(); try { expect((check.db.prepare('SELECT chosen_option_id FROM decisions WHERE task_id=?').get(id) as { chosen_option_id: string }).chosen_option_id).toBe('second'); } finally { check.close(); }
  await page.getByRole('link', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Revoke Browser fixture' }).first().click();
  await expect(page.getByRole('heading', { name: 'Connect this device' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Devices', exact: true })).not.toBeVisible();
});
