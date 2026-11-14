// @ts-check
/* Accessible names as the browser computes them, not as the markup spells them. */

const { test, expect } = require('@playwright/test');
const { seedConfig, app, openDashboardList, rowByName } = require('./helpers');

async function openSection(page, sec) {
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator(`.nl[data-sec="${sec}"]`).click();
}

test.beforeEach(async ({ request }) => {
  await seedConfig(request, {
    items: [{ ...app('alpha', 'Alpha'), monitoring: { healthcheck: { enabled: true, container: 'alpha' } } }],
    settings: { language: 'de' },
  });
});

test('pencil buttons are named after their row in the page language', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('#ie-ip .pe')).toHaveAccessibleName('Host-IP bearbeiten');
});

test('a picker is named by its setting and its value', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('#lang-btn')).toHaveAccessibleName('Sprache Deutsch');
});

test('the wallpaper file input is not a separate unnamed stop', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('#bg-upload')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#bg-upload')).toHaveAttribute('aria-hidden', 'true');
});

test('the sidebar brand link is named by its visible text first', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('.sb-brand')).toHaveAccessibleName(/^Stackyard\b.*Zurück/);
});

test('the custom widget fullscreen switch is named', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  await expect(page.locator('#if-fs')).toHaveAccessibleName('Vollbild erlauben');
});

test('settings toggles are switches, named by their row', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('#set-awake')).toHaveRole('switch');
  await expect(page.getByRole('switch', { name: 'Bildschirm aktiv lassen' })).toHaveCount(1);
});

async function expectTogglesAreSwitches(scope) {
  await expect(scope.locator('.tog input').first()).toBeAttached();
  const toggles = await scope.locator('.tog input').count();
  await expect(scope.locator('.tog').getByRole('switch', { includeHidden: true })).toHaveCount(toggles);
}

test('every toggle in Settings and the editors is a switch', async ({ page, request }) => {
  await openSection(page, 'general');
  await expectTogglesAreSwitches(page.locator('main'));

  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Alpha bearbeiten' }).click();
  await expectTogglesAreSwitches(page.locator('#ev-body'));

  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  await expect(page.locator('#if-fs')).toHaveRole('switch');

  await seedConfig(request, {
    items: [{ id: 'clk', type: 'widget', widgetType: 'clock', label: 'Uhr', widgetSize: 'small' }],
    settings: { language: 'de' },
  });
  await openDashboardList(page);
  await rowByName(page, 'Uhr').getByRole('button', { name: 'Uhr bearbeiten', exact: true }).click();
  await expectTogglesAreSwitches(page.locator('#ev-body'));
});

test('the wallpaper brightness is spoken as a percentage', async ({ page }) => {
  await openSection(page, 'appearance');
  const br = page.locator('#bg-br');
  await expect(br).toHaveAttribute('aria-valuetext', /^\d+\s?%$/);
  await br.evaluate((/** @type {HTMLInputElement} */ e) => {
    e.value = '0.5';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(br).toHaveAttribute('aria-valuetext', /^50\s?%$/);
});

test('the colour sliders are spoken in degrees and percent, and follow the slider', async ({ page }) => {
  await openSection(page, 'appearance');
  const h = page.locator('#bg-color-h');
  const s = page.locator('#bg-color-s');
  const v = page.locator('#bg-color-v');
  await expect(h).toHaveAttribute('aria-valuetext', /^\d+°$/);
  await expect(s).toHaveAttribute('aria-valuetext', /^\d+\s?%$/);
  await expect(v).toHaveAttribute('aria-valuetext', /^\d+\s?%$/);
  const slide = (loc, value) =>
    loc.evaluate((/** @type {HTMLInputElement} */ e, x) => {
      e.value = x;
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  await slide(h, '123');
  await slide(s, '45');
  await slide(v, '67');
  await expect(h).toHaveAttribute('aria-valuetext', '123°');
  await expect(s).toHaveAttribute('aria-valuetext', /^45\s?%$/);
  await expect(v).toHaveAttribute('aria-valuetext', /^67\s?%$/);
});

test('the health check type radios are grouped under their label', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Alpha bearbeiten' }).click();
  const group = page.getByRole('group').filter({ has: page.locator('#hc-type-con') });
  await expect(group).toHaveAccessibleName('Typ');
});

test('picker names start with the label shown beside them', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('#bg-type-btn')).toHaveAccessibleName(/^Quelle /);
});

test('the icon file input is not a separate unnamed stop', async ({ page }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await expect(page.locator('#ip-upload')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#ip-upload')).toHaveAttribute('aria-hidden', 'true');
});

test('the import buttons show a focus ring', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit tabs only to text fields by default');
  await openSection(page, 'general');
  await page.locator('#imp').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const outline = await page.locator('#imp').evaluate(e => getComputedStyle(e.closest('.btn')).outlineStyle);
  expect(outline).toBe('solid');
});

test('the current Settings section is marked current', async ({ page }) => {
  await openSection(page, 'appearance');
  await expect(page.locator('.nl[data-sec="appearance"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.mtab[data-sec="appearance"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.nl[data-sec="general"]')).not.toHaveAttribute('aria-current');
});

test('Settings group titles are headings', async ({ page }) => {
  await openSection(page, 'general');
  await expect(page.locator('#sec-general').getByRole('heading', { level: 2, name: 'Sprache' })).toBeVisible();
});

test('the Dock and Home Screen titles are headings in the group title style', async ({ page }) => {
  const type = loc => loc.evaluate(e => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight]);
  await openSection(page, 'general');
  const title = await type(page.locator('#sec-general').getByRole('heading', { level: 2, name: 'Sprache' }));
  await openDashboardList(page);
  for (const name of ['Dock', 'Startbildschirm']) {
    const h = page.locator('#al').getByRole('heading', { level: 2, name, exact: true });
    await expect(h).toBeVisible();
    expect(await type(h)).toEqual(title);
  }
});

