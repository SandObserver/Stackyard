// @ts-check
/* The dashboard itself, which nothing covered: every other spec drives Admin.
   These assert what only a browser shows, against the image that ships, with
   its Content-Security-Policy in force. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

/* The dashboard shows the first-run prompt until it is dismissed, and builds no
   tiles behind it. */
test.beforeEach(async ({ request }) => {
  await dismissSetupPrompt(request);
});

const badged = () => ({
  ...app('charlie', 'Charlie'),
  badge: { enabled: true, url: 'http://example.invalid/api/counts', extract: 'pending' },
});

const clock = () => ({
  id: 'clock1',
  type: 'widget',
  label: 'Clock',
  widgetType: 'clock',
  widgetSize: 'small',
  widgetConfig: {},
});

/** The dashboard polls badges and health on load. Answer both, so a spec never
    waits on example.invalid resolving. */
async function stubPolls(page, badges = {}) {
  await page.route('**/api/badges', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(badges) }),
  );
  await page.route('**/api/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

test('seeded items render as tiles carrying their label and link', async ({ page, request }) => {
  await seedConfig(request, {
    items: [app('alpha', 'Alpha', 'http://example.invalid/alpha'), app('bravo', 'Bravo')],
  });
  await stubPolls(page);
  await page.goto('/');

  const alpha = page.locator('#pages a.icon').filter({ hasText: 'Alpha' });
  await expect(alpha).toBeVisible();
  await expect(alpha).toHaveAttribute('href', 'http://example.invalid/alpha');
  /* Opened in a new tab, and never allowed to reach back into this one. */
  await expect(alpha).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('#pages a.icon').filter({ hasText: 'Bravo' })).toBeVisible();
});

test('a badge value is painted, and the next poll replaces it', async ({ page, request }) => {
  await seedConfig(request, { items: [badged()] });
  await stubPolls(page, { charlie: { value: 7 } });
  await page.goto('/');

  const badge = page.locator('#pages .iwrap .badge');
  await expect(badge).toHaveText('7');

  await stubPolls(page, { charlie: { value: 12 } });
  /* The dashboard polls again when the tab becomes visible, which beats waiting
     out the twenty-second interval. */
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(badge).toHaveText('12');
});

/* A service that did not answer must not read as the number zero. */
test('a badge whose item failed keeps its value and is marked out of date', async ({ page, request }) => {
  await seedConfig(request, { items: [badged()] });
  await stubPolls(page, { charlie: { value: 7 } });
  await page.goto('/');

  const badge = page.locator('#pages .iwrap .badge');
  await expect(badge).toHaveText('7');

  await stubPolls(page, { charlie: { value: 0, error: 'Timed out', kind: 'timeout' } });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect(badge).toHaveClass(/stale/);
  await expect(badge).toHaveText('7');
});

test('typing opens search and filters to the matching app', async ({ page, request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha'), app('bravo', 'Bravo')] });
  await stubPolls(page);
  await page.goto('/');
  await page.locator('#pages a.icon').first().waitFor();

  /* Any printable key opens it. There is no separate shortcut. */
  await page.keyboard.press('b');
  const spot = page.locator('#spot');
  await expect(spot).toHaveClass(/on/);
  await expect(page.locator('#sin')).toBeFocused();

  await page.locator('#sin').fill('brav');
  const results = page.locator('#sres a.sr');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveAttribute('aria-label', 'Bravo');

  await page.keyboard.press('Escape');
  await expect(spot).not.toHaveClass(/\bon\b/);
});

test('a widget renders inside its frame under the page policy', async ({ page, request }) => {
  const violations = [];
  page.on('console', m => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });

  await seedConfig(request, { items: [clock()] });
  await stubPolls(page);
  await page.goto('/');

  const frame = page.frameLocator('#pages .widget iframe');
  /* The digits are drawn by the widget's own script, so a rendered one proves
     it ran rather than that the element exists. */
  await expect(frame.locator('#row-h svg').first()).toBeVisible();
  expect(violations, `the page refused something: ${violations.join(' | ')}`).toEqual([]);
});

/* The layout was decided once at load, so a desktop window dragged narrower
   than the breakpoint kept the desktop layout until it was reloaded. */
test('resizing across the breakpoint switches the layout without a reload', async ({ page, request }) => {
  /* A rebuild that throws leaves the page half-swapped, which is worse than not
     rebuilding at all. */
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await seedConfig(request, { items: [app('alpha', 'Alpha'), app('bravo', 'Bravo')] });
  await stubPolls(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  /* Wait for the first build. Resizing before it lands tests nothing. */
  await page.locator('#pages a.icon').first().waitFor();

  const body = page.locator('body');
  await expect(body).not.toHaveClass(/is-mob/);

  /* Each layout has its own markup, so the tile class proves the page was
     rebuilt by the other builder rather than merely restyled. The mobile tile
     carries its name as an aria-label: mobile labels are off by default. */
  await page.setViewportSize({ width: 500, height: 900 });
  await expect(body).toHaveClass(/is-mob/);
  await expect(page.locator('#pages .dyn-mob-icon[aria-label="Alpha"]'), pageErrors.join(' | ')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(body).not.toHaveClass(/is-mob/);
  await expect(page.locator('#pages a.icon').filter({ hasText: 'Alpha' })).toBeVisible();
  await expect(page.locator('#pages .dyn-mob-icon')).toHaveCount(0);
  expect(pageErrors, 'the rebuild threw').toEqual([]);
});
