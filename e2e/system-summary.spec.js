// @ts-check
/* The System Summary's hover, measured in the dashboard frame it ships in. */

const { test, expect } = require('@playwright/test');
const { seedConfig, dismissSetupPrompt } = require('./helpers');

const slots = [{ type: 'cpu' }, { type: 'procs' }, { type: 'disk', primary: '/', secondary: '/mnt/media' }];
const widget = (id, size) => ({
  id,
  type: 'widget',
  label: 'System Summary',
  widgetType: 'system-summary',
  widgetSize: size,
  widgetConfig: { statProvider: 'system', slots },
});

/* 30 past points, 10 to 39. The chart keeps the newest 23 and the live 50, so
   its first column holds 17. */
const past = Array.from({ length: 30 }, (_, i) => 10 + i);
const stats = {
  cpu: 50,
  procs: 300,
  disks: [
    { mount: '/', usedPct: 50, totalGb: 467 },
    { mount: '/mnt/media', usedPct: 78, totalGb: 1863 },
  ],
  history: { cpu: past, procs: past.map(v => v + 280) },
};

/** @param {import('@playwright/test').Page} page */
async function stub(page, failing = false, reply = stats) {
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/widget-data/ss-*', r =>
    failing
      ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }),
  );
}

/** @param {import('@playwright/test').Page} page @param {string} id */
async function open(page, id) {
  await page.goto('/');
  const frame = page.frameLocator(`iframe[src*="${id}"]`);
  await expect(frame.locator('.head > .lbl, .row > .lbl').first()).toHaveText('CPU');
  await expect(frame.locator('.val').first()).toHaveText('50%');
  await page.waitForFunction(src => {
    const f = /** @type {HTMLIFrameElement|null} */ (document.querySelector(`iframe[src*="${src}"]`));
    const zoom = f?.getAttribute('data-zoom');
    const applied = Number.parseFloat(f?.contentDocument?.documentElement.style.zoom || '');
    return !!zoom && Math.abs(applied - Number(zoom)) < 0.001;
  }, id);
  return frame;
}

/** Every drawn box in the medium grid, rounded to a pixel. */
const boxes = frame =>
  frame
    .locator('.head, .plot, .disk')
    .evaluateAll(els => els.map(e => Object.values(e.getBoundingClientRect().toJSON()).map(Math.round).join(',')));

test.describe('medium', () => {
  test.beforeEach(async ({ page, request }) => {
    await seedConfig(request, { items: [widget('ss-medium', 'medium')] });
    await dismissSetupPrompt(request);
    await stub(page);
  });

  test('a hovered column shows its reading and age, and nothing moves', async ({ page }) => {
    const frame = await open(page, 'ss-medium');
    const before = await boxes(frame);

    await frame
      .locator('.plot')
      .first()
      .hover({ position: { x: 2, y: 10 } });
    await expect(frame.locator('.head > .lbl').first()).toHaveText(/ago/);
    await expect(frame.locator('.val').first()).toHaveText('17%');
    await expect(frame.locator('.tb-col-mark')).toHaveCount(1);
    expect(await boxes(frame)).toEqual(before);

    await page.mouse.move(0, 0);
    await expect(frame.locator('.head > .lbl').first()).toHaveText('CPU');
    await expect(frame.locator('.val').first()).toHaveText('50%');
    await expect(frame.locator('.tb-col-mark')).toHaveCount(0);
  });

  /* Safari can leave the frame without telling the element under the pointer. */
  test('a hover ends when only the document hears the pointer leave', async ({ page }) => {
    const frame = await open(page, 'ss-medium');
    await frame
      .locator('.plot')
      .first()
      .hover({ position: { x: 2, y: 10 } });
    await expect(frame.locator('.val').first()).toHaveText('17%');

    await frame.locator('html').evaluate(root => root.dispatchEvent(new MouseEvent('mouseleave')));
    await expect(frame.locator('.head > .lbl').first()).toHaveText('CPU');
    await expect(frame.locator('.val').first()).toHaveText('50%');
  });

  test('a hovered disk shows both sizes, and the summary always carries them', async ({ page }) => {
    const frame = await open(page, 'ss-medium');
    await expect(frame.locator('#sr-sum')).toHaveText(/Disk 50% \(251 GB of 501 GB\)/);
    await expect(frame.locator('#sr-sum')).toHaveText(/\/mnt\/media 78% \(1\.6 TB of 2 TB\)/);

    const before = await boxes(frame);
    await frame.locator('.disk').hover();
    await expect(frame.locator('.disk')).toHaveClass(/\bshow\b/);
    await expect(frame.locator('.sizes')).toHaveText('251 / 501 GB · 1.6 / 2 TB');
    expect(await boxes(frame)).toEqual(before);
  });
});

