// @ts-check

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { seedConfig, readConfig, app, rowNames } = require('./helpers');
const { BASE_URL } = require('./base-url');
const { SEED_MARK } = require('./seed-guard');
const { BODY_LIMIT } = require('../api/src/router');
const { SCHEMA_VERSION } = require('../api/src/config');

const IDS = ['alpha', 'bravo', 'charlie'];

test.beforeEach(async ({ request }) => {
  await seedConfig(request, {
    items: [app('alpha', 'Alpha'), app('bravo', 'Bravo')],
    settings: { showLabels: false, typeToSearch: false },
  });
});

/* An import drops the seed mark, so seedConfig would refuse the container
   afterwards. Mark it again, but only over items this file wrote. */
test.afterEach(async ({ request }) => {
  const cfg = await readConfig(request);
  const foreign = cfg.items.filter(i => !i.system && !IDS.includes(i.id));
  expect.soft(foreign, 'the container holds items this spec did not write').toEqual([]);
  const res = await request.post('/api/config', {
    data: { _schemaVersion: 3, items: [], settings: {}, _rev: cfg._rev, [SEED_MARK]: true },
    headers: { Origin: BASE_URL },
  });
  expect(res.ok()).toBeTruthy();
});

/** @param {import('@playwright/test').Page} page */
async function openGeneral(page) {
  await page.goto('/admin/');
  await page.locator('body.authed').waitFor({ state: 'attached' });
  await page.locator('.nl[data-sec="general"]').click();
  await page.locator('#btn-exp').waitFor({ state: 'visible' });
}

/** @param {import('@playwright/test').Page} page @param {string} file */
async function importFile(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('label:has(#imp)').click()]);
  await chooser.setFiles(file);
}

/** @param {any} cfg */
const comparable = cfg => {
  const { _rev, [SEED_MARK]: _mark, ...rest } = cfg;
  return rest;
};

test('an exported backup imports back to the same config', async ({ page, request }, testInfo) => {
  await openGeneral(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-exp').click()]);
  expect(download.suggestedFilename()).toBe('stackyard-config.json');
  const file = testInfo.outputPath('stackyard-config.json');
  await download.saveAs(file);

  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(backup._schemaVersion).toBe(SCHEMA_VERSION);
  expect(backup).not.toHaveProperty('_rev');
  expect(backup.items.filter(i => !i.system).map(i => [i.id, i.label, i.href])).toEqual([
    ['alpha', 'Alpha', 'http://example.invalid/alpha'],
    ['bravo', 'Bravo', 'http://example.invalid/bravo'],
  ]);
  expect(backup.items.filter(i => i.system).map(i => i.id)).toEqual(['settings']);
  expect(backup.settings).toMatchObject({ showLabels: false, typeToSearch: false });
  expect(backup.settings.auth?.enabled).toBe(true);
  for (const secret of ['secret', 'passwordHash', 'revoked']) expect(backup.settings.auth).not.toHaveProperty(secret);
  const exported = comparable(backup);
  expect(comparable(await readConfig(request))).toEqual(exported);

  await seedConfig(request, { items: [app('charlie', 'Charlie')], settings: { showLabels: true } });
  await openGeneral(page);
  await importFile(page, file);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Import Configuration?');
  await expect(dialog).toContainText(
    'Import 3 items? 2 added, 0 updated, 1 deleted. Settings will be replaced with the ones in the file.',
  );
  const [write] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/config') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: 'Import', exact: true }).click(),
  ]);
  expect(write.status()).toBe(200);
  await expect(page.locator('#toast')).toHaveText('Settings restored. Reload the page before changing any settings.');

  expect(comparable(await readConfig(request))).toEqual(exported);
  const res = await request.get('/api/config/export');
  expect(comparable(await res.json())).toEqual(exported);

  await page.reload();
  await page.locator('.nl[data-sec="dashboard"]').click();
  await page.locator('#btn-add').waitFor({ state: 'visible' });
  expect(await rowNames(page)).toEqual(expect.arrayContaining(['Alpha', 'Bravo']));
  expect(await rowNames(page)).not.toContain('Charlie');
});

test('a backup over the size limit is refused before it is sent', async ({ page, request }, testInfo) => {
  const file = testInfo.outputPath('large.json');
  fs.writeFileSync(file, JSON.stringify({ items: [], settings: {}, pad: 'x'.repeat(BODY_LIMIT) }));
  const before = await readConfig(request);
  const writes = [];
  page.on('request', r => {
    if (r.url().endsWith('/api/config') && r.method() === 'POST') writes.push(r);
  });
  await openGeneral(page);
  await importFile(page, file);
  await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
  await expect(page.locator('#toast')).toHaveText(
    'Could not import. This configuration is larger than the 2 MB limit.',
  );
  expect(writes).toEqual([]);
  expect(comparable(await readConfig(request))).toEqual(comparable(before));

  const sent = await request.post('/api/config', {
    data: fs.readFileSync(file),
    headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
  });
  expect(sent.status()).toBe(413);
  expect(await sent.json()).toMatchObject({ code: 'invalid.config-too-large', detail: { max: 2 } });
});

for (const [what, name, body] of [
  ['JSON with no item list', 'other.json', JSON.stringify({ services: [{ name: 'NAS' }] })],
  ['not JSON', 'notes.json', 'name: NAS\nurl: http://nas.invalid\n'],
]) {
  test(`a file that is ${what} is not imported`, async ({ page, request }, testInfo) => {
    const file = testInfo.outputPath(name);
    fs.writeFileSync(file, body);
    const before = await readConfig(request);
    await openGeneral(page);
    await importFile(page, file);
    await expect(page.locator('#toast')).toHaveClass(/\berr\b/);
    await expect(page.locator('#toast')).toHaveText('Could not import. That file is not a Stackyard export.');
    expect(comparable(await readConfig(request))).toEqual(comparable(before));
  });
}
