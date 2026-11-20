/* Each request the dashboard waits on before showing tiles adds a round trip on
   a remote link. The boot's own order is checked in dashboard-boot.test.mjs. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

test('the English and selected catalogs are requested together', async () => {
  const i18n = await import(`../js/i18n.js?fresh=${Date.now()}`);
  globalThis.document = { documentElement: { setAttribute() {} } };
  const requested = [];
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  globalThis.fetch = async url => {
    requested.push(String(url));
    await gate;
    return { ok: true, json: async () => ({ home: { title: String(url) } }) };
  };
  const done = i18n.initI18n('fa');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(requested.sort(), ['/i18n/en.json', '/i18n/fa.json'], 'the second catalog waited for the first');
  release();
  await done;
  assert.equal(i18n.currentLang(), 'fa');
});