test('the editor group titles are headings', async ({ page, request }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Alpha bearbeiten' }).click();
  const body = page.locator('#ev-body');
  await expect(body.getByRole('heading', { level: 2, name: 'Symbol', exact: true })).toBeVisible();
  await expect(body.getByRole('heading', { level: 2, name: 'Badge', exact: true })).toBeVisible();

  await openDashboardList(page);
  await page.locator('#btn-add').click();
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  await expect(body.getByRole('heading', { level: 2, name: 'Größe', exact: true })).toBeVisible();
  await expect(body.getByRole('heading', { level: 2, name: 'Erweitert', exact: true })).toBeVisible();

  const service = name => ({ type: 'netbird', name, url: `http://${name}.invalid`, token: 't' });
  await seedConfig(request, {
    items: [
      {
        id: 'net',
        type: 'widget',
        widgetType: 'connections',
        label: 'Net',
        widgetSize: 'medium',
        widgetConfig: { services: [service('a'), service('b')] },
      },
    ],
    settings: { language: 'de' },
  });
  await openDashboardList(page);
  await rowByName(page, 'Net').getByRole('button', { name: 'Net bearbeiten', exact: true }).click();
  await expect(body.locator('.grp-hdr-row').getByRole('heading', { level: 2 })).toHaveCount(2);
});

test('the import dialog has a title heading and a heading per section', async ({ page }) => {
  await openDashboardList(page);
  const yaml = '- Media:\n    - Plex:\n        href: http://plex.invalid\n';
  await page
    .locator('#imp-foreign')
    .setInputFiles({ name: 'services.yaml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2, name: 'Aus anderem Dashboard importieren' })).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3, name: 'Neue Apps (1)' })).toBeVisible();
});

test('the icon colour Style is a named drop-down', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Alpha bearbeiten' }).click();
  const style = page.getByRole('button', { name: /^Stil/ });
  await expect(style).toHaveAccessibleName('Stil Dunkel');
  const pick = async v => {
    await style.click();
    await page.locator(`#icon-col-style-list [data-val="${v}"]`).click();
  };
  const swatch = v => page.locator(`#icon-color-slot .cc-swatch[data-v="${v}"]`);
  await expect(swatch('red')).toBeHidden();
  await pick('color');
  await expect(style).toHaveAccessibleName('Stil Farbe');
  await expect(swatch('blue')).toHaveAttribute('aria-pressed', 'true');
  await swatch('red').click();
  await expect(swatch('red')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('blue')).toHaveAttribute('aria-pressed', 'false');
  await expect(swatch('custom')).toHaveAttribute('aria-pressed', 'false');
  await pick('light');
  await expect(swatch('red')).toBeHidden();
  await pick('color');
  await expect(swatch('red')).toHaveAttribute('aria-pressed', 'true');
  await swatch('custom').click();
  await expect(swatch('custom')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch('red')).toHaveAttribute('aria-pressed', 'false');
});

test('the Test result is announced', async ({ page }) => {
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Alpha bearbeiten' }).click();
  await page.locator('label:has(#hc-type-ping)').click();
  await page.locator('#hc-ping-test').click();
  await expect(page.getByRole('status').filter({ hasText: /URL/ })).toHaveAttribute('id', 'hc-ping-status');
});

test('a Test that got no HTTP answer says why, in the page language', async ({ page }) => {
  await page.route('**/api/ping', route =>
    route.fulfill({
      json: { ok: false, status: 0, error: 'Connection refused.', kind: 'network', code: 'network.refused' },
    }),
  );
  await openDashboardList(page);
  await rowByName(page, 'Alpha').getByRole('button', { name: 'Alpha bearbeiten' }).click();
  await page.locator('label:has(#hc-type-ping)').click();
  await page.locator('#ie-hc-ping .pe').click();
  await page.keyboard.type('http://192.168.1.10:1/');
  await page.keyboard.press('Enter');
  await page.locator('#hc-ping-test').click();
  await expect(page.locator('#hc-ping-status')).toHaveText('Der Host hat die Verbindung abgelehnt. Prüfe den Port.');
});