test('a small widget shows both disks on hover without moving a row', async ({ page, request }) => {
  await seedConfig(request, { items: [widget('ss-small', 'small')] });
  await dismissSetupPrompt(request);
  await stub(page);
  const frame = await open(page, 'ss-small');
  const rows = () => frame.locator('.row').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().y)));
  const before = await rows();

  await frame.locator('.row').nth(2).hover();
  await expect(frame.locator('.row').nth(2).locator('.val span')).toHaveText(['251 / 501 GB', '1.6 / 2 TB']);
  expect(await rows()).toEqual(before);
});

test('the failure caption follows the reader direction', async ({ page, request }) => {
  await seedConfig(request, { items: [widget('ss-failing', 'medium')], settings: { language: 'fa' } });
  await dismissSetupPrompt(request);
  await stub(page, true);
  await page.goto('/');
  const cap = page.frameLocator('iframe[src*="ss-failing"]').locator('#cap');
  await expect(cap).toBeVisible();
  expect(await cap.evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
});

test('a Persian uptime reads right to left, each figure before its unit', async ({ page, request }) => {
  const item = widget('ss-uptime', 'medium');
  item.widgetConfig = { ...item.widgetConfig, network: { enabled: true, mode: 'uptime' } };
  await seedConfig(request, { items: [item], settings: { language: 'fa' } });
  await dismissSetupPrompt(request);
  await stub(page, false, { ...stats, uptime: 3 * 86400 + 4 * 3600 });
  await page.goto('/');
  const uptime = page.frameLocator('iframe[src*="ss-uptime"]').locator('#net-uptime');
  await expect(uptime).toHaveText('۳ روز ۴ ساعت');
  const rightToLeft = await uptime.evaluate(el => {
    const node = /** @type {Text} */ (el.firstChild);
    const words = [];
    for (const m of node.data.matchAll(/\S+/g)) {
      const r = document.createRange();
      r.setStart(node, m.index ?? 0);
      r.setEnd(node, (m.index ?? 0) + m[0].length);
      words.push({ word: m[0], x: r.getBoundingClientRect().left });
    }
    return words.sort((a, b) => b.x - a.x).map(w => w.word);
  });
  expect(rightToLeft).toEqual(['۳', 'روز', '۴', 'ساعت']);
});

test('a failed speed test says so instead of showing speeds', async ({ page, request }) => {
  const item = widget('ss-speed', 'medium');
  item.widgetConfig = {
    ...item.widgetConfig,
    network: { enabled: true, mode: 'speed', provider: 'myspeed', url: 'http://myspeed.invalid' },
  };
  await seedConfig(request, { items: [item] });
  await dismissSetupPrompt(request);
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const failed = { download: null, upload: null, ping: null, failed: true, ts: '2026-11-27T22:54:15Z' };
  await page.route('**/api/widget-data/ss-*', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(r.request().url().includes('endpoint=speed') ? failed : stats),
    }),
  );
  await page.goto('/');
  const frame = page.frameLocator('iframe[src*="ss-speed"]');
  await expect(frame.locator('#net-dn')).toHaveText('Last test failed');
  await expect(frame.locator('#net-up')).toBeHidden();
  await expect(frame.locator('#net-val svg')).toHaveCount(2);
  for (const arrow of await frame.locator('#net-val svg').all()) await expect(arrow).toBeHidden();
});

test('a remote temperature slot with no sensor chosen shows the default reading', async ({ page, request }) => {
  const item = widget('ss-temp', 'medium');
  item.widgetConfig = {
    statProvider: 'glances',
    glancesUrl: 'http://glances.invalid:61208',
    slots: [{ type: 'temp' }],
  };
  await seedConfig(request, { items: [item] });
  await dismissSetupPrompt(request);
  await stub(page, false, { cpu: 5, ram: 30, temp: 56, temps: { 'iwlwifi_1 0': 44, 'Package id 0': 56 }, disks: [] });
  await page.goto('/');
  await expect(page.frameLocator('iframe[src*="ss-temp"]').locator('.val').first()).toContainText('56');
});
