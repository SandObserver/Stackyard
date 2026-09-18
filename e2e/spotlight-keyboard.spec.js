// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

const folder = { id: 'media', type: 'folder', label: 'Media', children: ['sonarr'], color: 'dark' };

test.beforeEach(async ({ page, request }) => {
  const apps = Array.from({ length: 60 }, (_, i) => app(`app${i}`, `App ${i}`));
  await seedConfig(request, { items: [folder, app('sonarr', 'Sonarr'), ...apps] });
  await dismissSetupPrompt(request);
  await page.goto('/');
  await page.locator('.icon').first().waitFor({ state: 'visible' });
});

for (const width of [1280, 600]) {
  test(`every letter typed to open search reaches the field at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.keyboard.type('sonarr', { delay: 0 });
    await expect(page.locator('#sin')).toBeFocused();
    await expect(page.locator('#sin')).toHaveValue('sonarr');
  });
}

test('Space on a focused folder opens the folder, not search', async ({ page }) => {
  await page.getByRole('button', { name: /Media/ }).first().focus();
  await page.keyboard.press(' ');
  await expect(page.locator('.folder-overlay')).toBeVisible();
  await expect(page.locator('#spot')).not.toHaveAttribute('open');
});

test('Escape straight after the opening key closes search', async ({ page }) => {
  await page.keyboard.press('s');
  await page.keyboard.press('Escape');
  await expect(page.locator('#spot')).not.toHaveAttribute('open');
});
