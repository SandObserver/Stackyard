const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../../ui/js/settings-schema.js');
const { SHARED_KEYS } = require('../src/widget-settings');

const read = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

test('each key is listed once per place, in a known place', () => {
  const seen = new Set();
  for (const { key, place } of schema.SETTINGS) {
    assert.ok(place === schema.TOP || place === schema.SERVER, `${key}: unknown place ${place}`);
    assert.ok(!seen.has(`${place}.${key}`), `${place}.${key} is listed twice`);
    seen.add(`${place}.${key}`);
  }
});

test('widgets see only the keys the schema marks, and never auth or server', () => {
  assert.deepEqual([...SHARED_KEYS], ['stats']);
  for (const key of ['auth', 'server', 'background']) assert.ok(!SHARED_KEYS.includes(key), key);
  for (const s of schema.SETTINGS) if (s.widgets) assert.equal(s.place, schema.TOP, `${s.key} is not top level`);
});

test('the General lists are the keys the General section writes', () => {
  assert.deepEqual(schema.generalKeysIn(schema.TOP), ['logLevel', 'language']);
  assert.deepEqual(schema.generalKeysIn(schema.SERVER), [
    'hostIp',
    'healthChecks',
    'socketProxyUrl',
    'hideHealthyBadge',
    'proxmox',
    'allowedHosts',
  ]);
});

test('unknown keys are dropped and named, at the top and in server', () => {
  const settings = { theme: 'dark', x: 1, server: { hostIp: 'h', y: 2, portMap: { 1: 'a' } } };
  assert.deepEqual(schema.normalizeSettings(settings), ['x', 'server.y']);
  assert.deepEqual(settings, { theme: 'dark', server: { hostIp: 'h', portMap: { 1: 'a' } } });
});

test('keys nested below a listed key are left alone', () => {
  const settings = { stats: { anything: 1 }, server: { proxmox: { url: 'u', extra: true } } };
  assert.deepEqual(schema.normalizeSettings(settings), []);
  assert.deepEqual(settings, { stats: { anything: 1 }, server: { proxmox: { url: 'u', extra: true } } });
});

test('each normalising rule keeps the stored form', () => {
  const cases = [
    [{ keepAwake: 'yes' }, { keepAwake: false }],
    [{ keepAwake: true }, { keepAwake: true }],
    [{ typeToSearch: 'no' }, { typeToSearch: true }],
    [{ typeToSearch: false }, { typeToSearch: false }],
    [{ logLevel: 'loud' }, {}],
    [{ logLevel: 'debug' }, { logLevel: 'debug' }],
    [{ language: 'not a tag' }, {}],
    [{ language: 'zh-Hans' }, { language: 'zh-Hans' }],
  ];
  for (const [given, stored] of cases) {
    schema.normalizeSettings(given);
    assert.deepEqual(given, stored);
  }
});

test('a settings value that is not an object is left for the caller', () => {
  for (const v of [null, undefined, 'x', [1]]) assert.deepEqual(schema.normalizeSettings(v), []);
  const settings = { server: 'x' };
  assert.deepEqual(schema.normalizeSettings(settings), []);
  assert.equal(settings.server, 'x');
});

test('the schema references nothing only a browser provides', () => {
  const body = read('ui/js/settings-schema.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [/\bwindow\b/, /\bdocument\b/, /\blocation\b/, /^\s*import\s/m]) {
    assert.doesNotMatch(body, forbidden, `the schema must not use ${forbidden}`);
  }
});

test('the Dockerfile puts the schema where the server can require it', () => {
  assert.match(read('Dockerfile'), /^COPY ui\/js\/settings-schema\.js \/app\/ui\/js\/settings-schema\.js$/m);
});
