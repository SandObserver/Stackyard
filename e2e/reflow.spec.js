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

test('the phone Settings header stays on screen while the list scrolls', async ({ page, request }) => {
  await seedConfig(request, { items: MANY });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/admin/#dashboard');
  await page.locator('html.is-mobile').waitFor({ state: 'attached' });
  const save = page.locator('#dash-save');
  await save.waitFor({ state: 'visible' });
  await page.locator('#al .drow').nth(30).waitFor({ state: 'attached' });
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  const b = await box(save);
  expect(b.y, 'Save is still on screen').toBeGreaterThanOrEqual(0);
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

test('folder page dots are 24px targets on a phone', async ({ page, request }) => {
  const children = Array.from({ length: 12 }, (_, i) => app(`f${i}`, `Folder app ${i}`));
  const folder = { id: 'box', type: 'folder', label: 'Box', children: children.map(c => c.id), color: 'dark' };
  await seedConfig(request, { items: [folder, ...children] });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('body.is-mob').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Box folder' }).click();
  const dots = page.locator('.folder-dot');
  await expect(dots).toHaveCount(2);
  await animationsDone(page);
  const [a, b] = [await box(dots.nth(0)), await box(dots.nth(1))];
  const pitch = Math.abs(b.x + b.width / 2 - (a.x + a.width / 2));
  expect(pitch, 'dot centres are 24px apart').toBeGreaterThanOrEqual(24 - 0.5);
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  for (const [dx, dy] of [
    [-11.5, 0],
    [11.5, 0],
    [0, -11.5],
    [0, 11.5],
  ]) {
    expect(await hits(page, cx + dx, cy + dy, '.folder-dot'), `a tap ${dx},${dy} from the centre`).toBe(true);
  }
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
