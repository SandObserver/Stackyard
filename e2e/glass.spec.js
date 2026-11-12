// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const WALLPAPER = { type: 'url', url: '/icons/wallpaper/none.png', brightness: 1, fit: 'fill' };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER } } });
  await dismissSetupPrompt(request);
});

/* A browser without WebGL2 keeps the CSS glass and the CSS page turn. One with
   it draws the glass and turns pages on the frame clock. Half of each is a
   page that turns without moving, or glass that trails its element. */
test('the page turn belongs to whichever draws the glass', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body.ready')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas.glass-canvas');
        const live = document.documentElement.hasAttribute('data-glass-live');
        const turn = getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('pages'))).transitionDuration;
        return live ? !!canvas && turn === '0s' : turn === '0.28s';
      }),
    )
    .toBe(true);
});

test('Reduce Transparency on this device gives solid surfaces on both pages', async ({ page }) => {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  const toggle = page.locator('label.tog:has(#dev-transparency)');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduce');
  expect(await page.evaluate(() => localStorage.getItem('sy-transparency'))).toBe('reduce');

  await page.goto('/');
  await expect(page.locator('body.ready')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduce');
  await expect(page.locator('html')).not.toHaveAttribute('data-glass-live', '');
  expect(
    await page.evaluate(
      () => getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('dots'))).backdropFilter,
    ),
  ).toBe('none');

  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  await page.locator('label.tog:has(#dev-transparency)').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-transparency', 'reduce');
});
