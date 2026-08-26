// @ts-check
/* The badge order the dashboard actually paints: Unhealthy, then Live Activity,
   then Fixed Label, then Healthy. Asserted in a browser against the image that
   ships, with its Content-Security-Policy in force. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await dismissSetupPrompt(request);
});

const LABELS = [
  { path: 'errors', name: 'errors', unit: 'err', color: '#ff393c' },
  { path: 'pending', name: 'pending', unit: 'pending', color: '#ffcd00' },
];

/** One app carrying whichever badge sources a case asks for. */
function subject({ health = false, activity = false, fixed = false, healthy = false }) {
  const item = { ...app('subject', 'Subject'), monitoring: {} };
  if (health || healthy) {
    item.monitoring.healthcheck = { enabled: true, pingUrl: 'http://example.invalid/ping' };
  }
  if (activity) {
    item.monitoring.activity = { enabled: true, url: 'http://example.invalid/api', interval: 30, labels: LABELS };
  }
  if (fixed) item.monitoring.staticBadge = { enabled: true, label: 'backup', color: 'gray' };
  return item;
}

async function paint(page, opts, { unhealthy = false, values = [0, 4] } = {}) {
  await page.route('**/api/badges', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.activity ? { subject: { value: values.find(v => v >= 1) ?? 0, values } } : {}),
    }),
  );
  await page.route('**/api/health', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.health || opts.healthy ? { subject: { unhealthy } } : {}),
    }),
  );
  await seedConfig(page.request, { items: [subject(opts)], settings: { server: { hideHealthyBadge: false } } });
  await page.goto('/');
  const badge = page.locator('.badge').first();
  await expect(badge).toBeVisible();
  await page.waitForTimeout(600);
  return badge;
}

test('unhealthy outranks everything else', async ({ page }) => {
  const badge = await paint(page, { health: true, activity: true, fixed: true }, { unhealthy: true });
  await expect(badge).toHaveText('!');
  await expect(badge).toHaveClass(/red/);
});

test('a live value outranks the fixed label and the healthy dot', async ({ page }) => {
  const badge = await paint(page, { healthy: true, activity: true, fixed: true });
  await expect(badge).toHaveText('4 pending');
});

test('the fixed label outranks the healthy dot', async ({ page }) => {
  const badge = await paint(page, { healthy: true, activity: true, fixed: true }, { values: [0, 0] });
  await expect(badge).toHaveText('backup');
});

test('the healthy dot shows when it is the only badge', async ({ page }) => {
  const badge = await paint(page, { healthy: true });
  await expect(badge).toHaveText('');
  await expect(badge).toHaveClass(/green/);
});

test('two badges open a list, and it holds the ones the pill did not show', async ({ page }) => {
  const badge = await paint(page, { health: true, activity: true, fixed: true }, { unhealthy: true });
  await expect(badge).toHaveClass(/has-more/);
  await badge.hover();
  const rows = page.locator('#badge-pop .badge-pop-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('attention');
  await expect(rows.nth(1)).toContainText('pending');
  await expect(rows.nth(2)).toContainText('backup');
});

test('one badge opens no list', async ({ page }) => {
  const badge = await paint(page, { healthy: true, fixed: true });
  await expect(badge).toHaveText('backup');
  await expect(badge).not.toHaveClass(/has-more/);
  await badge.hover();
  await page.waitForTimeout(500);
  await expect(page.locator('#badge-pop')).toBeHidden();
});

test('the healthy dot never counts toward the list', async ({ page }) => {
  const badge = await paint(page, { healthy: true, activity: true }, { values: [0, 4] });
  await expect(badge).toHaveText('4 pending');
  await expect(badge).not.toHaveClass(/has-more/);
});

test('the marker carries the colour of the next badge in the list', async ({ page }) => {
  const badge = await paint(page, { activity: true }, { values: [2, 4] });
  await expect(badge).toHaveClass(/has-more/);
  const next = await badge.evaluate(el => getComputedStyle(el).getPropertyValue('--badge-next').trim());
  expect(next).toBe('#ffcd00');
});

test('the phone pill drops the unit and keeps it in the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const badge = await paint(page, { activity: true }, { values: [0, 4] });
  await expect(badge).toHaveText('4 pending');
  const shown = await badge.evaluate(el => /** @type {HTMLElement} */ (el).innerText.trim());
  expect(shown, 'the phone shows the number alone').toBe('4');
  const wide = await badge.evaluate(el => {
    const r = el.getBoundingClientRect();
    const tile = /** @type {HTMLElement} */ (el.parentElement).getBoundingClientRect();
    return r.width > tile.width + 10;
  });
  expect(wide, 'the pill must not outgrow the icon it sits on').toBe(false);
});
