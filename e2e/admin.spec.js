// @ts-check
/* The admin flows a user actually performs: add an app, edit one, and add a
   widget. Each asserts what was persisted, read back from the API, rather than
   only what the page redrew.

   These are the first end-to-end specs in the project, so they are deliberately
   few. A flaky end-to-end test is worse than a missing one: it gets retried
   until it passes and then believed. */

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

test('adding a widget stores its type', async ({ page, request }) => {
  await openDashboardList(page);
  await page.locator('#btn-add').click();

  /* The type tiles switch what the form renders. Selected by data-ctype: the
     accessible name is "Add Widget" and is not translated, so matching on it
     would break the moment it is. */
  await page.locator('.tile-opt[data-ctype="widget"]').click();
  const typeSelect = page.locator('#f-wtype');
  await typeSelect.waitFor({ state: 'visible' });
  await typeSelect.selectOption('clock');
  await saveEditor(page);

  const cfg = await readConfig(request);
  const widget = expectItem(cfg, i => i.type === 'widget', 'the widget');
  expect(widget.widgetType).toBe('clock');
});
