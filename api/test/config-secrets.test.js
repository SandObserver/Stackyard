const path = require('node:path');
/* Load the real shipped manifests so this exercises the actual field
   declarations, not a fixture. */
process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');
process.env.CONFIG_PATH = '/tmp/stackyard-config-secrets-test-nonexistent.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scrubConfigSecrets, preserveConfigSecrets } = require('../src/widget-secrets');
const { scrubAllSecrets, preserveAllSecrets } = require('../src/config-secrets');

function sampleConfig() {
  return { items: [
    { id: 'b1', type: 'widget', widgetType: 'backup', widgetConfig: { slots: [
      { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'DUP' },
      { provider: 'kopia', kopiaUrl: 'http://k:51515', kopiaPass: 'KOP' },
    ] } },
    { id: 's1', type: 'widget', widgetType: 'stats', widgetConfig: {
      truenasKey: 'TRUENAS', network: { myspeedPass: 'MYSPEED', enabled: true } } },
    { id: 'c1', type: 'widget', widgetType: 'connections', widgetConfig: {
      vpn: { apiKey: 'VPNAPI', token: 'VPNTOK' },
      services: [{ id: 'x', token: 'SVC' }] } },
  ] };
}

function anySecretLeft(obj) {
  const found = [];
  JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string' && ['DUP', 'KOP', 'MYSPEED', 'TRUENAS', 'VPNAPI', 'VPNTOK', 'SVC'].includes(v)) found.push(k);
    return v;
  });
  return found;
}

test('scrubConfigSecrets strips every widget secret, including backup slots (was leaking)', () => {
  const copy = JSON.parse(JSON.stringify(sampleConfig()));
  scrubConfigSecrets(copy);
  assert.deepEqual(anySecretLeft(copy), []);
  const [b, s, c] = copy.items;
  assert.equal(b.widgetConfig.slots[0].dupPassSet, true);
  assert.equal(b.widgetConfig.slots[1].kopiaPassSet, true);
  assert.equal(s.widgetConfig.truenasKeySet, true);
  assert.equal(s.widgetConfig.network.myspeedPassSet, true);
  assert.equal(s.widgetConfig.network.enabled, true);
  assert.equal(c.widgetConfig.vpn.apiKeySet, true);
  assert.equal(c.widgetConfig.services[0].tokenSet, true);
});

test('preserveConfigSecrets restores secrets the browser omitted after scrubbing', () => {
  const existing = sampleConfig();
  /* Simulate the browser sending back the scrubbed config unchanged (only Set
     flags, no secret values). */
  const incoming = JSON.parse(JSON.stringify(existing));
  scrubConfigSecrets(incoming);
  preserveConfigSecrets(incoming, existing);
  const [b, s, c] = incoming.items;
  assert.equal(b.widgetConfig.slots[0].dupPass, 'DUP');
  assert.equal(b.widgetConfig.slots[1].kopiaPass, 'KOP');
  assert.equal(s.widgetConfig.truenasKey, 'TRUENAS');
  assert.equal(s.widgetConfig.network.myspeedPass, 'MYSPEED');
  assert.equal(c.widgetConfig.vpn.apiKey, 'VPNAPI');
  assert.equal(c.widgetConfig.vpn.token, 'VPNTOK');
  assert.equal(c.widgetConfig.services[0].token, 'SVC');
});

test('a newly submitted secret survives instead of being overwritten by the old one', () => {
  const existing = sampleConfig();
  const incoming = JSON.parse(JSON.stringify(existing));
  incoming.items[1].widgetConfig.truenasKey = 'NEWKEY';
  preserveConfigSecrets(incoming, existing);
  assert.equal(incoming.items[1].widgetConfig.truenasKey, 'NEWKEY');
});

/* An app item carrying a secret badge header, so the facade tests exercise the
   badge system alongside the widget system in one pass. */
function badgeApp() {
  return { id: 'a1', type: 'app', name: 'A', url: 'http://x', badge: { headers: [
    { key: 'Authorization', value: 'BADGESECRET', secret: true },
    { key: 'X-Env', value: 'prod', secret: false },
  ] } };
}

test('scrubAllSecrets runs the widget and badge scrubbers in one pass', () => {
  const cfg = sampleConfig();
  cfg.items.push(badgeApp());
  const copy = JSON.parse(JSON.stringify(cfg));
  scrubAllSecrets(copy);
  assert.deepEqual(anySecretLeft(copy), []);
  const app = copy.items.find(i => i.id === 'a1');
  assert.equal(app.badge.headers[0].value, undefined);
  assert.equal(app.badge.headers[0].secret, true);
  assert.equal(app.badge.headers[0].valueSet, true);
  assert.equal(app.badge.headers[1].value, 'prod');
});

test('preserveAllSecrets restores widget and badge secrets in one call', () => {
  const existing = sampleConfig();
  existing.items.push(badgeApp());
  const incoming = JSON.parse(JSON.stringify(existing));
  scrubAllSecrets(incoming);
  preserveAllSecrets(incoming, existing);
  assert.equal(incoming.items[1].widgetConfig.truenasKey, 'TRUENAS');
  const app = incoming.items.find(i => i.id === 'a1');
  assert.equal(app.badge.headers[0].value, 'BADGESECRET');
  assert.equal(app.badge.headers[0].valueSet, undefined);
  assert.equal(incoming.items[0].widgetConfig.slots[0].dupPass, 'DUP');
});
