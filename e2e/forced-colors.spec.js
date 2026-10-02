// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, openDashboardList, rowByName } = require('./helpers');

/** @param {import('@playwright/test').Locator} loc @param {string[]} props */
const styleOf = (loc, props, pseudo = null) =>
  loc.evaluate(
    (el, [p, ps]) => {
      const cs = getComputedStyle(el, ps);
      return Object.fromEntries(p.map(k => [k, cs.getPropertyValue(k)]));
    },
    /** @type {[string[], string|null]} */ ([props, pseudo]),
  );

test.describe('forced colors', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium emulates forced colors');
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
  });

  test('a Settings switch keeps its outline and shows on and off differently', async ({ page, request }) => {
    await seedConfig(request, { items: [app('alpha', 'Alpha')] });
    await page.goto('/admin/');
    await page.locator('body.authed').waitFor({ state: 'attached' });
    const input = page.locator('#set-awake');
    const track = page.locator('#set-awake + .tr');
    const read = async () => ({
      track: await styleOf(track, ['background-color', 'border-top-style']),
      knob: await styleOf(track, ['background-color'], '::after'),
    });
    await input.evaluate(el => {
      /** @type {HTMLInputElement} */ (el).checked = false;
    });
    const off = await read();
    await input.evaluate(el => {
      /** @type {HTMLInputElement} */ (el).checked = true;
    });
    const on = await read();
    expect(off.track['border-top-style']).toBe('solid');
    expect(on.track['background-color']).not.toBe(off.track['background-color']);
    expect(on.knob['background-color']).not.toBe(on.track['background-color']);
    expect(off.knob['background-color']).not.toBe(off.track['background-color']);
  });

  test('the search row Enter opens is outlined', async ({ page, request }) => {
    await seedConfig(request, { items: [app('one', 'Sonarr'), app('two', 'Radarr')] });
    await dismissSetupPrompt(request);
    await page.goto('/');
    await page.locator('.icon').first().waitFor({ state: 'visible' });
    await page.keyboard.type('arr');
    await expect(page.locator('#sin')).toHaveValue('arr');
    await page.keyboard.press('ArrowDown');
    const sel = page.locator('.sr.sel');
    await expect(sel).toHaveCount(1);
    expect((await styleOf(sel, ['outline-style']))['outline-style']).toBe('solid');
  });

  test('the first-run password field shows its edge and its focus', async ({ page, request }) => {
    await seedConfig(request, { items: [] });
    /* Once dismissed, the server never offers the prompt again. */
    await page.route('**/api/auth/check', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), setupPrompted: false, passwordSet: false } });
    });
    await page.goto('/');
    const field = page.locator('.setup-pw').first();
    await field.waitFor({ state: 'visible' });
    expect((await styleOf(field, ['border-top-style']))['border-top-style']).toBe('solid');
    await field.focus();
    expect((await styleOf(field, ['outline-style']))['outline-style']).toBe('solid');
  });
});

test('the icon search field draws a focus ring', async ({ page, request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /edit/i }).click();
  const field = page.locator('#ip-in');
  await field.focus();
  expect((await styleOf(field, ['outline-style']))['outline-style']).toBe('solid');
});
