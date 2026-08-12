const { test } = require('node:test');
const assert = require('node:assert/strict');
const { widgetSettings, SHARED_KEYS } = require('../src/widget-settings');

const FULL = () => ({
  auth: { enabled: true, secret: 'SIGNING-KEY', passwordHash: 'scrypt$1$2$3$salt$key' },
  server: {
    hostIp: '192.168.1.10',
    socketProxyUrl: 'http://socket:2375',
    skipTlsVerify: true,
    portMap: { 8080: 'app' },
  },
  background: { type: 'url', url: '/wall.jpg' },
  stats: { diskMount: '/mnt/media', networkInterface: 'eth1' },
  logLevel: 'info',
  language: 'de',
});

test('the shared keys are passed through', () => {
  const out = widgetSettings(FULL());
  assert.deepEqual(Object.keys(out), ['stats']);
  assert.equal(out.stats.diskMount, '/mnt/media');
  assert.equal(out.stats.networkInterface, 'eth1');
});

test('no secret or infrastructure setting is passed', () => {
  const out = widgetSettings(FULL());
  assert.equal(out.auth, undefined);
  assert.equal(out.server, undefined);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('SIGNING-KEY'), 'the session signing key must not reach a widget');
  assert.ok(!text.includes('scrypt$'), 'the password hash must not reach a widget');
  assert.ok(!text.includes('192.168.1.10'));
  assert.ok(!text.includes('socket:2375'));
});

test('a newly added setting is withheld by default', () => {
  const out = widgetSettings({ ...FULL(), someNewApiKey: 'FUTURE-SECRET' });
  assert.equal(out.someNewApiKey, undefined);
  assert.ok(!JSON.stringify(out).includes('FUTURE-SECRET'));
});

/* Widget data functions are sloppy-mode CommonJS, where a write to a frozen
   object fails silently rather than throwing, so what matters is that the write
   does not take effect. */
test('the result is a copy, so a data function cannot rewrite stored config', () => {
  const settings = FULL();
  const out = widgetSettings(settings);
  assert.notEqual(out.stats, settings.stats, 'must not hand over the live object');
  out.stats.diskMount = '/etc';
  out.injected = 1;
  assert.equal(out.stats.diskMount, '/mnt/media', 'the write must not take effect');
  assert.equal(out.injected, undefined);
  assert.equal(settings.stats.diskMount, '/mnt/media', 'the stored config is untouched');
});

test('nested objects are frozen too, not just the top level', () => {
  const out = widgetSettings({ stats: { diskMount: '/', nested: { deep: 1 } } });
  assert.ok(Object.isFrozen(out.stats.nested));
  out.stats.nested.deep = 2;
  assert.equal(out.stats.nested.deep, 1);
});

/* And in strict mode, which is what an author writing a modern data.js gets if
   they add 'use strict', the same write throws rather than passing unnoticed. */
test('a strict-mode write throws', () => {
  'use strict';
  const out = widgetSettings(FULL());
  assert.throws(() => {
    out.stats.diskMount = '/etc';
  }, TypeError);
});

test('a missing, empty or malformed settings object yields an empty result', () => {
  for (const v of [undefined, null, {}, 'nope', 42, []]) {
    assert.deepEqual(Object.keys(widgetSettings(v)), [], String(v));
  }
});

test('a shared key that is absent is not invented', () => {
  const out = widgetSettings({ auth: { secret: 'x' } });
  assert.deepEqual(Object.keys(out), []);
  assert.ok(!Object.hasOwn(out, 'stats'), 'absent must stay absent, not become undefined');
});

/* An inherited name must not be mistaken for a stored setting. */
test('lookups do not resolve to inherited members', () => {
  const out = widgetSettings(FULL());
  assert.equal(out.constructor, undefined);
  assert.equal(out.toString, undefined);
});

test('SHARED_KEYS lists only non-secret keys', () => {
  for (const k of SHARED_KEYS) {
    assert.ok(!['auth', 'server'].includes(k), `${k} must never be shared with widgets`);
  }
});
