// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, animationsDone } = require('./helpers');

test.use({ reducedMotion: 'no-preference' });

test('a closing folder fades late on an ease-out curve and holds its frames', async ({ page, request }) => {
  await dismissSetupPrompt(request);
  await page.route('**/api/badges', route => route.fulfill({ json: {} }));
  await page.route('**/api/health', route => route.fulfill({ json: {} }));
  await seedConfig(request, {
    items: [{ id: 'box', type: 'folder', label: 'Box', children: ['f1'] }, app('f1', 'F1')],
    settings: { background: { type: 'color', color: '#000000' } },
  });
  await page.goto('/');
  await page.locator('#pages button.icon[data-tile-name*="Box"]').click();
  const overlay = page.locator('dialog.folder-overlay');
  await expect(overlay).toBeVisible();
  await animationsDone(page);
  await expect(page.locator('html'), 'the scripted glass runs no Web Animations').not.toHaveAttribute(
    'data-glass-live',
    /.*/,
  );

  await overlay.evaluate(dialog =>
    dialog.addEventListener(
      'close',
      () => {
        const panel = /** @type {HTMLElement} */ (dialog.querySelector('.folder-outer'));
        /** @type {any} */ (window).closing = panel.getAnimations().map(a => {
          const effect = /** @type {KeyframeEffect} */ (a.effect);
          const t = effect.getTiming();
          return {
            prop: 'opacity' in effect.getKeyframes()[0] ? 'opacity' : 'transform',
            duration: t.duration,
            delay: t.delay,
            easing: t.easing,
            fill: t.fill,
          };
        });
        /** @type {any} */ (window).opacityAtClose = getComputedStyle(panel).opacity;
      },
      { once: true },
    ),
  );
  await page.keyboard.press('Escape');
  const closing = await (await page.waitForFunction(() => /** @type {any} */ (window).closing)).jsonValue();

  const fade = closing.find(a => a.prop === 'opacity');
  expect(fade, `animations at close: ${JSON.stringify(closing)}`).toBeTruthy();
  expect(fade.duration).toBe(160);
  expect(fade.delay).toBe(90);
  expect(fade.easing.replace(/\s/g, '').replace(/0\./g, '.')).toBe('cubic-bezier(.23,1,.32,1)');
  expect(fade.fill, 'the panel shows through during the delay').toBe('both');
  for (const a of closing) expect(a.fill, `${a.prop} does not hold its last frame`).toBe('both');
  expect(await page.evaluate(() => /** @type {any} */ (window).opacityAtClose)).toBe('1');
  await expect(overlay).toHaveCount(0);
});
