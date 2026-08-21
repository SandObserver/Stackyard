// @ts-check
/* The wallpaper fit reaches the dashboard.

   The chain has four links: the dropdown writes a hidden field, the save reads
   it, the dashboard maps it to a CSS custom property, and the wallpaper layer
   reads that property. A break anywhere leaves the setting looking present and
   doing nothing, which is exactly what cannot be seen from the admin page. */

const { test, expect } = require('@playwright/test');
const { seedConfig, readConfig, dismissSetupPrompt } = require('./helpers');

const WALLPAPER = { type: 'url', url: '/icons/wallpaper/none.png', brightness: 1, fit: 'fill' };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER } } });
  await dismissSetupPrompt(request);
});

/* The page fills these fields from the config after it loads, so a click before
   that lands is overwritten. Waiting for the stored URL to appear is waiting
   for the load. */
async function openAppearance(page) {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  await page.locator('#bg-fit-btn').waitFor({ state: 'visible' });
  await expect(page.locator('#ie-bgurl-v')).toContainText('/icons/wallpaper/');
}

test('choosing Fit and saving stores it', async ({ page, request }) => {
  await openAppearance(page);
  await page.locator('#bg-fit-btn').click();
  await page.locator('#bg-fit-list li[data-val="fit"]').click();
  await expect(page.locator('#bg-fit-list li[data-val="fit"]')).toHaveAttribute('aria-selected', 'true');
  const saved = page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST');
  await page.locator('#bg-save').click();
  expect((await saved).ok()).toBeTruthy();

  const cfg = await readConfig(request);
  expect(cfg.settings.background.fit).toBe('fit');
});

test('the saved choice is shown again when the page is reopened', async ({ page, request }) => {
  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER, fit: 'fit' } } });
  await openAppearance(page);
  await expect(page.locator('#bg-fit-list li[data-val="fit"]')).toHaveAttribute('aria-selected', 'true');
});

test('the settings pages show the wallpaper the same way the dashboard does', async ({ page, request }) => {
  const sizeOnAdmin = async () => {
    await page.goto('/admin/');
    await page.locator('.nl[data-sec="appearance"]').click();
    await expect(page.locator('#ie-bgurl-v')).toContainText('/icons/wallpaper/');
    return page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundSize);
  };

  expect(await sizeOnAdmin()).toBe('cover');

  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER, fit: 'fit' } } });
  expect(await sizeOnAdmin()).toBe('contain');
});

test('fill covers the viewport and fit shows the whole image', async ({ page, request }) => {
  /* The wallpaper is applied after the page has built its tiles, so this is a
     value to wait for, not one to read once. */
  const expectSize = async want => {
    await page.goto('/');
    await page.locator('#pages').waitFor();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement, '::before').backgroundSize))
      .toBe(want);
  };

  await expectSize('cover');

  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER, fit: 'fit' } } });
  await expectSize('contain');
});
