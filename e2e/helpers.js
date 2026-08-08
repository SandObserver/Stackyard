// @ts-check
/* Shared setup for the end-to-end specs.

   State is seeded through the API rather than by writing the config file, so a
   spec works against a container it does not share a filesystem with, and so
   the seed goes through the same validation a real save does.

   Assertions about what was saved read the config back from the API. Checking
   only the DOM proves the page redrew, not that anything persisted, which is
   the half that actually breaks. */

const { expect } = require('@playwright/test');

/** Replace the whole config. @param {import('@playwright/test').APIRequestContext} request */
async function seedConfig(request, config) {
  const body = { _schemaVersion: 3, items: [], settings: {}, ...config };
  const res = await request.post('/api/config', { data: body });
  expect(res.ok(), `seeding failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** The config as the server holds it. */
async function readConfig(request) {
  const res = await request.get('/api/config');
  expect(res.ok(), `reading config failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Find a saved item, failing with what is actually stored rather than
    "undefined is not truthy", which says nothing about why. */
function expectItem(cfg, predicate, what) {
  const found = (cfg.items || []).find(predicate);
  const summary = (cfg.items || []).map(i => `${i.type}:${i.id}:${JSON.stringify(i.label)}`).join(', ');
  expect(found, `${what} was not saved. Config holds: [${summary}]`).toBeTruthy();
  return found;
}

/** An app item, with only the fields a hand-written fixture needs. */
function app(id, label, href = `http://example.invalid/${id}`) {
  return { id, type: 'app', label, href, color: 'dark', dock: false };
}

/** Open Settings and switch to the Dashboard section.

    Admin has no URL routing: the section is chosen by clicking the sidebar and
    remembered in localStorage, so a fresh context lands on whichever section is
    the default rather than the list. */
async function openDashboardList(page) {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="dashboard"]').click();
  await page.locator('#btn-add').waitFor({ state: 'visible' });
}

/** Set one inline-edit row: click the value, type, commit with Enter.

    The rows are the project's own control rather than a plain input: the value
    text opens the editor, and Enter commits. Doing it through the real
    interaction is the point of an end-to-end test. */
async function setInlineRow(page, rowId, inputId, value) {
  const row = page.locator(`#${rowId}`);
  await row.locator('.rv').click();
  const input = page.locator(`#${inputId}`);
  await input.waitFor({ state: 'visible' });
  await input.fill(value);
  await input.press('Enter');
}

/** Names in the dashboard list, in the order they appear. #al is the list the
    admin renders rows into. */
function rowNames(page) {
  return page.locator('#al .rnm').allTextContents();
}

/** The row for a named item. */
function rowByName(page, name) {
  return page.locator('#al .row').filter({ has: page.locator('.rnm', { hasText: name }) });
}

module.exports = { seedConfig, readConfig, expectItem, app, openDashboardList, setInlineRow, rowNames, rowByName };
