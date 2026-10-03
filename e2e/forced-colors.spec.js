// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app, openDashboardList, rowByName } = require('./helpers');

/** @param {import('@playwright/test').Locator} loc @param {string[]} props */
const styleOf = (loc, props, pseudo = null) =>
  loc.evaluate(
    (el, [p, ps]) => {
      const cs = getComputedStyle(el, ps);
      return Object.fromEntries(p.map(k => [k, cs.getPropertyValue(k)]));
    },
    /** @type {[string[], string|null]} */ ([props, pseudo]),
  );

test.describe('forced colors', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'only Chromium emulates forced colors');
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
  });

  test('a Settings switch keeps its outline and shows on and off differently', async ({ page, request }) => {
    await seedConfig(request, { items: [app('alpha', 'Alpha')] });
    await page.goto('/admin/');
    await page.locator('body.authed').waitFor({ state: 'attached' });
    /* The page CSP refuses a style tag. A constructed sheet is CSSOM and passes. */
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('*,*::after{transition:none!important}');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    const input = page.locator('#set-awake');
    const track = page.locator('#set-awake + .tr');
    const read = async () => ({
      track: await styleOf(track, ['background-color', 'border-top-style']),
      knob: await styleOf(track, ['background-color'], '::after'),
    });
    await input.evaluate(el => {
      /** @type {HTMLInputElement} */ (el).checked = false;
    });
    const off = await read();
    await input.evaluate(el => {
      /** @type {HTMLInputElement} */ (el).checked = true;
    });
    const on = await read();
    expect(off.track['border-top-style']).toBe('solid');
    expect(on.track['background-color']).not.toBe(off.track['background-color']);
    expect(on.knob['background-color']).not.toBe(on.track['background-color']);
    expect(off.knob['background-color']).not.toBe(off.track['background-color']);
  });

  test('a Settings slider keeps its track and thumb', async ({ page, request }) => {
    await seedConfig(request, { items: [app('alpha', 'Alpha')] });
    await page.goto('/admin/');
    await page.locator('body.authed').waitFor({ state: 'attached' });
    await page.locator('.nl[data-sec="appearance"]').click();
    const slider = page.locator('#bg-br');
    await slider.scrollIntoViewIfNeeded();
    expect((await styleOf(slider, ['border-top-style']))['border-top-style']).toBe('solid');
    /* getComputedStyle cannot read a slider thumb in Chromium, so read its pixels.
       The thumb is 24px tall over a 6px track: sample 8px above the centre line. */
    await slider.evaluate(el => {
      /** @type {HTMLInputElement} */ (el).value = '0.55';
    });
    const box = await slider.boundingBox();
    if (!box) throw new Error('the slider is not laid out');
    const mid = box.y + box.height / 2;
    const png = await page.screenshot({ clip: { x: box.x, y: mid - 14, width: box.width, height: 28 } });
    const [thumb, canvas] = await page.evaluate(
      async ([src, at]) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
        g.drawImage(img, 0, 0);
        const scale = img.width / at.width;
        const px = g.getImageData(Math.round(at.x * scale), Math.round(6 * scale), 1, 1).data;
        const probe = document.createElement('div');
        probe.style.background = 'Canvas';
        document.body.append(probe);
        const bg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [`rgb(${px[0]}, ${px[1]}, ${px[2]})`, bg];
      },
      /** @type {[string, { x: number, width: number }]} */ ([
        `data:image/png;base64,${png.toString('base64')}`,
        { x: 1 + 0.5 * (box.width - 2 - 38) + 19, width: box.width },
      ]),
    );
    expect(thumb).not.toBe(canvas);
  });

  test('the search row Enter opens is outlined', async ({ page, request }) => {
    await seedConfig(request, { items: [app('one', 'Sonarr'), app('two', 'Radarr')] });
    await dismissSetupPrompt(request);
    await page.goto('/');
    await page.locator('.icon').first().waitFor({ state: 'visible' });
    await page.keyboard.type('arr');
    await expect(page.locator('#sin')).toHaveValue('arr');
    await page.keyboard.press('ArrowDown');
    const sel = page.locator('.sr.sel');
    await expect(sel).toHaveCount(1);
    expect((await styleOf(sel, ['outline-style']))['outline-style']).toBe('solid');
  });

  test('the first-run password field shows its edge and its focus', async ({ page, request }) => {
    await seedConfig(request, { items: [] });
    /* Once dismissed, the server never offers the prompt again. */
    await page.route('**/api/auth/check', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), setupPrompted: false, passwordSet: false } });
    });
    await page.goto('/');
    const field = page.locator('.setup-pw').first();
    await field.waitFor({ state: 'visible' });
    expect((await styleOf(field, ['border-top-style']))['border-top-style']).toBe('solid');
    await field.focus();
    expect((await styleOf(field, ['outline-style']))['outline-style']).toBe('solid');
  });
});

test('the icon search field draws a focus ring', async ({ page, request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha')] });
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /edit/i }).click();
  const field = page.locator('#ip-in');
  await field.focus();
  expect((await styleOf(field, ['outline-style']))['outline-style']).toBe('solid');
});
