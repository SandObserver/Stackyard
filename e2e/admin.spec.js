// @ts-check
/* Each spec asserts what was persisted, read back from the API, not only what
   the page redrew. */

const { test, expect } = require('@playwright/test');
const {
  seedConfig,
  readConfig,
  expectItem,
  saveEditor,
  app,
  openDashboardList,
  setInlineRow,
  rowNames,
  rowByName,
} = require('./helpers');

test.beforeEach(async ({ request }) => {
  await seedConfig(request, { items: [app('alpha', 'Alpha'), app('bravo', 'Bravo')] });
});

test('the seeded apps are listed', async ({ page }) => {
  await openDashboardList(page);
  const names = await rowNames(page);
  expect(names).toContain('Alpha');
  expect(names).toContain('Bravo');
});

test('adding an app saves it and shows it in the list', async ({ page, request }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();

  await setInlineRow(page, 'ie-name', 'f-lbl', 'Charlie');
  await setInlineRow(page, 'ie-url', 'f-href', 'http://charlie.invalid:8080');
  await saveEditor(page);

  await expect(rowByName(page, 'Charlie')).toBeVisible();

  const cfg = await readConfig(request);
  const saved = expectItem(cfg, i => i.label === 'Charlie', 'the app');
  expect(saved.type).toBe('app');
  expect(saved.href).toBe('http://charlie.invalid:8080');
});

test('editing an app keeps its id and changes only what was edited', async ({ page, request }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /edit/i }).click();

  await setInlineRow(page, 'ie-name', 'f-lbl', 'Alpha renamed');
  await saveEditor(page);

  await expect(rowByName(page, 'Alpha renamed')).toBeVisible();

  const cfg = await readConfig(request);
  const saved = expectItem(cfg, i => i.id === 'alpha', 'the edited item, by its original id,');
  expect(saved.label).toBe('Alpha renamed');
  expect(saved.href).toBe('http://example.invalid/alpha');
  expect(cfg.items.filter(i => i.id === 'alpha')).toHaveLength(1);
});

test('a saved change survives a reload', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await setInlineRow(page, 'ie-name', 'f-lbl', 'Delta');
  await setInlineRow(page, 'ie-url', 'f-href', 'http://delta.invalid');
  await saveEditor(page);
  await expect(rowByName(page, 'Delta')).toBeVisible();

  await page.reload();
  await page.locator('#btn-add').waitFor({ state: 'visible' });
  await expect(rowByName(page, 'Delta')).toBeVisible();
});

/* Widget settings rows are built from the manifest, not the template. A row
   whose input never becomes visible cannot be typed into at all. */
test('a widget text field and secret field accept typing and save', async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      {
        id: 'dns',
        type: 'widget',
        widgetType: 'dns',
        label: 'DNS',
        widgetSize: 'small',
        widgetConfig: { provider: 'adguard', dnsUrl: 'http://dns.invalid' },
      },
    ],
  });
  await openDashboardList(page);
  await rowByName(page, 'DNS').getByRole('button', { name: /^Edit/ }).first().click();

  const fieldRow = label =>
    page.locator('#ev-body .ie-row').filter({ has: page.locator('.rl', { hasText: new RegExp(`^${label}`) }) });

  const link = fieldRow('Click URL');
  await link.locator('.pe').click();
  await expect(link.locator('.row-inp')).toBeVisible();
  await page.keyboard.type('http://dns-admin.invalid');
  await page.keyboard.press('Enter');
  await expect(link.locator('.rv')).toHaveText('http://dns-admin.invalid');

  const pass = fieldRow('Password');
  await pass.locator('.pe').click();
  await expect(pass.locator('.row-inp')).toBeVisible();
  await page.keyboard.type('s3cret');
  await page.keyboard.press('Enter');

  await saveEditor(page);
  const saved = expectItem(await readConfig(request), i => i.id === 'dns', 'the DNS widget');
  expect(saved.widgetConfig.dnsHref).toBe('http://dns-admin.invalid');
  expect(saved.widgetConfig.dnsPass ?? saved.widgetConfig.dnsPassSet).toBeTruthy();
});

test('adding a widget stores its type', async ({ page, request }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();

  /* Selected by data-ctype. The accessible name is untranslated, so matching on
     it breaks the moment that changes. */
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  /* The type picker is the shared listbox: a button that opens a list mounted on
     <body>, not a native select. */
  const typeButton = page.locator('#f-wtype-btn');
  await typeButton.waitFor({ state: 'visible' });
  await typeButton.click();
  await page.locator('#f-wtype-list li[data-val="clock"]').click();
  await saveEditor(page);

  const cfg = await readConfig(request);
  const widget = expectItem(cfg, i => i.type === 'widget', 'the widget');
  expect(widget.widgetType).toBe('clock');
});
