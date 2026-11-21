// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

test('only keyboard focus opens the badge popover', async ({ page, request, browserName }) => {
  await dismissSetupPrompt(request);
  await page.route('**/api/badges', route => route.fulfill({ json: {} }));
  await page.route('**/api/health', route => route.fulfill({ json: { subject: { unhealthy: true } } }));
  await seedConfig(request, {
    items: [
      {
        ...app('subject', 'Subject'),
        monitoring: { healthcheck: { enabled: true, pingUrl: 'http://example.invalid/ping' } },
      },
    ],
  });
  await page.goto('/');
  const tile = page.locator('#pages a.icon[data-tile-name="Subject"]');
  await expect(tile.locator('.badge.has-pop')).toBeVisible();
  const isOpen = () => page.evaluate(() => !!document.getElementById('badge-pop')?.matches(':popover-open'));
  const nextFrame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => document.addEventListener('click', e => e.preventDefault(), { capture: true }));

  const b = await tile.boundingBox();
  if (!b) throw new Error('the tile is not visible');
  await tile.click({ position: { x: 4, y: b.height - 4 } });
  await nextFrame();
  expect(await isOpen(), 'a mouse click opened it').toBe(false);

  await tile.evaluate(el => {
    el.blur();
    el.focus();
  });
  await expect(tile).toBeFocused();
  await nextFrame();
  expect(await isOpen(), 'focus from script after a click opened it').toBe(false);

  await tile.evaluate(el => el.blur());
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let i = 0; i < 20 && !(await tile.evaluate(el => el === document.activeElement)); i++) {
    await page.keyboard.press(tab);
  }
  await expect(tile).toBeFocused();
  await expect(page.locator('#badge-pop')).toBeVisible();
  await expect(page.locator('#badge-pop .badge-pop-row')).toHaveCount(1);
});
