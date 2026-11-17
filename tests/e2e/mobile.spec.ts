import { test, expect } from '@playwright/test';
import { pair, createTask, localStore } from './helpers.js';
test('U09 read aloud uses the displayed briefing only and its stop control cancels playback', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { value: { cancel() { (window as unknown as { cancelled: number }).cancelled = ((window as unknown as { cancelled: number }).cancelled ?? 0) + 1; }, speak(utterance: SpeechSynthesisUtterance) { (window as unknown as { spoken: string }).spoken = utterance.text; } } }); });
  await pair(page); await page.getByRole('link', { name: 'Assistant', exact: true }).click(); await page.getByLabel('Message to assistant', { exact: true }).fill('Give me the current overview.'); await page.getByRole('button', { name: 'Send', exact: true }).click(); const briefing = page.locator('.conversation p').last(); await expect(briefing).toContainText('synthetic fixture providers'); const displayed = await briefing.innerText(); await page.getByRole('button', { name: 'Read briefing aloud', exact: true }).click(); expect(await page.evaluate(() => (window as unknown as { spoken: string }).spoken)).toBe(displayed); await page.getByRole('button', { name: 'Stop playback', exact: true }).click(); await expect(page.getByRole('button', { name: 'Stop playback', exact: true })).not.toBeVisible(); expect(await page.evaluate(() => (window as unknown as { cancelled: number }).cancelled)).toBeGreaterThanOrEqual(2);
});

test('T21 T24 the production worker caches static assets only and restores an unsent draft after offline reload', async ({ page, context }) => {
  await pair(page); await createTask(page, 'Offline reload fixture');
  expect((await page.request.get('/sw.js')).status()).toBe(200);
  await expect.poll(() => page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); return registration?.active?.state ?? registration?.installing?.state ?? 'missing'; }), { timeout: 5000 }).toBe('activated');
  const manifest = await page.request.get('/manifest.webmanifest'); expect(await manifest.json()).toMatchObject({ id: '/', display: 'standalone', start_url: '/conversations' });
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); return (await Promise.all(keys.filter(key => key.startsWith('ceston-static-')).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat(); });
  expect(cached.some(url => url.includes('/assets/'))).toBe(true); expect(cached.some(url => url.includes('/api/'))).toBe(false);
  await page.getByRole('textbox', { name: 'Instruction for Offline reload fixture' }).fill('A private unsent offline draft.'); await page.getByRole('link', { name: 'Today', exact: true }).first().click(); await page.getByRole('link', { name: 'Offline reload fixture', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Instruction for Offline reload fixture' })).toHaveValue('A private unsent offline draft.');
  await context.setOffline(true); await page.reload(); await expect(page.getByRole('heading', { name: 'Your host is unavailable', exact: true })).toBeVisible(); await expect(page.getByLabel('Unsent offline draft')).toHaveValue('A private unsent offline draft.');
  await context.setOffline(false); await expect(page.getByRole('heading', { name: 'Offline reload fixture', exact: true })).toBeVisible();
  const store = localStore(); try { expect(store.db.prepare("SELECT id FROM commands WHERE type='task.instruct' AND payload_json LIKE '%private unsent offline%'").get()).toBeUndefined(); } finally { store.close(); }
});

test('T22 fake microphone capture transcribes to an editable unsent draft and cancel does not dispatch', async ({ page }) => {
  await pair(page); await createTask(page, 'Voice fixture');
  await page.getByRole('button', { name: 'Record message', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Recording 0:01' })).toBeVisible(); await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Instruction for Voice fixture' }); await expect(composer).toHaveValue('Synthetic voice instruction. Review this text before sending.');
  await page.getByRole('button', { name: 'Record message', exact: true }).click(); await expect(page.getByRole('button', { name: 'Cancel voice' })).toBeVisible(); await page.getByRole('button', { name: 'Cancel voice' }).click();
  await expect(composer).toHaveValue('Synthetic voice instruction. Review this text before sending.');
  const store = localStore(); try { expect(store.db.prepare("SELECT id FROM commands WHERE type='task.instruct' AND payload_json LIKE '%Synthetic voice instruction%'").get()).toBeUndefined(); } finally { store.close(); }
});

test('T22 denied microphone keeps the selected text composer usable', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic permission denial', 'NotAllowedError'); }; });
  await pair(page); await createTask(page, 'Denied microphone fixture'); await page.getByRole('button', { name: 'Record message', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Microphone permission was denied'); await page.getByRole('textbox', { name: 'Instruction for Denied microphone fixture' }).fill('Text still works.'); await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});
