/* Each request the dashboard waits on before showing tiles adds a round trip on
   a remote link. Only the sign-in gate and the language depend on an earlier
   answer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');

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

test('boot starts the config, widget and icon requests before the sign-in check answers', () => {
  const start = dashboard.indexOf('async function boot()');
  const boot = dashboard.slice(start, dashboard.indexOf('\n}\n', start));
  const authAwait = boot.indexOf("await fetch('/api/auth/check'");
  assert.ok(authAwait !== -1, 'the sign-in check moved');
  const head = boot.slice(0, authAwait);
  for (const started of ["fetch('/api/config'", "fetch('/api/widgets'", 'loadLocalIcons()']) {
    assert.ok(head.includes(started), `${started} waits for the sign-in check`);
  }
  assert.doesNotMatch(head, /\bawait\b/, 'something before the sign-in check is awaited');
  const rest = boot.slice(authAwait);
  for (const read of ['await configReq', 'await widgetsReq', 'await iconsReq']) {
    assert.ok(rest.includes(read), `the early request is not the one boot reads: ${read}`);
  }
});

test('a widget list refused while the first-run password was set is requested again', () => {
  const start = dashboard.indexOf('async function boot()');
  const boot = dashboard.slice(start, dashboard.indexOf('\n}\n', start));
  assert.match(boot, /if \(!r\.ok\) throw new Error/, 'an error reply is read as the widget list');
  const prompt = boot.slice(boot.indexOf('await showSetupPrompt()'));
  assert.match(prompt.slice(0, 200), /if \(\(await widgetsReq\)\.e\) widgetsReq = loadWidgets\(\);/);
});
