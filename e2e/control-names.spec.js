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

test('the current Settings section is marked current', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('.nl[data-sec="appearance"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.mtab[data-sec="appearance"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nl[data-sec="general"]')).not.toHaveAttribute('aria-current');
});

test('Settings group titles are headings', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('#sec-general').getByRole('heading', { level: 2, name: 'Sprache' })).toBeVisible();
});

test('the selected colour swatch is announced as pressed', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha')
    .getByRole('button', { name: /^Bearbeiten/ })
    .click();
  const swatch = v => page.locator(`#icon-color-slot .cc-swatch[data-v="${v}"]`);
  await expect(swatch('dark')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('light')).toHaveAttribute('aria-pressed', 'false');
  await swatch('light').click();
  await expect(swatch('light')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('dark')).toHaveAttribute('aria-pressed', 'false');
  await swatch('custom').click();
  await expect(swatch('custom')).toHaveAttribute('aria-expanded', 'true');
  await expect(swatch('custom')).toHaveAttribute('aria-pressed', 'true');
  await swatch('red').click();
  await expect(swatch('red')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(swatch('custom')).toHaveAttribute('aria-expanded', 'true');
});

test('the Test result is announced', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha')
    .getByRole('button', { name: /^Bearbeiten/ })
    .click();
  await page.locator('label:has(#hc-type-ping)').click();
  await page.locator('#hc-ping-test').click();
  await expect(page.getByRole('status').filter({ hasText: /URL/ })).toHaveAttribute('id', 'hc-ping-status');
});

test('a Test that got no HTTP answer says why, in the page language', async ({ page }) => {
  await page.route('**/api/ping', route =>
    route.fulfill({
      json: { ok: false, status: 0, error: 'Connection refused.', kind: 'network', code: 'network.refused' },
    }),
  );
  await openDashboardList(page);
  await rowByName(page, 'Alpha')
    .getByRole('button', { name: /^Bearbeiten/ })
    .click();
  await page.locator('label:has(#hc-type-ping)').click();
  await page.locator('#ie-hc-ping .pe').click();
  await page.keyboard.type('http://192.168.1.10:1/');
  await page.keyboard.press('Enter');
  await page.locator('#hc-ping-test').click();
  await expect(page.locator('#hc-ping-status')).toHaveText(
    '✗ Der Host hat die Verbindung abgelehnt. Prüfen Sie den Port.',
  );
});
