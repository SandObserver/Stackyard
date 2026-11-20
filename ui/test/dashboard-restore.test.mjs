import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mock, test } from 'node:test';
import { fakeFetch, installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const routes = {};
const fetch = fakeFetch(routes);
const dom = installDom({ markup: pageBody('index.html'), fetch, location: 'http://nas.local/' });
const doc = dom.document;
const { createPolling } = await import('../js/dashboard-polling.js');

const loaded = { items: [{ id: 'a' }] };
let changed = false;
const runs = { badges: 0, health: 0 };
const polling = createPolling({
  badges: /** @type {any} */ ({
    pollBadges: async () => runs.badges++,
    pollHealth: async () => runs.health++,
  }),
  differs: () => changed,
});
const timeouts = [];
const controllers = [];
const realTimeout = AbortSignal.timeout;
AbortSignal.timeout = ms => {
  timeouts.push(ms);
  const c = new AbortController();
  controllers.push(c);
  return c.signal;
};
polling.watchRestore(4321);

const drain = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const signedIn = { enabled: true, authenticated: true };
/** Restore the page from the back/forward cache with these replies. */
async function restore({ auth = signedIn, config = loaded, persisted = true } = {}) {
  Object.assign(routes, { '/api/auth/check': auth, '/api/config': config });
  Object.assign(runs, { badges: 0, health: 0 });
  dom.location.reloads = 0;
  timeouts.length = 0;
  doc.body.classList.remove('ready', 'api-down');
  doc.querySelector('.api-error-screen')?.remove();
  for (const c of doc.body.children) c.inert = false;
  fetch.calls.length = 0;
  dom.window.dispatchEvent({ type: 'pageshow', persisted });
  await drain();
}

test('a page put in the back/forward cache drops its veil, and one that is unloaded keeps it', () => {
  doc.body.classList.add('ready');
  dom.window.dispatchEvent({ type: 'pagehide', persisted: false });
  assert.ok(doc.body.classList.contains('ready'));
  dom.window.dispatchEvent({ type: 'pagehide', persisted: true });
  assert.equal(doc.body.classList.contains('ready'), false);
});

test('a fresh page load is not treated as a restore', async () => {
  await restore({ persisted: false });
  assert.deepEqual(fetch.calls, []);
  assert.equal(doc.body.classList.contains('ready'), false);
});

test('a restored page checks the session and config, then polls and lifts the veil', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await restore();
    assert.deepEqual(fetch.calls.map(c => c.url).sort(), ['/api/auth/check', '/api/config']);
    for (const c of fetch.calls) {
      assert.equal(c.opts.redirect, 'manual', `${c.url} follows a redirect`);
      assert.equal(c.opts.signal, controllers.at(-1).signal, `${c.url} has no time limit`);
    }
    assert.deepEqual(timeouts, [4321], 'one boot timeout covers both checks');
    assert.deepEqual(runs, { badges: 1, health: 1 });
    assert.ok(doc.body.classList.contains('ready'));
    assert.equal(dom.location.reloads, 0);
    mock.timers.tick(31_000);
    await drain();
    assert.deepEqual(runs, { badges: 2, health: 2 }, 'the polls did not start again');
    polling.stopPolling();
  } finally {
    mock.timers.reset();
  }
});

test('a restore after a sign-out reloads under the veil', async () => {
  await restore({ auth: { enabled: true, authenticated: false } });
  assert.equal(dom.location.reloads, 1);
  assert.equal(doc.body.classList.contains('ready'), false);
  assert.deepEqual(runs, { badges: 0, health: 0 });
});

test('a restore reloads when the config changed', async () => {
  changed = true;
  try {
    await restore();
  } finally {
    changed = false;
  }
  assert.equal(dom.location.reloads, 1);
});

test('a restore over the error screen reloads once the server answers', async () => {
  Object.assign(routes, { '/api/auth/check': signedIn, '/api/config': loaded });
  doc.body.classList.add('api-down');
  fetch.calls.length = 0;
  dom.location.reloads = 0;
  dom.window.dispatchEvent({ type: 'pageshow', persisted: true });
  await drain();
  assert.equal(dom.location.reloads, 1);
});

test('a restore with no answer before the timeout shows the server error', async () => {
  const hang = (_url, opts) =>
    new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason)));
  await restore({ auth: hang, config: hang });
  assert.equal(doc.querySelector('.api-error-screen'), null, 'gave up before the timeout');
  controllers.at(-1).abort(new DOMException('timed out', 'TimeoutError'));
  await drain();
  assert.ok(doc.querySelector('.api-error-screen[role="alert"]'), 'no error screen');
  assert.equal(dom.location.reloads, 0);
  assert.equal(doc.body.classList.contains('ready'), false);
  assert.deepEqual(runs, { badges: 0, health: 0 });
});

test.after(() => {
  polling.stopPolling();
  AbortSignal.timeout = realTimeout;
});
