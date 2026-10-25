// @ts-check
/* The Downloads pager and failure state, driven in the dashboard frame it ships in. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const item = (name, eta) => ({ name, size: 1e9, progress: 0.5, speed: 1e6, eta, state: 'run' });
const reading = {
  items: [item('first.iso', 60), item('second.iso', 120)],
  summary: { kind: 'time', seconds: 120, moving: 2, speed: 2e6, stalled: 0, failed: 0 },
  finished: [],
  link: '',
};

const widget = id => ({
  id,
  type: 'widget',
  label: 'Downloads',
  widgetType: 'downloads',
  widgetSize: 'small',
  widgetConfig: { service: 'qbittorrent', url: 'http://qb.test:8080' },
});

/** @param {import('@playwright/test').Page} page @param {(r: import('@playwright/test').Route) => unknown} answer */
async function stub(page, answer) {
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/widget-data/dl-*', answer);
}

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [widget('dl-one')] });
  await dismissSetupPrompt(request);
});

test('the pager names its position and Next wraps to the first download with focus kept', async ({ page }) => {
  await stub(page, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reading) }));
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="dl-one"]');
  const pager = frame.getByRole('group', { name: 'Download 1 of 2' });
  await expect(pager).toBeVisible();

  const next = frame.locator('#next');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(frame.getByRole('group', { name: 'Download 2 of 2' })).toBeVisible();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pager).toBeVisible();
  await expect(next).toBeFocused();
});

test('a failure before the first reading shows no loading boxes, also after a resize', async ({ page }) => {
  await stub(page, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' }));
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="dl-one"]');
  await expect(frame.locator('#cap')).not.toBeEmpty();
  await expect(frame.locator('.ghost')).toHaveCount(0);

  const size = page.viewportSize() || { width: 1280, height: 720 };
  await page.setViewportSize({ width: size.width - 40, height: size.height });
  await frame.locator('html').evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(frame.locator('.ghost')).toHaveCount(0);
  await expect(frame.locator('#cap')).not.toBeEmpty();
});
