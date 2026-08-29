// @ts-check
/* Choosing a language, and what the choice reaches.

   Everything else that checks translation reads the catalogues or the source on
   disk. None of it proves a reader can pick a language, that the choice
   survives a reload, or that the words fit the space they are drawn in. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt, app } = require('./helpers');

const GERMAN_SAVE = 'Speichern';

async function seed(request, settings = {}) {
  await seedConfig(request, { items: [app('one', 'Sonarr'), app('two', 'Grafana')], settings });
  await dismissSetupPrompt(request);
}

/* ── choosing a language ──────────────────────────────────────────────────── */

test('a language chosen in Settings is saved and survives a reload', async ({ page, request }) => {
  await seed(request);
  await page.goto('/admin/');

  await page.locator('#lang-btn').click();
  await page.locator('#lang-list li[data-val="de"]').click();
  await page.locator('#srv-save').click();

  /* Read it back from the server, not from the page that just wrote it. */
  await expect.poll(async () => (await (await request.get('/api/config')).json()).settings?.language).toBe('de');

  await page.reload();
  await expect(page.locator('#srv-save')).toHaveText(GERMAN_SAVE);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('the dashboard renders in the saved language', async ({ page, request }) => {
  await seed(request, { language: 'de' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('Persian sets the direction as well as the language', async ({ page, request }) => {
  await seed(request, { language: 'fa' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

/* A widget is an iframe and does not load the i18n module. The language has to
   arrive on its URL or the tile is English inside a translated page. */
test('a widget frame is given the language', async ({ page, request }) => {
  await seedConfig(request, {
    items: [{ id: 'w1', type: 'widget', widgetType: 'clock', widgetSize: 'medium', label: 'Clock' }],
    settings: { language: 'fa' },
  });
  await dismissSetupPrompt(request);
  await page.goto('/');
  const frame = page.locator('iframe').first();
  await frame.waitFor({ state: 'attached' });
  expect(await frame.getAttribute('src')).toMatch(/[?&]lang=fa\b/);
});

/* ── the development locales ──────────────────────────────────────────────── */

test('the pseudolocale renders and is not offered as a language', async ({ page, request }) => {
  await seed(request);
  await page.goto('/admin/?lang=en-XA');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
  /* Every message is bracketed and accented, so the Save button is neither. */
  await expect(page.locator('#srv-save')).toHaveText(/^\[.*\]$/);
  await expect(page.locator('#srv-save')).not.toHaveText('Save');

  await page.locator('#lang-btn').click();
  await expect(page.locator('#lang-list li[data-val="en-XA"]')).toHaveCount(0);
});

test('key mode names each string instead of translating it', async ({ page, request }) => {
  await seed(request);
  await page.goto('/admin/?lang=cimode');
  await expect(page.locator('#srv-save')).toHaveText('common.save');
});

test('a development locale is not written to the config', async ({ page, request }) => {
  await seed(request, { language: 'de' });
  await page.goto('/admin/?lang=en-XA');
  await expect(page.locator('#srv-save')).toHaveText(/^\[.*\]$/);
  const cfg = await (await request.get('/api/config')).json();
  expect(cfg.settings?.language).toBe('de');
});

/* ── the words fit ────────────────────────────────────────────────────────── */

/* The pseudolocale pads every message by about 40%, which is what makes this
   worth measuring: a control that holds the padded string holds a real
   translation.

   Only undesigned overflow counts. A row label sets `text-overflow: ellipsis`
   and is meant to truncate, so an ellipsis there is the design working, not a
   defect. What this looks for is text that overflows with nothing to show for
   it: cut off with no ellipsis, or spilling out of its box. */
const CLIPPED = `() => {
  const out = [];
  for (const e of document.querySelectorAll('button, .rl, .nl, h1, h2, label, .grp-hdr')) {
    if (!e.offsetParent) continue;
    if (!e.textContent.trim()) continue;
    /* Screen-reader-only text is clipped to a 1px box on purpose. */
    if (e.closest('.visually-hidden')) continue;
    if (e.scrollWidth <= e.clientWidth + 1) continue;
    if (getComputedStyle(e).textOverflow === 'ellipsis') continue;
    out.push((e.id || e.className) + ': ' + e.textContent.trim().slice(0, 40));
  }
  return out;
}`;

for (const [name, url] of [
  ['the dashboard', '/?lang=en-XA'],
  ['Settings', '/admin/?lang=en-XA'],
]) {
  test(`${name} clips no text when every string is 40% longer`, async ({ page, request }) => {
    await seed(request);
    await page.goto(url);
    await page.locator('body').waitFor({ state: 'visible' });
    const clipped = await page.evaluate(`(${CLIPPED})()`);
    expect(clipped, `these elements overflow their box:\n${JSON.stringify(clipped, null, 2)}`).toEqual([]);
  });
}

test('Settings clips no text at a narrow width', async ({ page, request }) => {
  await seed(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/?lang=en-XA');
  await page.locator('body').waitFor({ state: 'visible' });
  const clipped = await page.evaluate(`(${CLIPPED})()`);
  expect(clipped, `these elements overflow their box:\n${JSON.stringify(clipped, null, 2)}`).toEqual([]);
});
