import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALLOWED_HOSTS_MAX,
  firstBadHost,
  hostnameOf,
  isLocalAddress,
  normalizeHostList,
  parseHostList,
} from '../js/host-names.js';
import { HOST_BLOCKED_CODE, screenFor } from '../js/config-recovery-logic.js';

const en = JSON.parse(fs.readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8'));

test('reads the host name from a Host header or a typed address', () => {
  assert.equal(hostnameOf('Dash.Example.com:8700'), 'dash.example.com');
  assert.equal(hostnameOf('dash.example.com.'), 'dash.example.com');
  assert.equal(hostnameOf('https://dash.example.com/admin/'), 'dash.example.com');
  assert.equal(hostnameOf('[::1]:8700'), '::1');
  assert.equal(hostnameOf('192.168.1.10:80'), '192.168.1.10');
  for (const bad of ['', 'a b', 'evil.example:port', '999.1.1.1', '-a.example', 'a..b', '[zz]', null, 7])
    assert.equal(hostnameOf(bad), null, String(bad));
});

test('local addresses need no entry, public names do', () => {
  for (const h of [
    '127.0.0.1',
    '10.0.0.5',
    '::1',
    'fe80::1',
    'localhost',
    'app.localhost',
    'nas',
    'nas.local',
    'x.home.arpa',
    'y.internal',
  ])
    assert.equal(isLocalAddress(h), true, h);
  for (const h of ['dash.example.com', 'evil.example', 'local.example.com', 'internal.example'])
    assert.equal(isLocalAddress(h), false, h);
});

test('the stored list holds host names only, once each', () => {
  assert.deepEqual(normalizeHostList(['A.example', 'a.example:8700', 'b.example']), ['a.example', 'b.example']);
  assert.equal(normalizeHostList(['a b']), null);
  assert.equal(normalizeHostList('a.example'), null);
  const many = Array.from({ length: ALLOWED_HOSTS_MAX + 1 }, (_, i) => `h${i}.example`);
  assert.equal(normalizeHostList(many), null);
});

test('the Settings field takes a comma-separated list', () => {
  assert.deepEqual(parseHostList(' a.example , ,b.example '), ['a.example', 'b.example']);
  assert.equal(firstBadHost('a.example, not a host'), 'not a host');
  assert.equal(firstBadHost('a.example, b.example'), null);
});

test('a refused address gets the blocked-address screen', () => {
  const s = screenFor({ code: HOST_BLOCKED_CODE, detail: { host: 'dash.example.com' } });
  assert.equal(s.title, 'hostBlock.title');
  assert.deepEqual(s.why.vars, { host: 'dash.example.com' });
  assert.ok(s.steps.some(step => step.vars?.host === 'dash.example.com'));
  for (const key of [s.title, s.why.key, s.safe, s.stepsTitle, s.still, ...s.steps.map(x => x.key)]) {
    const [section, name] = key.split('.');
    assert.ok(en[section]?.[name], key);
  }
  assert.equal(screenFor({ code: HOST_BLOCKED_CODE, detail: {} }, 'page.example').why.vars.host, 'page.example');
  assert.equal(screenFor({ code: 'blocked.private-address' }), null);
});
