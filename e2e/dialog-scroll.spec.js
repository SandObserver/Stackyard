// @ts-check

const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName } = require('./helpers');

const scrollY = page => page.evaluate(() => Math.round(window.scrollY));

test.use({ viewport: { width: 1280, height: 400 } });

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
});

/** Wheel at each point and expect the page not to move.
    @param {import('@playwright/test').Page} page @param {[number, number][]} points */
async function expectPageHeld(page, points) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(room, 'the page behind is tall enough to scroll').toBeGreaterThan(300);
  for (const [x, y] of points) {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(400);
    expect(await scrollY(page), `a wheel at ${x},${y} scrolled the page behind`).toBe(0);
  }
}

/** @param {import('@playwright/test').Page} page */
async function expectPageScrolls(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(20, 200);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
}

test('a wheel over a Settings dialog or its backdrop leaves the page behind still', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /^Edit/ }).click();
  await page.locator('#ev-delete').click();
  const dialog = page.locator('dialog.dlg-box');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (!box) throw new Error('the dialog has no box');

  await expectPageHeld(page, [
    [20, 200],
    [box.x + box.width / 2, box.y + 20],
  ]);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expectPageScrolls(page);
});

test('a wheel over the sign-in screen shown mid-session leaves the page behind still', async ({ page }) => {
  let refused = false;
  await page.route('**/api/config', route => {
    if (route.request().method() !== 'POST' || refused) return route.fallback();
    refused = true;
    return route.fulfill({ status: 401, json: { error: 'Unauthorised', kind: 'auth' } });
  });
  await page.route('**/api/auth/login', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="appearance"]').click();
  await page.locator('#set-awake').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#login-pw')).toBeFocused();

  await expectPageHeld(page, [
    [20, 200],
    [640, 200],
  ]);

  await page.locator('#login-pw').fill('anything');
  await page.keyboard.press('Enter');
  await expect(page.locator('#login-screen')).toBeHidden();
  await expectPageScrolls(page);
});
