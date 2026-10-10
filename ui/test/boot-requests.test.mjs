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
  assert.match(boot, /if \(!r\.ok\) throw /, 'an error reply is read as the widget list');
  const prompt = boot.slice(boot.indexOf('await showSetupPrompt()'));
  assert.match(prompt.slice(0, 200), /if \(\(await widgetsReq\)\.e\) widgetsReq = loadWidgets\(\);/);
});

const firstVisitOrders = [
  ['/api/config', '/api/widgets', '/api/icons/local'],
  ['/api/widgets'],
  ['/api/icons/local'],
  ['/api/config'],
];

for (const early of firstVisitOrders) {
  test(`a first visit by host name asks again for what was refused: ${early.join(', ')}`, async () => {
    const start = dashboard.indexOf('async function boot()');
    const src = dashboard.slice(start, dashboard.indexOf('\n}\n', start) + 2);
    let trusted = false;
    const sent = [];
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    const fetch = async url => {
      sent.push(url);
      const wait = url === '/api/auth/check' ? 5 : early.includes(url) ? 0 : 10;
      await new Promise(r => setTimeout(r, wait));
      if (url === '/api/auth/check') {
        trusted = true;
        return reply(200, { enabled: false, passwordSet: false, setupPrompted: false });
      }
      if (!trusted) return reply(403, { kind: 'blocked', code: 'blocked.host' });
      return reply(200, url === '/api/config' ? { items: [], settings: {}, _rev: 1 } : { widgets: [], files: [] });
    };
    const shown = [];
    const stop = new Error('reached the first-run prompt');
    const boot = new Function(
      'fetch, loadLocalIcons, document, initI18n, sanitizeItemLinks, showSetupPrompt, setHtml, html, t, BOOT_TIMEOUT_MS, blockingScreenFor, showBlockingScreen, console',
      `let items, S, _rev, widgetReg; ${src} return boot;`,
    )(
      fetch,
      async () => (await fetch('/api/icons/local')).status,
      {
        body: { appendChild: el => shown.push(el.className), classList: { add() {} } },
        createElement: () => ({ querySelector: () => null }),
      },
      async () => {},
      x => x,
      async () => {
        throw stop;
      },
      () => {},
      () => '',
      k => k,
      1000,
      () => null,
      async () => {},
      { error() {} },
    );
    await assert.rejects(boot(), stop);
    assert.deepEqual(shown, [], 'the API-down screen was shown');
    for (const url of ['/api/config', '/api/widgets', '/api/icons/local']) {
      const times = early.includes(url) ? 2 : 1;
      assert.equal(
        sent.filter(u => u === url).length,
        times,
        times === 2 ? `${url} not sent again after a refusal` : `${url} sent again without a refusal`,
      );
    }
  });
}

for (const failures of [1, 2]) {
  test(`a widget list that fails ${failures === 1 ? 'once is asked for again' : 'twice shows the API-down screen'}`, async () => {
    const start = dashboard.indexOf('async function boot()');
    const src = dashboard.slice(start, dashboard.indexOf('\n}\n', start) + 2);
    const sent = [];
    let left = failures;
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    const fetch = async url => {
      sent.push(url);
      if (url === '/api/auth/check') return reply(200, { enabled: false, passwordSet: false, setupPrompted: false });
      if (url === '/api/widgets' && left-- > 0) throw new TypeError('Failed to fetch');
      return reply(200, url === '/api/config' ? { items: [], settings: {}, _rev: 1 } : { widgets: [], files: [] });
    };
    const shown = [];
    const stop = new Error('reached the first-run prompt');
    const boot = new Function(
      'fetch, loadLocalIcons, document, initI18n, sanitizeItemLinks, showSetupPrompt, setHtml, html, t, BOOT_TIMEOUT_MS, blockingScreenFor, showBlockingScreen, console',
      `let items, S, _rev, widgetReg; ${src} return boot;`,
    )(
      fetch,
      async () => (await fetch('/api/icons/local')).status,
      {
        body: { appendChild: el => shown.push(el.className), classList: { add() {} } },
        createElement: () => ({ querySelector: () => null }),
      },
      async () => {},
      x => x,
      async () => {
        throw stop;
      },
      () => {},
      () => '',
      k => k,
      1000,
      () => null,
      async () => {},
      { error() {} },
    );
    if (failures === 1) await assert.rejects(boot(), stop);
    else await boot();
    assert.equal(sent.filter(u => u === '/api/widgets').length, 2);
    assert.deepEqual(shown, failures === 1 ? [] : ['api-error-screen']);
  });
}
