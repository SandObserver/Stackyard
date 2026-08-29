// @ts-check
/* The search placeholder, measured against the panel as painted.

   The panel is a scrim and a blur over the user's wallpaper, so what sits behind
   the text is every layer composited. Over a light wallpaper it used to settle at
   rgb(93,93,93), where no weight of white placeholder clears 4.5:1: the scrim
   bounds every piece of text on the panel, which is why raising the ink alone
   could not fix it.

   The panel is sampled from the screenshot because only the browser knows what
   the blur produced. The ink is read from the stylesheet and composited over it,
   because a placeholder is thin and sampling a glyph stroke measures whichever
   pixel the antialiasing happened to land on. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, pixelAt, contrast } = require('./helpers');

/* SC 1.4.3: a placeholder is text. */
const AA_TEXT = 4.5;

const rgba = css => {
  const n = (css.match(/[\d.]+/g) || []).map(Number);
  return { rgb: /** @type {[number,number,number]} */ (n.slice(0, 3)), a: n.length > 3 ? n[3] : 1 };
};
const over = (fg, a, bg) => /** @type {[number,number,number]} */ (fg.map((c, i) => c * a + bg[i] * (1 - a)));

async function openSearch(page, request, colour) {
  await seedConfig(request, {
    items: [app('one', 'Sonarr')],
    settings: { background: { type: 'color', color: colour } },
  });
  await dismissSetupPrompt(request);
  await page.goto('/');
  await page.locator('.icon').first().waitFor({ state: 'visible' });
  await page.keyboard.press('/');
  await page.locator('#sin').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
}

for (const [name, colour] of [
  ['a light wallpaper', '#FFFFFF'],
  ['a dark wallpaper', '#000000'],
]) {
  test(`the search placeholder clears 4.5:1 over ${name}`, async ({ page, request }) => {
    await openSearch(page, request, colour);
    /* Behind the placeholder itself, not the overlay's centre: the field sits on
       the search bar, and the bar is what the text is read against. Sampled past
       the end of the placeholder so no glyph is under the probe. */
    const panel = await pixelAt(page.locator('#sin'), 0.92, 0.5);
    const declared = await page.locator('#sin').evaluate(el => getComputedStyle(el, '::placeholder').color);
    const { rgb, a } = rgba(declared);
    const painted = over(rgb, a, panel);
    const ratio = contrast(painted, panel);
    expect(ratio, `${declared} over panel rgb(${panel}) measured ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
}
