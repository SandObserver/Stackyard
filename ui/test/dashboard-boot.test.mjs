/* The dashboard boot against a fake API: which requests go out and when, and
   what a failed or hung backend leaves on screen. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { app, installDashboard } from './dashboard-page.mjs';
import { settle } from './fake-dom.mjs';

const fr = JSON.parse(readFileSync(new URL('../i18n/fr.json', import.meta.url), 'utf8'));
const realTimeout = AbortSignal.timeout;

/** Boot once against routes. Returns when boot has settled. */
async function run(opts = {}, during = async () => {}) {
  const page = installDashboard(opts);
  const timeouts = [];
  AbortSignal.timeout = ms => {
    timeouts.push(ms);
    return realTimeout.call(AbortSignal, ms);
  };
  const errors = [];
  const logError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { boot } = await import('../js/dashboard-boot.js');
    const { createDashboardState } = await import('../js/dashboard-state.js');
    const dash = createDashboardState({ bootTimeoutMs: 15000 });
    const done = boot(dash);
    await during(page);
    for (let i = 0; i < 6; i++) {
      await settle();
      page.dom.flushFrames();
    }
    await done;
    page.dom.document.hidden = true;
    page.dom.document.dispatchEvent({ type: 'visibilitychange' });
    const urls = page.fetch.calls.map(c => c.url);
    return { ...page, dash, timeouts, errors, urls, body: page.dom.document.body };
  } finally {
    AbortSignal.timeout = realTimeout;
    console.error = logError;
  }
}

const count = (urls, url) => urls.filter(u => u === url).length;

test('config, widgets and icons are requested before the sign-in check answers', async () => {
  let release;
  const gate = new Promise(r => {
    release = r;
  });
  let sentFirst = [];
  const page = await run(
    {
      routes: {
        '/api/auth/check': async () => {
          await gate;
          return { enabled: false, setupPrompted: true, passwordSet: true };
        },
      },
    },
    async p => {
      await settle(5);
      sentFirst = p.fetch.calls.map(c => c.url);
      release();
    },
  );
  for (const url of ['/api/config', '/api/widgets', '/api/icons/local', '/api/auth/check'])
    assert.ok(sentFirst.includes(url), `${url} waits for the sign-in check`);
  assert.ok(page.body.classList.contains('ready'));
  assert.equal(page.dom.document.querySelectorAll('#pages .icon').length, 1);
});

test('the sign-in check and the config give up after the boot timeout, the widget list does not', async () => {
  const page = await run();
  const opts = url => page.fetch.calls.find(c => c.url === url).opts;
  assert.ok(opts('/api/config').signal instanceof AbortSignal);
  assert.ok(opts('/api/auth/check').signal instanceof AbortSignal);
  assert.equal(opts('/api/widgets').signal, undefined);
  assert.deepEqual(page.timeouts, [15000, 15000]);
});

test('a good boot loads one catalog and remembers its language', async () => {
  const page = await run({
    config: { items: [app('a')], settings: { language: 'fr' } },
    routes: { '/i18n/fr.json': fr },
  });
  assert.equal(count(page.urls, '/i18n/en.json'), 1, 'the failure path would cost every boot a catalog');
  assert.ok(page.urls.indexOf('/i18n/en.json') > page.urls.indexOf('/api/config'));
  assert.equal(page.dom.storage.get('dash_lang'), 'fr');
  assert.equal(page.body.querySelector('.api-error-screen'), null);
});

test('an unreachable API shows a translated alert in the last good language', async () => {
  const page = await run({
    storage: { dash_lang: 'fr' },
    routes: { '/api/config': new TypeError('Failed to fetch'), '/i18n/fr.json': fr },
  });
  const screen = page.body.querySelector('.api-error-screen');
  assert.ok(screen, 'no error screen');
  assert.equal(screen.getAttribute('role'), 'alert');
  assert.equal(screen.querySelector('h2.api-error-title').textContent, fr.home.apiDownTitle);
  assert.equal(screen.querySelector('.api-error-btn').textContent, fr.home.retry);
  assert.ok(page.body.classList.contains('api-down'));
  assert.ok(page.body.classList.contains('ready'), 'the veil stays up');
  screen.querySelector('.api-error-btn').click();
  assert.equal(page.dom.location.reloads, 1);
});

test('a timed-out config reaches the same screen', async () => {
  const abort = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const page = await run({ routes: { '/api/config': abort, '/api/auth/check': abort } });
  assert.equal(page.body.querySelector('.api-error-title').textContent, "Stackyard Isn't Responding");
});

test('a widget list that fails once is asked for again', async () => {
  let n = 0;
  const page = await run({ routes: { '/api/widgets': () => (n++ ? { widgets: [] } : { status: 500, body: {} }) } });
  assert.equal(count(page.urls, '/api/widgets'), 2);
  assert.equal(page.body.querySelector('.api-error-screen'), null);
  assert.equal(page.dom.document.querySelectorAll('#pages .icon').length, 1);
});

test('a widget list that fails twice shows the API-down screen', async () => {
  const page = await run({ routes: { '/api/widgets': new TypeError('Failed to fetch') } });
  assert.equal(count(page.urls, '/api/widgets'), 2);
  assert.ok(page.body.querySelector('.api-error-screen'));
});

test('the first-run prompt waits before the tiles are drawn', async () => {
  let prompt = null;
  const page = await run({ auth: { enabled: false, setupPrompted: false, passwordSet: false } }, async p => {
    await settle(5);
    prompt = p.dom.document.querySelector('dialog.setup-prompt');
    assert.equal(p.dom.document.querySelectorAll('#pages .icon').length, 0);
    prompt.close();
  });
  assert.ok(prompt, 'no prompt');
  assert.equal(page.dom.document.querySelectorAll('#pages .icon').length, 1);
});

test('a refused sign-in check sends the page to Settings', async () => {
  const page = await run({ routes: { '/api/auth/check': { status: 401, body: {} } } });
  assert.equal(page.dom.location.href, '/admin/');
  assert.equal(page.dom.document.querySelectorAll('#pages .icon').length, 0);
});
