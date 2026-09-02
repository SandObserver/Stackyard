/* The API-down screen loads a catalog before it renders. The catalog is
   otherwise loaded as the last statement of the try that fetches the config, so
   a failed fetch skips it and t() answers with the key: the one screen the
   dashboard can show in that state reads "home.apiDownTitle".

   There is no DOM here and the project ships no test browser, so the two halves
   are driven separately. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const KEYS = ['home.apiDownTitle', 'home.apiDownSub', 'home.retry'];

test('an uninitialised catalog answers with the key itself', async () => {
  const { t } = await import('../js/i18n.js');
  for (const key of KEYS) assert.equal(t(key), key, `${key} resolved without a catalog`);
});

test('English makes every string on the screen readable', async () => {
  const i18n = await import(`../js/i18n.js?fresh=${Date.now()}`);
  const catalogs = new URL('../i18n/', import.meta.url);
  /* initI18n stamps lang and dir on the root element. No querySelectorAll, so it
     skips translating a document that is not there. */
  globalThis.document = { documentElement: { setAttribute() {} } };
  globalThis.fetch = async url => {
    const name = String(url).split('/').pop();
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(new URL(name, catalogs), 'utf8')) };
  };
  await i18n.initI18n('en');
  for (const key of KEYS) {
    assert.notEqual(i18n.t(key), key, `${key} is still its own key after loading English`);
    assert.ok(i18n.t(key).trim().length > 0);
  }
});

test('the error branch loads a catalog before it renders', () => {
  const dashboard = read('js/dashboard.js');
  const branch = dashboard.slice(dashboard.indexOf('if (configFailed) {'), dashboard.indexOf('api-error-btn'));
  assert.match(branch, /await initI18n\('en'\)/, 'the screen would render its own keys');
  assert.ok(
    branch.indexOf("initI18n('en')") < branch.indexOf('apiDownTitle'),
    'the catalog must load before the screen is built',
  );
});

/* Loading it up front would put a catalog fetch on every successful boot, and
   the catalogs are fetched with cache: 'no-store'. */
test('the success path does not pay for the failure path', () => {
  const dashboard = read('js/dashboard.js');
  const beforeFetch = dashboard.slice(
    dashboard.indexOf('async function boot()'),
    dashboard.indexOf("fetch('/api/config'"),
  );
  assert.doesNotMatch(beforeFetch, /initI18n/, 'a preload would cost every boot a round trip');
});

test('every locale still carries the strings the screen needs', () => {
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of KEYS) {
      const value = key.split('.').reduce((o, k) => (o == null ? o : o[k]), cat);
      assert.ok(value, `${file} is missing ${key}`);
    }
  }
});

/* ── A hung backend must not hold the boot veil ───────────────────────────── */

/* Both fetches carry a timeout. A backend that accepts the connection and
   never answers otherwise leaves the dashboard on a featureless veil
   indefinitely, where a refused connection reaches the error screen. */

const boot = () => {
  const src = read('js/dashboard.js');
  return src.slice(src.indexOf('async function boot()'), src.indexOf('await loadLocalIcons()'));
};

test('both boot fetches give up rather than hang', () => {
  const src = boot();
  for (const url of ['/api/auth/check', '/api/config']) {
    const at = src.indexOf(url);
    assert.ok(at > -1, `boot no longer fetches ${url}`);
    const call = src.slice(at, src.indexOf(');', at));
    assert.match(call, /AbortSignal\.timeout\(BOOT_TIMEOUT_MS\)/, `${url} can hang forever`);
  }
});

test('the timeout is long enough not to fire on a slow start', () => {
  const ms = Number(read('js/dashboard.js').match(/const BOOT_TIMEOUT_MS = (\d+)/)[1]);
  assert.ok(ms >= 10000, `${ms}ms would abort a healthy but slow first response`);
  assert.ok(ms <= 30000, `${ms}ms is long enough to read as a hang`);
});

/* An abort lands in the same catch as a refusal, so it reaches the same
   screen. */
test('a timeout reaches the API-down screen, not a blank page', () => {
  const src = boot();
  assert.match(src, /catch \(e\)[\s\S]{0,120}configFailed = true/);
});
