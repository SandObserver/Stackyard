// @ts-check
/* Seed through the API, never by writing the config file: a spec must work
   against a container it shares no filesystem with, and the seed must pass the
   same validation a real save does. */

const { expect } = require('@playwright/test');
const { BASE_URL } = require('./base-url');

/** Replace the whole config. @param {import('@playwright/test').APIRequestContext} request */
async function seedConfig(request, config) {
  const body = { _schemaVersion: 3, items: [], settings: {}, ...config };
  /* A write has to state its origin, and this request context is not a page. */
  const res = await request.post('/api/config', { data: body, headers: { Origin: BASE_URL } });
  expect(res.ok(), `seeding failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** The config as the server holds it. */
async function readConfig(request) {
  const res = await request.get('/api/config');
  expect(res.ok(), `reading config failed: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Find a saved item, failing with what is actually stored. */
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

/** Open Settings and switch to the Dashboard section. Admin has no URL
    routing: the section is chosen by clicking the sidebar. */
async function openDashboardList(page) {
  await page.goto('/admin/');
  await page.locator('.nl[data-sec="dashboard"]').click();
  await page.locator('#btn-add').waitFor({ state: 'visible' });
}

/** Set one inline-edit row: click the value, type, commit with Enter. */
async function setInlineRow(page, rowId, inputId, value) {
  const row = page.locator(`#${rowId}`);
  await row.locator('.rv').click();
  const input = page.locator(`#${inputId}`);
  await input.waitFor({ state: 'visible' });
  await input.fill(value);
  await input.press('Enter');
}

/** Click the editor's Save and wait for the write to land. Clicking returns as
    soon as the event is dispatched, so reading the config straight afterwards
    races the request. */
async function saveEditor(page) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/config') && r.request().method() === 'POST'),
    page.locator('#ev-save').click(),
  ]);
  expect(response.status(), `saving returned ${response.status()}: ${await response.text()}`).toBe(200);
  return response;
}

/** Names in the dashboard list, in the order they appear. */
function rowNames(page) {
  return page.locator('#al .rnm').allTextContents();
}

/** The row for a named item. */
function rowByName(page, name) {
  return page.locator('#al .row').filter({ has: page.locator('.rnm', { hasText: name }) });
}

module.exports = {
  seedConfig,
  readConfig,
  expectItem,
  saveEditor,
  app,
  openDashboardList,
  setInlineRow,
  rowNames,
  rowByName,
};
