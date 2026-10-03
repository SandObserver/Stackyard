// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, readConfig } = require('./helpers');

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

test('with Type to Search off, typing does not open search', async ({ page, request }) => {
  await seedConfig(request, { items: [folder, app('sonarr', 'Sonarr')], settings: { typeToSearch: false } });
  await page.goto('/');
  await page.locator('.icon').first().waitFor({ state: 'visible' });
  await page.keyboard.type('sonarr', { delay: 0 });
  await page.waitForTimeout(300);
  await expect(page.locator('#spot')).not.toHaveAttribute('open');
});

test('the Type to Search switch in Settings stores the choice', async ({ page, request }) => {
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="appearance"]').click();
  const sw = page.getByRole('checkbox', { name: 'Type to Search' });
  await expect(sw).toBeChecked();
  await sw.focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readConfig(request)).settings.typeToSearch).toBe(false);
});
