// @ts-check
/* The Weather alert capsule, driven in the dashboard frame it ships in. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const reading = {
  temp: 24,
  units: 'c',
  code: 0,
  isDay: true,
  usedFeels: false,
  city: 'Delhi, Delhi, India',
  alerts: [{ kind: 'uv', value: 8, band: 'veryHigh', level: 3 }],
};

const widget = (id, widgetConfig = {}) => ({
  id,
  type: 'widget',
  label: 'Weather',
  widgetType: 'weather',
  widgetSize: 'small',
  widgetConfig: { city: reading.city, lat: 28.65, lon: 77.23, ...widgetConfig },
});

/** @param {import('@playwright/test').Page} page @param {object} body */
async function stub(page, body = reading) {
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/widget-data/wx-*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** @param {import('@playwright/test').Page} page @param {string} id */
async function open(page, id) {
  await page.goto('/');
  const frame = page.frameLocator(`iframe[src*="${id}"]`);
  await expect(frame.locator('#aq')).toBeVisible();
  return frame;
}

const capsule = frame => frame.locator('.aq-cap');

test.use({ reducedMotion: 'reduce' });

test.describe('pointer', () => {
  test.beforeEach(async ({ page, request }) => {
    await seedConfig(request, { items: [widget('wx-plain')] });
    await dismissSetupPrompt(request);
    await stub(page);
  });

  test('hover shows the reading and Escape hides it while focus stays on the dashboard', async ({ page }) => {
    const frame = await open(page, 'wx-plain');
    await expect(capsule(frame)).toBeHidden();
    await frame.locator('#widget').hover();
    await expect(capsule(frame)).toBeVisible();
    await expect(frame.locator('#aq-val')).toHaveText('UV 8');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');

    await page.keyboard.press('Escape');
    await expect(capsule(frame)).toBeHidden();

    await page.mouse.move(0, 0);
    await frame.locator('#widget').hover();
    await expect(capsule(frame)).toBeVisible();
  });

  test('a card without a link takes keyboard focus only while it shows an alert', async ({ page }) => {
    const frame = await open(page, 'wx-plain');
    await expect(frame.locator('#widget')).toHaveAttribute('tabindex', '0');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await frame.locator('#widget').evaluate(el => el === document.activeElement)) break;
    }
    await expect(frame.locator('#widget')).toBeFocused();
    await expect(capsule(frame)).toBeVisible();
  });
});

test('a card without a link and without an alert is not a tab stop', async ({ page, request }) => {
  await seedConfig(request, { items: [widget('wx-calm')] });
  await dismissSetupPrompt(request);
  await stub(page, { ...reading, alerts: undefined });
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="wx-calm"]');
  await expect(frame.locator('#temp')).not.toBeEmpty();
  await expect(frame.locator('#widget')).not.toHaveAttribute('tabindex', /.*/);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('a tap on the icon shows the reading for 4 s and does not open the card link', async ({ page, request }) => {
    await seedConfig(request, { items: [widget('wx-linked', { href: 'https://example.invalid/' })] });
    await dismissSetupPrompt(request);
    await stub(page);
    const frame = await open(page, 'wx-linked');
    const opened = [];
    page.context().on('page', p => opened.push(p));

    await frame.locator('#aq').tap();
    await expect(frame.locator('#widget')).toHaveClass(/\bpeek\b/);
    await expect(capsule(frame)).toBeVisible();
    await expect(frame.locator('#widget')).not.toHaveClass(/\bpeek\b/, { timeout: 6000 });
    await expect(capsule(frame)).toBeHidden();
    expect(opened).toHaveLength(0);
  });
});
