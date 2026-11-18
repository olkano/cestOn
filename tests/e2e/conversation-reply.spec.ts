import { test, expect } from '@playwright/test';
import { createTask, localStore, pair } from './helpers.js';

test('replies inline to the same managed thread and remembers the result', async ({ page, context }, info) => {
  await pair(page);
  await createTask(page, 'Managed conversation for replies');
  await page.getByRole('link', { name: 'Chats' }).click();
  await page.getByRole('button', { name: /Managed conversation for replies/ }).click();
  const prompt = page.getByRole('textbox', { name: 'Your reply' });
  await expect(prompt).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Continue conversation' })).toHaveCount(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Appearance').selectOption(theme);
      await expect(prompt).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`reply-${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Appearance').selectOption('dark');
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await prompt.fill('What did the fixture verify?');
  await context.setOffline(false);
  await expect(prompt).toHaveValue('What did the fixture verify?');
  await expect(page.locator('.conversation').getByText('What did the fixture verify?', { exact: true })).toHaveCount(0);
  await prompt.press('Tab');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Synthetic worker result. Verification is required.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Managed conversation for replies/ }).click();
  await expect(page.getByText('What did the fixture verify?', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Synthetic worker result. Verification is required.', { exact: true })).toHaveCount(1);
  const store = localStore();
  try {
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE type='conversation.reply' AND payload_json LIKE '%What did the fixture verify?%'").get()).toEqual({ n: 1 });
  } finally { store.close(); }
});
