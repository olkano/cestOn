import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`T17 shell and keyboard theme controls at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'A clear place to direct your agents.' })).toBeVisible();
    for (const theme of ['dark', 'light']) {
      await page.getByLabel('Appearance').selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${theme}.png`), fullPage: true });
    }
    expect(await page.locator('.brand img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await page.getByLabel('Appearance').focus(); await page.keyboard.press('ArrowUp');
    await expect(page.getByLabel('Appearance')).toBeFocused();
  });
}
