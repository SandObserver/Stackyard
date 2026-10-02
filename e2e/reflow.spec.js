// @ts-check

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, openDashboardList, animationsDone } = require('./helpers');

const MANY = Array.from({ length: 40 }, (_, i) => app(`a${i}`, `App ${i}`));

/** @param {import('@playwright/test').Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return b;
}

test('the empty dashboard welcome fits at 400% zoom', async ({ page, request }) => {
  await seedConfig(request, { items: [] });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto('/');
  const hint = page.locator('.empty-state-hint');
  await hint.waitFor({ state: 'visible' });
  const b = await box(hint);
  expect(b.y, 'the import link starts on screen').toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, 'the import link ends on screen').toBeLessThanOrEqual(256);
  const title = await box(page.locator('.empty-state-title'));
  expect(title.y, 'the heading starts on screen').toBeGreaterThanOrEqual(0);
});

test('the empty dashboard welcome scrolls when it does not fit', async ({ page, request }) => {
  await seedConfig(request, { items: [] });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width: 320, height: 120 });
  await page.goto('/');
  const title = page.locator('.empty-state-title');
  await title.waitFor({ state: 'visible' });
  const t = await box(title);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.empty-state')?.scrollTop ?? 0))
    .toBeGreaterThan(0);
  const hint = await box(page.locator('.empty-state-hint'));
  expect(hint.y + hint.height, 'the import link scrolls into view').toBeLessThanOrEqual(120);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  for (const language of ['fr', 'es']) {
    test(`the list filter chips wrap at 320px in ${language}`, async ({ page, request }) => {
      await seedConfig(request, { items: MANY, settings: { language } });
      await dismissSetupPrompt(request);
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto('/admin/#dashboard');
      await page.locator('#al-filter:not(.d-none)').waitFor({ state: 'attached' });
      const chips = page.locator('.al-chips .chip');
      await chips.last().waitFor({ state: 'visible' });
      for (const chip of await chips.all()) {
        const b = await box(chip);
        expect(b.x + b.width, 'a chip ends inside the window').toBeLessThanOrEqual(320);
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(wide, 'the page does not scroll sideways').toBeLessThanOrEqual(320);
    });
  }
});

test('the desktop Settings sidebar stays on screen while the list scrolls', async ({ page, request }) => {
  await seedConfig(request, { items: MANY });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width: 1280, height: 700 });
  await openDashboardList(page);
  await page.locator('#al .drow').nth(30).waitFor({ state: 'attached' });
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const b = await box(page.locator('.nl[data-sec="dashboard"]'));
  expect(b.y, 'the Dashboard link is still on screen').toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(700);
});

/** Whether a point lands on the element or inside it. */
function hits(page, x, y, selector) {
  return page.evaluate(
    ([px, py, sel]) => {
      const hit = document.elementFromPoint(px, py);
      return !!hit?.closest(sel);
    },
    /** @type {[number, number, string]} */ ([x, y, selector]),
  );
}

/** Open a folder of `count` apps in the phone layout. */
async function openFolder(page, request, count, width) {
  const children = Array.from({ length: count }, (_, i) => app(`f${i}`, `Folder app ${i}`));
  const folder = { id: 'box', type: 'folder', label: 'Box', children: children.map(c => c.id), color: 'dark' };
  await seedConfig(request, { items: [folder, ...children] });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await page.locator('body.is-mob').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Box folder' }).click();
  await page.locator('.folder-dot').first().waitFor({ state: 'visible' });
  await animationsDone(page);
}

for (const width of [320, 390]) {
  test(`folder page dots are 24px targets at ${width}px`, async ({ page, request }) => {
    await openFolder(page, request, 12, width);
    const dots = page.locator('.folder-dot');
    await expect(dots).toHaveCount(2);
    const [a, b] = [await box(dots.nth(0)), await box(dots.nth(1))];
    const pitch = Math.abs(b.x + b.width / 2 - (a.x + a.width / 2));
    expect(pitch, 'dot centres are 24px apart').toBeGreaterThanOrEqual(24 - 0.5);
    const top = b.y - 3.5;
    const cx = b.x + b.width / 2;
    for (const [x, y] of [
      [cx - 11.5, b.y + b.height / 2],
      [cx + 11.5, b.y + b.height / 2],
      [cx, top],
      [cx, top + 23],
    ]) {
      expect(await hits(page, x, y, '.folder-dot'), `a tap at ${x},${y}`).toBe(true);
    }
    for (const icon of await page.locator('.dyn-page-grid').first().locator('.dyn-fold-anchor').all()) {
      const r = await box(icon);
      const [x, y] = [r.x + r.width / 2, r.y + r.height - 1];
      expect(await hits(page, x, y, '.dyn-fold-anchor'), `the bottom edge of an app at ${x},${y}`).toBe(true);
    }
  });
}

test('every folder page dot stays inside the folder', async ({ page, request }) => {
  await openFolder(page, request, 126, 320);
  const dots = page.locator('.folder-dot');
  await expect(dots).toHaveCount(14);
  const row = await box(page.locator('.folder-dots'));
  const [first, last] = [await box(dots.first()), await box(dots.last())];
  expect(first.x).toBeGreaterThanOrEqual(Math.max(0, row.x));
  expect(last.x + last.width).toBeLessThanOrEqual(Math.min(320, row.x + row.width));
});

test('a badge that opens a popover is a 24px target', async ({ page, request }) => {
  await page.route('**/api/badges', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/health', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subject: { unhealthy: true } }),
    }),
  );
  const item = {
    ...app('subject', 'Subject'),
    monitoring: { healthcheck: { enabled: true, pingUrl: 'http://example.invalid/ping' } },
  };
  await seedConfig(request, { items: [item] });
  await dismissSetupPrompt(request);
  await page.goto('/');
  const badge = page.locator('.badge.has-pop').first();
  await expect(badge).toBeVisible();
  await animationsDone(page);
  const b = await box(badge);
  expect(b.height, 'the drawn badge is under 24px, or this test proves nothing').toBeLessThan(24);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  for (const [dx, dy] of [
    [0, -11.5],
    [0, 11.5],
  ]) {
    expect(await hits(page, cx + dx, cy + dy, '.badge'), `a click ${dx},${dy} from the centre`).toBe(true);
  }
});
