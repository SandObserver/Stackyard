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

test('a multi-select picker stays open for a second pick', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="folder"]').click();
  await page.locator('#folder-apps-row .row-dd-btn').click();
  const list = page.locator('ul.row-dd-list.checklist');
  await list.locator('li[role="option"]').nth(0).click();
  await list.locator('li[role="option"]').nth(1).click();
  await expect(list).toBeVisible();
  await expect(list.locator('li[aria-selected="true"]')).toHaveCount(2);
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

test('an icon too large for the web server says so', async ({ page }) => {
  await page.route('**/api/icons/upload', route =>
    route.fulfill({
      status: 413,
      contentType: 'text/html',
      body: '<html><body>413 Request Entity Too Large</body></html>',
    }),
  );
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: /edit/i }).click();
  await page.locator('#ip-upload').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(8) });
  await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
  await expect(page.locator('#toast')).toHaveText('Upload failed: That image is too large for the server to accept.');
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

test("a saved widget's Fetch sends its id and shows the server's advice", async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      {
        id: 'wx',
        type: 'widget',
        widgetType: 'weather',
        label: 'Weather',
        widgetSize: 'small',
        widgetConfig: { provider: 'openweather', owKey: 'stored-key', cityQuery: 'Berlin' },
      },
    ],
  });
  const sent = [];
  await page.route('**/api/widget-options/**', route => {
    sent.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 502, json: { error: 'x', kind: 'invalid', code: 'invalid.retype' } });
  });
  await openDashboardList(page);
  await rowByName(page, 'Weather').getByRole('button', { name: /^Edit/ }).first().click();
  await page.locator('#ev-body').getByRole('button', { name: 'Fetch' }).first().click();
  await expect.poll(() => sent).toEqual(['/api/widget-options/wx']);
  await expect(page.locator('#ev-body')).toContainText('the stored credential was not used');
});

test("a saved app's Live Activity Fetch sends its id with the stored header row", async ({ page, request }) => {
  await seedConfig(request, {
    items: [
      {
        ...app('svc', 'Service'),
        monitoring: {
          activity: {
            enabled: true,
            url: 'http://svc.invalid/api',
            interval: 30,
            headers: [{ key: 'X-Api-Key', value: 'stored-secret', secret: true }],
          },
        },
      },
    ],
  });
  const bodies = [];
  await page.route('**/api/badge-proxy', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { numbers: [] } });
  });
  await openDashboardList(page);
  await rowByName(page, 'Service').getByRole('button', { name: /^Edit/ }).first().click();
  await page.locator('#bfetch').click();
  await expect.poll(() => bodies.map(b => b.itemId)).toEqual(['svc']);
  expect(bodies[0].headers).toEqual([{ key: 'X-Api-Key', secret: true, valueSet: true }]);
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

test('switching section on a phone starts the new section at the top', async ({ page, request }) => {
  /* Enough items that the Dashboard section scrolls well past one screen. */
  await seedConfig(request, {
    items: Array.from({ length: 16 }, (_, i) => app(`item${i}`, `Item ${i}`)),
  });

  /* The phone layout hides the sidebar the shared helper clicks. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.mtab[data-sec="dashboard"]').click();
  await page.locator('#btn-add').waitFor({ state: 'visible' });

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.locator('.mtab[data-sec="general"]').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.locator('.mtab[data-sec="dashboard"]').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('a save refuses to overwrite a change made in another tab', async ({ page, request }) => {
  await openDashboardList(page);
  const elsewhere = await readConfig(request);
  await seedConfig(request, { items: [...elsewhere.items, app('charlie', 'Charlie')] });

  await rowByName(page, 'Alpha').getByRole('button', { name: /edit/i }).click();
  await setInlineRow(page, 'ie-name', 'f-lbl', 'Alpha renamed');
  await page.locator('#ev-save').click();
  await expect(page.locator('#toast')).toHaveText(
    'The dashboard was changed elsewhere. Reload the page and try again.',
  );

  const cfg = await readConfig(request);
  expectItem(cfg, i => i.id === 'charlie', 'the item added in the other tab');
  expect(expectItem(cfg, i => i.id === 'alpha', 'the item edited here').label).toBe('Alpha');
});

test('two saves in a row from one page both land', async ({ page, request }) => {
  await openDashboardList(page);
  for (const [name, renamed] of [
    ['Alpha', 'Alpha 2'],
    ['Bravo', 'Bravo 2'],
  ]) {
    await rowByName(page, name).getByRole('button', { name: /edit/i }).click();
    await setInlineRow(page, 'ie-name', 'f-lbl', renamed);
    await saveEditor(page);
    await expect(rowByName(page, renamed)).toBeVisible();
  }
  const labels = (await readConfig(request)).items.map(i => i.label);
  expect(labels).toEqual(expect.arrayContaining(['Alpha 2', 'Bravo 2']));
});

test('pressing Save twice on a new app adds it once', async ({ page, request }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await setInlineRow(page, 'ie-name', 'f-lbl', 'Echo');
  await setInlineRow(page, 'ie-url', 'f-href', 'http://echo.invalid');
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 300));
    await route.continue();
  });
  let writes = 0;
  page.on('request', r => {
    if (r.url().includes('/api/config') && r.method() === 'POST') writes++;
  });
  await page.locator('#ev-save').dblclick();
  await expect(rowByName(page, 'Echo')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(writes).toBe(1);
  expect((await readConfig(request)).items.filter(i => i.label === 'Echo')).toHaveLength(1);
});
