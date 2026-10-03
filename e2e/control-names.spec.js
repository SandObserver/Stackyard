// @ts-check
/* Accessible names as the browser computes them, not as the markup spells them. */

const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName } = require('./helpers');

async function openSection(page, sec) {
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator(`.nl[data-sec="${sec}"]`).click();
}

test.beforeEach(async ({ request }) => {
  await seedConfig(request, {
    items: [{ ...app('alpha', 'Alpha'), monitoring: { healthcheck: { enabled: true, container: 'alpha' } } }],
    settings: { language: 'de' },
  });
});

test('pencil buttons are named after their row in the page language', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('#ie-ip .pe')).toHaveAccessibleName('Host-IP bearbeiten');
});

test('a picker is named by its setting and its value', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('#lang-btn')).toHaveAccessibleName('Sprache Deutsch');
});

test('the wallpaper file input is not a separate unnamed stop', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('#bg-upload')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#bg-upload')).toHaveAttribute('aria-hidden', 'true');
});

test('the sidebar brand link is named by its visible text first', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('.sb-brand')).toHaveAccessibleName(/^Stackyard\b.*Zurück/);
});

test('the custom widget fullscreen switch is named', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  await expect(page.locator('#if-fs')).toHaveAccessibleName('Vollbild erlauben');
});

test('the health check type radios are grouped under their label', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha')
    .getByRole('button', { name: /^Bearbeiten/ })
    .click();
  const group = page.getByRole('group').filter({ has: page.locator('#hc-type-con') });
  await expect(group).toHaveAccessibleName('Typ');
});

test('picker names start with the label shown beside them', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('#bg-type-btn')).toHaveAccessibleName(/^Quelle /);
});

test('the icon file input is not a separate unnamed stop', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await expect(page.locator('#ip-upload')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#ip-upload')).toHaveAttribute('aria-hidden', 'true');
});

test('the import buttons show a focus ring', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit tabs only to text fields by default');
  await openSection(page, 'general');
  await page.locator('#imp').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const outline = await page.locator('#imp').evaluate(e => getComputedStyle(e.closest('.btn')).outlineStyle);
  expect(outline).toBe('solid');
});
