/* The API-down screen loads a catalog before it renders. The catalog is
   otherwise loaded as the last statement of the try that fetches the config, so
   a failed fetch skips it and t() answers with the key: the one screen the
   dashboard can show in that state reads "home.apiDownTitle".

   The boot itself is driven in dashboard-boot.test.mjs. */

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

test('the timeout is long enough not to fire on a slow start', () => {
  const ms = Number(read('js/boot-hints.js').match(/const timeoutMs = (\d+)/)[1]);
  assert.ok(ms >= 10000, `${ms}ms would abort a healthy but slow first response`);
  assert.ok(ms <= 30000, `${ms}ms is long enough to read as a hang`);
});
