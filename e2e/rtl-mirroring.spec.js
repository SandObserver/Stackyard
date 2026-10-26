// @ts-check
/* Persian, measured as rendered.

   Comparing computed `left` or `right` does not work: a positioned element
   resolves both to used values, so neither ever reads as `auto`. These compare
   rendered coordinates instead. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

const DEAD = 'http://does-not-resolve.invalid/';

/* The language is set through the config, so the widget frames are rebuilt with
   it. Switching on the client does not reach them. */
async function seedPersian(request, items) {
  await seedConfig(request, { items, settings: { language: 'fa', showLabels: { desktop: false } } });
  await dismissSetupPrompt(request);
}

test('the page is in Persian and mirrored', async ({ page, request }) => {
  await seedPersian(request, [app('one', 'Sonarr')]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
});

test('a badge sits on the leading corner of its tile', async ({ page, request }) => {
  await seedPersian(request, [
    { ...app('watched', 'Grafana'), monitoring: { healthcheck: { enabled: true, pingUrl: DEAD } } },
  ]);
  await page.goto('/');
  const badge = page.locator('.badge.on').first();
  await badge.waitFor({ state: 'visible' });
  const b = await badge.boundingBox();
  const tile = await page.locator('.iwrap').first().boundingBox();
  const centre = b.x + b.width / 2;
  const tileMiddle = tile.x + tile.width / 2;
  expect(centre, `badge centre ${Math.round(centre)} against tile middle ${Math.round(tileMiddle)}`).toBeLessThan(
    tileMiddle,
  );
});

test('a row title and its subtitle share a leading edge', async ({ page, request }) => {
  await seedPersian(request, [app('latin', 'Backup and Storage')]);
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="dashboard"]').click();
  const row = page.locator('#al .drow').first();
  await row.waitFor({ state: 'visible' });
  /* Both boxes span the row, so their edges always agree. What moves is where
     the text sits inside them, which is the rect of the content itself. */
  const textRight = sel =>
    row
      .locator(sel)
      .first()
      .evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().right;
      });
  const name = await textRight('.rnm');
  const meta = await textRight('.rmt');
  /* Right-to-left, so both should start from the same right edge. */
  const gap = Math.abs(name - meta);
  expect(gap, `the title and its subtitle start ${Math.round(gap)}px apart`).toBeLessThan(8);
});

/* A tile name takes the direction of its own script, whatever the page's. The
   localisation clipping check skips anything with an ellipsis, so a name cut
   from the wrong end passes there. WebKit reports a clipped first glyph inside
   the box, so the computed direction is the check that holds in both engines. */
for (const language of ['en', 'fa']) {
  test(`a long tile name keeps its start on a ${language} dashboard`, async ({ page, request }) => {
    const names = [
      ['fa', 'مدیریت سرورهای خانگی و پشتیبان‌گیری خودکار شبانه', 'rtl'],
      ['en', 'Benachrichtigungseinstellungen Verwaltung', 'ltr'],
    ];
    await seedConfig(request, {
      items: names.map(([id, label]) => app(id, label)),
      settings: { language, showLabels: { desktop: true } },
    });
    await dismissSetupPrompt(request);
    await page.goto('/');
    for (const [id, label, dir] of names) {
      const tile = page.locator(`#pages .icon[data-tile-name="${label}"] .ilabel`);
      await tile.waitFor({ state: 'visible' });
      const seen = await tile.evaluate(el => {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const text = /** @type {Text} */ (walk.nextNode());
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const glyph = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return {
          dir: getComputedStyle(el).direction,
          cut: el.scrollWidth > el.clientWidth,
          inside: glyph.left >= box.left - 1 && glyph.right <= box.right + 1,
        };
      });
      expect(seen.cut, `${id}: the name is not long enough to be cut`).toBe(true);
      expect(seen.dir, `${id}: the label follows the page, not its text`).toBe(dir);
      expect(seen.inside, `${id}: the first letter is cut off`).toBe(true);
    }
  });
}
