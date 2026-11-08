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

const openSettings = async (browser, baseURL) => {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await page.goto('/admin/');
  await expect(page.locator('body.authed')).toBeAttached();
  return page;
};

const setField = (page, id, value) =>
  page.evaluate(
    ([field, v]) => {
      const node = /** @type {HTMLInputElement} */ (document.getElementById(field));
      node.value = v;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [id, value],
  );

const saveGeneral = async page => {
  const saved = page.waitForResponse(r => r.url().endsWith('/api/config') && r.request().method() === 'POST');
  await expect(page.locator('#srv-save')).toBeEnabled();
  await page.evaluate(() => document.getElementById('srv-save')?.click());
  return saved;
};

test('two Settings pages saving different fields keep both', async ({ browser, baseURL, request }) => {
  const a = await openSettings(browser, baseURL);
  const b = await openSettings(browser, baseURL);
  await setField(a, 'log-level', 'debug');
  await saveGeneral(a);
  await setField(b, 'srv-ip', '10.0.0.9');
  await saveGeneral(b);
  const { settings } = await (await request.get('/api/config')).json();
  expect(settings.logLevel).toBe('debug');
  expect(settings.server.hostIp).toBe('10.0.0.9');
});

test('a stale Settings page cannot overwrite the same field', async ({ browser, baseURL, request }) => {
  const a = await openSettings(browser, baseURL);
  const b = await openSettings(browser, baseURL);
  await setField(a, 'srv-ip', '10.0.0.1');
  await saveGeneral(a);
  await setField(b, 'srv-ip', '10.0.0.2');
  await expect(b.locator('#srv-save')).toBeEnabled();
  await b.evaluate(() => document.getElementById('srv-save')?.click());
  await expect(b.getByText('This setting was changed elsewhere.')).toBeVisible();
  const { settings } = await (await request.get('/api/config')).json();
  expect(settings.server.hostIp).toBe('10.0.0.1');
});
