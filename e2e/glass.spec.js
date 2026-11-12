// @ts-check
const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

const WALLPAPER = { type: 'url', url: '/demo-wallpaper.jpg', brightness: 1, fit: 'fill' };

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [], settings: { background: { ...WALLPAPER } } });
  await dismissSetupPrompt(request);
});

/** Whether this browser can draw the GPU glass at all. */
const hasWebGL2 = page => page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));

/* A browser without WebGL2 keeps the CSS glass and the CSS page turn. One with
   it must draw the glass and turn pages on the frame clock. Half of each is a
   page that turns without moving, or glass that trails its element. */
test('the page turn belongs to whichever draws the glass', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body.ready')).toHaveCount(1);
  const gpu = await hasWebGL2(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        live: document.documentElement.hasAttribute('data-glass-live'),
        canvas: !!document.querySelector('canvas.glass-canvas'),
        turn: getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('pages'))).transitionDuration,
      })),
    )
    .toEqual(gpu ? { live: true, canvas: true, turn: '0s' } : { live: false, canvas: false, turn: '0.28s' });
});

test('Reduce Transparency on this device gives solid surfaces on both pages', async ({ page }) => {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  const toggle = page.locator('label.tog:has(#dev-transparency)');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduce');
  expect(await page.evaluate(() => localStorage.getItem('sy-transparency'))).toBe('reduce');

  await page.goto('/');
  await expect(page.locator('body.ready')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-transparency', 'reduce');
  await expect(page.locator('html')).not.toHaveAttribute('data-glass-live', '');
  expect(
    await page.evaluate(
      () => getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('dots'))).backdropFilter,
    ),
  ).toBe('none');

  await page.goto('/admin/');
  await page.locator('.nl[data-sec="appearance"]').click();
  await page.locator('label.tog:has(#dev-transparency)').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-transparency', 'reduce');
});

const dns = {
  id: 'dns',
  type: 'widget',
  widgetType: 'dns',
  label: 'DNS',
  widgetSize: 'small',
  widgetConfig: { provider: 'adguard', dnsUrl: 'http://dns.invalid' },
};

/** The card fill, and the frame's own glass mark and page background. */
async function cardState(page) {
  const card = page.locator('.widget[data-card="translucent"], .mob-widget-card[data-card="translucent"]').first();
  await card.locator('iframe').waitFor({ state: 'attached' });
  const frame = page
    .frameLocator('.widget[data-card="translucent"] iframe, .mob-widget-card[data-card="translucent"] iframe')
    .first();
  await frame.locator('body').waitFor({ state: 'attached' });
  const inner = await frame.locator('html').evaluate(html => ({
    glass: html.hasAttribute('data-glass'),
    page: getComputedStyle(html).backgroundColor,
  }));
  return { card: await card.evaluate(el => getComputedStyle(el).backgroundColor), ...inner };
}

test('a translucent widget card shows the wallpaper, and turns solid with Reduce Transparency', async ({
  page,
  request,
}) => {
  await seedConfig(request, { items: [dns], settings: { background: { ...WALLPAPER } } });
  await page.goto('/');
  await expect(page.locator('body.ready')).toHaveCount(1);
  const light = (await page.locator('html').getAttribute('data-theme')) === 'light';
  const rgb = light ? '255, 255, 255' : '28, 28, 30';
  await expect
    .poll(() => cardState(page))
    .toEqual({ card: `rgba(${rgb}, 0.85)`, glass: true, page: 'rgba(0, 0, 0, 0)' });

  await page.evaluate(() => localStorage.setItem('sy-transparency', 'reduce'));
  await page.reload();
  await expect(page.locator('body.ready')).toHaveCount(1);
  await expect.poll(() => cardState(page)).toEqual({ card: `rgb(${rgb})`, glass: false, page: `rgb(${rgb})` });
});

test('a folder panel keeps its fill until the GPU draws its glass', async ({ page, request }) => {
  const folder = { id: 'media', type: 'folder', label: 'Media', children: ['a'], color: 'dark' };
  const a = app('a', 'A');
  await seedConfig(request, { items: [folder, a], settings: { background: { ...WALLPAPER } } });
  await page.goto('/');
  await expect(page.locator('body.ready')).toHaveCount(1);
  const gpu = await hasWebGL2(page);
  /* The folder layer is made when the page is idle. A folder opened before that keeps its CSS fill. */
  if (gpu) await expect(page.locator('canvas.glass-folder-canvas')).toHaveCount(1);
  await page.getByRole('button', { name: /Media/ }).first().click();
  await expect(page.locator('.folder-overlay')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ov = /** @type {HTMLElement} */ (document.querySelector('.folder-overlay'));
        const panel = /** @type {HTMLElement} */ (ov.querySelector('.glass-surface'));
        return {
          drawn: ov.hasAttribute('data-glass-drawn') && !!ov.querySelector('canvas.glass-folder-canvas'),
          clear: getComputedStyle(panel).backgroundColor === 'rgba(0, 0, 0, 0)',
        };
      }),
    )
    .toEqual(gpu ? { drawn: true, clear: true } : { drawn: false, clear: false });
});

test('a dark widget on the light dashboard keeps its glass card', async ({ page, request }) => {
  const backup = {
    id: 'backup',
    type: 'widget',
    widgetType: 'backup',
    label: 'Backup',
    widgetSize: 'small',
    widgetConfig: {},
  };
  await seedConfig(request, { items: [backup], settings: { background: { ...WALLPAPER } } });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('sy-theme', 'light'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  /* A frame whose scheme differs from its page gets an opaque backdrop. */
  await expect
    .poll(async () => {
      const state = await cardState(page);
      const outer = await page
        .locator('.widget[data-card="translucent"] iframe, .mob-widget-card[data-card="translucent"] iframe')
        .first()
        .evaluate(el => getComputedStyle(el).colorScheme);
      const inner = await page
        .frameLocator('.widget[data-card="translucent"] iframe, .mob-widget-card[data-card="translucent"] iframe')
        .first()
        .locator('html')
        .evaluate(html => getComputedStyle(html).colorScheme);
      return { glass: state.glass, outer, inner };
    })
    .toEqual({ glass: true, outer: 'dark', inner: 'dark' });
});
