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
async function stub(page, failing = false) {
  await page.route('**/api/badges', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/widget-data/ss-*', r =>
    failing
      ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats) }),
  );
}

/** @param {import('@playwright/test').Page} page @param {string} id */
async function open(page, id) {
  await page.goto('/');
  const frame = page.frameLocator(`iframe[src*="${id}"]`);
  await expect(frame.locator('.head > .lbl, .row > .lbl').first()).toHaveText('CPU');
  await expect(frame.locator('.val').first()).toHaveText('50%');
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
    await expect(frame.locator('#sr-sum')).toHaveText(/Disk 50% \(234 GB of 467 GB\)/);
    await expect(frame.locator('#sr-sum')).toHaveText(/\/mnt\/media 78% \(1\.4 TB of 1\.8 TB\)/);

    const before = await boxes(frame);
    await frame.locator('.disk').hover();
    await expect(frame.locator('.disk')).toHaveClass(/\bshow\b/);
    await expect(frame.locator('.sizes')).toHaveText('234 / 467 GB · 1.4 / 1.8 TB');
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
  await expect(frame.locator('.row').nth(2).locator('.val span')).toHaveText(['234 / 467 GB', '1.4 / 1.8 TB']);
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
