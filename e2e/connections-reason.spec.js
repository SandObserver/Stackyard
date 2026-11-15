// @ts-check

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const reading = reason => ({
  services: [
    {
      id: 'gluetun-0',
      type: 'gluetun',
      name: 'Gluetun',
      color: '#30D158',
      kind: 'point',
      lat: 52.37,
      lng: 4.89,
      city: 'Amsterdam',
      country: 'Netherlands',
    },
    {
      id: 'umami-1',
      type: 'umami',
      name: 'Umami',
      color: '#3CD3FE',
      adminUrl: 'http://umami.invalid',
      error: reason,
      errorKind: 'auth',
    },
  ],
  meta: { showLegend: true, href: '' },
});

/** @param {import('@playwright/test').Page} page @param {string[]} reasons one per fetch, the last repeats */
async function stub(page, reasons) {
  let n = 0;
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/widget-data/net-map*', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(reading(reasons[Math.min(n++, reasons.length - 1)])),
    }),
  );
}

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ request }) => {
  await seedConfig(request, {
    items: [
      {
        id: 'net-map',
        type: 'widget',
        widgetType: 'connections',
        label: 'Net',
        widgetSize: 'medium',
        widgetConfig: { view: 'map', services: [{ type: 'umami', name: 'Umami', url: 'http://umami.invalid' }] },
      },
    ],
  });
  await dismissSetupPrompt(request);
});

test('a failed service names its kind and opens its reason without covering itself', async ({ page }) => {
  await stub(page, ['Auth rejected, check the password']);
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="net-map"]');
  const item = frame.getByRole('button', { name: 'Umami, Key rejected' });
  await expect(item).toHaveAccessibleDescription('Auth rejected, check the password');
  await expect(item).toHaveAttribute('aria-expanded', 'false');

  const pop = frame.locator('#why');
  await expect(pop).toBeHidden();
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
  await expect(pop.locator('.pop-kind')).toHaveText('Key rejected');
  await expect(pop.locator('.pop-msg')).toHaveText('Auth rejected, check the password');
  await expect(pop.locator('.pop-msg')).toHaveAttribute('lang', 'en');
  await expect(pop.getByRole('button', { name: 'open admin' })).toBeVisible();

  const a = await item.boundingBox();
  const b = await pop.boundingBox();
  expect(a && b).toBeTruthy();
  if (a && b) {
    const apart = b.y + b.height <= a.y || b.y >= a.y + a.height || b.x + b.width <= a.x || b.x >= a.x + a.width;
    expect(apart, 'the popover covers its own item').toBe(true);
  }

  await item.click();
  await expect(pop).toBeHidden();
  await expect(item).toHaveAttribute('aria-expanded', 'false');
});

test('Escape closes the reason and puts focus back on its item', async ({ page }) => {
  await stub(page, ['Auth rejected, check the password']);
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="net-map"]');
  const item = frame.getByRole('button', { name: 'Umami, Key rejected' });
  const pop = frame.locator('#why');
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(pop).toBeVisible();

  await pop.getByRole('button', { name: 'open admin' }).focus();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(item).toBeFocused();
});

test('the reason stays open on its item across a refresh and shows the new reading', async ({ page }) => {
  await stub(page, ['Auth rejected, check the password', 'Umami asks for a two-factor code']);
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="net-map"]');
  const item = frame.getByRole('button', { name: 'Umami, Key rejected' });
  const pop = frame.locator('#why');
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(pop.locator('.pop-msg')).toHaveText('Auth rejected, check the password');
  const admin = pop.getByRole('button', { name: 'open admin' });
  await admin.focus();

  await frame.locator('html').evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__setPollRate(0.0001);
    w.__setPollRate(1);
  });
  await expect(pop.locator('.pop-msg')).toHaveText('Umami asks for a two-factor code');
  await expect(pop).toBeVisible();
  await expect(item).toHaveAttribute('aria-expanded', 'true');
  await expect(item).toHaveAccessibleDescription('Umami asks for a two-factor code');
  await expect(admin).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(item).toBeFocused();
});
