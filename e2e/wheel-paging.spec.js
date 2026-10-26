// @ts-check
/* A trackpad swipe or a mouse's sideways wheel turns the page, once per
   gesture, over the dashboard and over a widget alike. A widget is a frame, and
   a wheel inside it never reaches the dashboard unless it is handed on. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

const MANY = Array.from({ length: 48 }, (_, i) => app(`a${i}`, `App ${i}`));
const clock = {
  id: 'clock1',
  type: 'widget',
  label: 'Clock',
  widgetType: 'clock',
  widgetSize: 'small',
  widgetConfig: {},
};

async function open(page, request) {
  await seedConfig(request, { items: [clock, ...MANY], settings: { showLabels: { desktop: false } } });
  await dismissSetupPrompt(request);
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await page.locator('#dots .dot').nth(1).waitFor({ state: 'visible' });
  await page.locator('.widget iframe').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const f = /** @type {HTMLIFrameElement|null} */ (document.querySelector('.widget iframe'));
    return !!f && f.contentDocument?.readyState === 'complete';
  });
}

const current = page => page.locator('#dots .dot').evaluateAll(ds => ds.findIndex(d => d.classList.contains('on')));

/* One step past the threshold. Headless WebKit can hold a step back longer than
   the gap that ends a gesture, so a run of small steps can count as two. */
async function swipe(page, dx) {
  await page.mouse.wheel(dx * 3, 0);
  await page.waitForTimeout(400);
}

test('a sideways swipe turns one page, a vertical one none', async ({ page, request }) => {
  await open(page, request);
  const box = await page.locator('#dots').boundingBox();
  await page.mouse.move((box?.x ?? 400) + 10, (box?.y ?? 400) - 40);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  await expect.poll(() => current(page)).toBe(0);
  await swipe(page, 20);
  await expect.poll(() => current(page)).toBe(1);
  await swipe(page, -20);
  await expect.poll(() => current(page)).toBe(0);
});

test('a sideways swipe over a widget turns the page too', async ({ page, request }) => {
  await open(page, request);
  const widget = await page.locator('.widget').first().boundingBox();
  if (!widget) throw new Error('no widget on the first page');
  await page.mouse.move(widget.x + widget.width / 2, widget.y + widget.height / 2);
  await swipe(page, 20);
  await expect.poll(() => current(page)).toBe(1);
});

test('a sideways swipe over an open folder leaves the page alone in the phone layout', async ({ page, request }) => {
  const kids = Array.from({ length: 4 }, (_, i) => app(`f${i}`, `Folder app ${i}`));
  const folder = { id: 'box', type: 'folder', label: 'Box', children: kids.map(c => c.id), color: 'dark' };
  const more = Array.from({ length: 48 }, (_, i) => app(`b${i}`, `More app ${i}`));
  await seedConfig(request, { items: [folder, ...kids, ...MANY, ...more] });
  await dismissSetupPrompt(request);
  await page.setViewportSize({ width: 700, height: 844 });
  await page.goto('/');
  await page.locator('body.is-mob').waitFor({ state: 'attached' });
  await page.locator('#dots .dot').nth(1).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Box folder' }).click();
  const overlay = page.locator('.folder-overlay-mobile');
  await overlay.waitFor({ state: 'visible' });
  const box = await overlay.boundingBox();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await swipe(page, 20);
  expect(await current(page)).toBe(0);
});

test('a swipe held up by a busy page still turns one page', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit stamps a wheel event when it is handled, not when it was sent');
  await open(page, request);
  const box = await page.locator('#dots').boundingBox();
  await page.mouse.move((box?.x ?? 400) + 10, (box?.y ?? 400) - 40);
  await page.evaluate(() => {
    let seen = 0;
    addEventListener('wheel', () => {
      if (++seen !== 2) return;
      const t = performance.now();
      while (performance.now() - t < 400);
    });
  });
  const steps = [];
  for (let i = 0; i < 8; i++) {
    steps.push(page.mouse.wheel(20, 0));
    await new Promise(r => setTimeout(r, 16));
  }
  await Promise.all(steps);
  await page.waitForTimeout(400);
  expect(await current(page)).toBe(1);
});
