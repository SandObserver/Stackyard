// @ts-check
/* The page dots, measured as painted rather than as declared.

   The dot is a white tint on a translucent blurred bar over the user's
   wallpaper. The stylesheet gate cannot judge that: it reads declared colours,
   and what reaches the eye is every layer composited together over a picture
   the project has never seen. So this reads the pixel the browser painted.

   Both extremes of a background are covered, because the failure is worst over
   a light one. A solid colour is used rather than a photograph so the reading
   is the same on every run; a photograph reaches the same code path, sampled
   per region instead of once. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, centrePixel, contrast } = require('./helpers');

/* SC 1.4.11: a control's state has to be distinguishable at 3:1. */
const AA_NON_TEXT = 3;

/* Enough tiles to paginate on any viewport the suite runs at. */
const MANY = Array.from({ length: 48 }, (_, i) => app(`a${i}`, `App ${i}`));

async function openWith(page, request, colour) {
  await seedConfig(request, {
    items: MANY,
    settings: { background: { type: 'color', color: colour }, showLabels: { desktop: false } },
  });
  await dismissSetupPrompt(request);
  await page.goto('/');
  await page.locator('#dots .dot').nth(1).waitFor({ state: 'visible' });
  /* The tone is read from the wallpaper after the first paint, so sampling a
     pixel before it lands reads the untoned indicator. Wait for the attribute
     rather than for a duration. */
  await page.locator('#dots[data-tone]').waitFor({ state: 'attached' });
  /* The dots animate on their way in. */
  await page.waitForTimeout(300);
}

for (const [name, colour] of [
  ['a light background', '#ffffff'],
  ['a dark background', '#000000'],
]) {
  test(`the current page is distinguishable over ${name}`, async ({ page, request }) => {
    await openWith(page, request, colour);
    const active = page.locator('#dots .dot.on').first();
    const inactive = page.locator('#dots .dot:not(.on)').first();
    const painted = { active: await centrePixel(active), inactive: await centrePixel(inactive) };
    const ratio = contrast(painted.active, painted.inactive);
    expect(
      ratio,
      `active rgb(${painted.active}) against inactive rgb(${painted.inactive}) measured ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
}

/* The bar is chrome over content the project does not control, so the dots have
   to stay legible against what is behind the bar as well as against each other. */
test('the indicator stays legible against the background behind it', async ({ page, request }) => {
  await openWith(page, request, '#ffffff');
  const active = page.locator('#dots .dot.on').first();
  const ground = page.locator('#pages');
  const ratio = contrast(await centrePixel(active), await centrePixel(ground));
  expect(ratio, `the active dot measured ${ratio.toFixed(2)}:1 against the page behind it`).toBeGreaterThanOrEqual(
    AA_NON_TEXT,
  );
});
