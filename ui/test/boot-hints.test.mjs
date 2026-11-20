import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/boot-hints.js'), 'utf8');

/** Runs the boot script once and returns the requests it sent and window.__early. */
function boot(dataset) {
  const sent = [];
  const window = {};
  const context = {
    window,
    localStorage: { getItem: () => null },
    document: { currentScript: { dataset }, documentElement: { style: { setProperty() {} }, classList: { add() {} } } },
    fetch: (url, init) => {
      sent.push({ url, init });
      return Promise.resolve({});
    },
    AbortSignal: { timeout: ms => ({ ms }) },
    Image: class {},
  };
  vm.runInNewContext(src, context);
  return { sent, early: window.__early, timeoutMs: window.__bootTimeoutMs };
}

test('the dashboard sends its first three requests from the boot script', () => {
  const { sent, early, timeoutMs } = boot({ early: '' });
  assert.deepEqual(
    sent.map(s => s.url),
    ['/api/auth/check', '/api/config', '/api/widgets'],
  );
  assert.ok(sent.every(s => s.init.cache === 'no-store'));
  assert.ok(timeoutMs > 0);
  assert.equal(sent[0].init.signal.ms, timeoutMs);
  assert.equal(sent[1].init.signal.ms, timeoutMs);
  assert.equal(sent[2].init.signal, undefined, 'the widget list has no timeout in boot either');
  assert.deepEqual(Object.keys(early), ['auth', 'config', 'widgets']);
});

test('Settings loads the same script and sends nothing early', () => {
  const { sent, early } = boot({});
  assert.deepEqual(sent, []);
  assert.equal(early, undefined);
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  assert.match(html, /<script src="\/js\/boot-hints\.js\?v=[0-9a-f]+"><\/script>/);
});

test('the dashboard takes the early requests once, with the boot script timeout', async () => {
  const { installDashboard } = await import('./dashboard-page.mjs');
  const { settle } = await import('./fake-dom.mjs');
  const { dom, fetch } = installDashboard();
  const send = url => fetch(url, { cache: 'no-store' });
  const early = { config: send('/api/config'), widgets: send('/api/widgets') };
  Object.assign(globalThis, { __early: early, __bootTimeoutMs: 12345 });
  const timeouts = [];
  const real = AbortSignal.timeout;
  AbortSignal.timeout = ms => {
    timeouts.push(ms);
    return real.call(AbortSignal, ms);
  };
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    await import('../js/dashboard.js');
    for (let i = 0; i < 6; i++) {
      await settle();
      dom.flushFrames();
    }
  } finally {
    AbortSignal.timeout = real;
    Math.random = random;
  }
  assert.equal(/** @type {any} */ (globalThis).__early, null, 'a second boot would reuse spent requests');
  for (const url of ['/api/auth/check', '/api/config', '/api/widgets'])
    assert.equal(fetch.calls.filter(c => c.url === url).length, 1, `${url} was sent twice`);
  assert.ok(dom.document.body.classList.contains('ready'));
  assert.equal(dom.document.querySelectorAll('#pages .icon').length, 1);
  assert.deepEqual(timeouts, [12345], 'only the sign-in check was sent by the dashboard');
  assert.ok(fetch.calls.find(c => c.url === '/api/auth/check').opts.signal instanceof AbortSignal);
});

test('no page module writes its own literal timeout', () => {
  const dir = path.join(root, 'js');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /AbortSignal\.timeout\(\d/, f);
  }
});
