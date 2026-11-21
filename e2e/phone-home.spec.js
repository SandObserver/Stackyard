// @ts-check
/* The phone home screen as a touch phone lays it out and presses it. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, animationsDone } = require('./helpers');

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });

const docked = (id, label) => ({ ...app(id, label), dock: true });
const box = () => ({ id: 'box', type: 'folder', label: 'Box', children: ['f1', 'f2'] });

test.beforeEach(async ({ page, request }) => {
  await dismissSetupPrompt(request);
  await page.route('**/api/badges', route => route.fulfill({ json: {} }));
  await page.route('**/api/health', route => route.fulfill({ json: {} }));
});

/** @param {import('@playwright/test').Page} page */
async function openHome(page, request, items) {
  await seedConfig(request, { items, settings: { background: { type: 'color', color: '#000000' } } });
  await page.goto('/');
  await page.locator('body.is-mob').waitFor({ state: 'attached' });
  await animationsDone(page);
}

/** @param {import('@playwright/test').Locator} locator */
async function rect(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('the element is not visible');
  return b;
}

const folderTile = page => page.locator('#pages .dyn-mob-btn[data-tile-name*="Box"]');

test('a full Dock sits as far from the bottom as from the sides, with the page pill above it', async ({
  page,
  request,
}) => {
  await openHome(page, request, [
    docked('d1', 'D1'),
    docked('d2', 'D2'),
    docked('d3', 'D3'),
    docked('d4', 'D4'),
    app('a1', 'A1'),
  ]);
  const dock = page.locator('#dock');
  await expect(dock.locator('.dyn-dock-icon')).toHaveCount(4);
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  const d = await rect(dock);
  const left = d.x;
  const right = vp.width - (d.x + d.width);
  const bottom = vp.height - (d.y + d.height);
  expect(Math.abs(left - right), `left ${left}px, right ${right}px`).toBeLessThanOrEqual(1);
  expect(Math.abs(bottom - left), `bottom ${bottom}px, side ${left}px`).toBeLessThanOrEqual(1);

  const pill = await rect(page.locator('#mob-search-pill'));
  const above = d.y - (pill.y + pill.height);
  expect(above, `the pill ends ${above}px above the Dock`).toBeGreaterThanOrEqual(9);
  expect(above, `the pill ends ${above}px above the Dock`).toBeLessThanOrEqual(11);
  expect(Math.abs(pill.x + pill.width / 2 - vp.width / 2)).toBeLessThanOrEqual(1);
});

test('a folder tile shows its press and opens on a tap', async ({ page, request }) => {
  await openHome(page, request, [box(), app('f1', 'F1'), app('f2', 'F2')]);
  const tile = folderTile(page);
  const b = await rect(tile);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(tile.locator('.dyn-box')).toHaveCSS('transform', 'matrix(0.92, 0, 0, 0.92, 0, 0)');
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(tile.locator('.dyn-box')).toHaveCSS('transform', 'none');
  await expect(page.locator('dialog.folder-overlay-mobile')).toHaveCount(0);

  await page.evaluate(() => {
    const seen = [];
    /** @type {any} */ (window).touchesSeen = seen;
    for (const type of ['touchstart', 'touchend']) window.addEventListener(type, e => seen.push(e), { capture: true });
  });
  await tile.tap();
  await expect(page.locator('dialog.folder-overlay-mobile')).toBeVisible();
  await expect(page.locator('dialog.folder-overlay-mobile')).toHaveCount(1);
  const touches = await page.evaluate(() =>
    /** @type {any} */ (window).touchesSeen.map(e => ({ type: e.type, prevented: e.defaultPrevented })),
  );
  expect(touches).toEqual([
    { type: 'touchstart', prevented: false },
    { type: 'touchend', prevented: true },
  ]);
});

test.describe('on a short phone', () => {
  test.use({ viewport: { width: 393, height: 360 } });

  test('the folder title stays below the top edge', async ({ page, request }) => {
    await openHome(page, request, [box(), app('f1', 'F1'), app('f2', 'F2')]);
    await folderTile(page).tap();
    const title = page.locator('.folder-title-mobile');
    await expect(title).toContainText('Box');
    await animationsDone(page);
    const b = await rect(title);
    expect(b.y, 'the title top').toBeGreaterThanOrEqual(0);
    await expect(title).toBeInViewport({ ratio: 1 });
  });
});
