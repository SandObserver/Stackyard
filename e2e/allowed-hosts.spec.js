// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig } = require('./helpers');
const { BASE_URL } = require('./base-url');

const PROTECTED = { enabled: true, authenticated: true, passwordSet: true };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [] });
});

async function openGeneral(page, origin) {
  await page.goto(`${origin}/admin/`);
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="general"]').click();
}

test('signed in on an unlisted name, Settings offers to list it', async ({ page }) => {
  const name = 'dash.example.test';
  await page.route(`http://${name}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/check') return route.fulfill({ json: PROTECTED });
    const response = await route.fetch({ url: `${BASE_URL}${url.pathname}${url.search}` });
    return route.fulfill({ response });
  });
  await openGeneral(page, `http://${name}`);

  await expect(page.locator('#hosts-add-name')).toHaveText(name);
  await expect(page.locator('#hosts-add-tip')).toBeVisible();
  await page.locator('#hosts-add').click();
  await expect(page.locator('#ie-hosts-v')).toHaveText(name);
  await expect(page.locator('#hosts-add-wrap')).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('#ie-hosts .pe')).toBeFocused();
  await expect(page.locator('#srv-save')).toBeEnabled();
});

test('on a local address Settings offers nothing', async ({ page }) => {
  await page.route('**/api/auth/check', route => route.fulfill({ json: PROTECTED }));
  await openGeneral(page, BASE_URL);
  await expect(page.locator('#sec-en')).toBeChecked();
  await expect(page.locator('#hosts-add-wrap')).not.toHaveClass(/\bopen\b/);
});
