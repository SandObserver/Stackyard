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
  return { sent, early: window.__early };
}

test('the dashboard sends its first three requests from the boot script', () => {
  const { sent, early } = boot({ early: '' });
  assert.deepEqual(
    sent.map(s => s.url),
    ['/api/auth/check', '/api/config', '/api/widgets'],
  );
  assert.ok(sent.every(s => s.init.cache === 'no-store'));
  const dashboard = fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');
  const limit = Number(/const BOOT_TIMEOUT_MS = (\d+);/.exec(dashboard)?.[1]);
  assert.ok(limit > 0, 'BOOT_TIMEOUT_MS moved');
  assert.equal(sent[0].init.signal.ms, limit, 'the boot script and the dashboard time out apart');
  assert.equal(sent[1].init.signal.ms, limit);
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

test('dashboard.js takes the early requests once, and falls back to its own', () => {
  const js = fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');
  assert.match(
    js,
    /const early = \/\*\* @type \{any\} \*\/ \(window\)\.__early;\s*\/\*\* @type \{any\} \*\/ \(window\)\.__early = null;/,
  );
  assert.match(js, /early\?\.config \?\? fetch\('\/api\/config'/);
  assert.match(js, /loadWidgets\(early\?\.widgets\)/);
});
