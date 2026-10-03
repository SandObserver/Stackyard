// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
});

test('Settings opens when the browser blocks site storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await openDashboardList(page);
  await expect(rowByName(page, 'Alpha')).toBeVisible();
});

/* Chromium only: listeners are counted through the DevTools protocol. */
test('reopening the app editor adds no document listeners', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs CDP');
  const cdp = await page.context().newCDPSession(page);
  const countClicks = async () => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.filter(l => l.type === 'click').length;
  };
  await openDashboardList(page);
  const open = async () => {
    await rowByName(page, 'Alpha').getByRole('button', { name: /^Edit/ }).click();
    await page.locator('#ip-in').waitFor({ state: 'visible' });
    await page.locator('#ev-back').click();
    await expect(page.locator('#dash-edit-view')).toBeHidden();
  };
  await open();
  const once = await countClicks();
  await open();
  await open();
  expect(await countClicks()).toBe(once);
});
