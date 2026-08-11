const path = require('node:path');
/* Load the real shipped manifests so this exercises the actual field
   declarations, not a fixture. */
process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');
const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scrubConfigSecrets, preserveConfigSecrets } = require('../src/widget-secrets');
const { scrubAllSecrets, preserveAllSecrets } = require('../src/config-secrets');

function sampleConfig() {
  return {
    items: [
      {
        id: 'b1',
        type: 'widget',
        widgetType: 'backup',
        widgetConfig: {
          slots: [
            { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'DUP' },
            { provider: 'kopia', kopiaUrl: 'http://k:51515', kopiaPass: 'KOP' },
          ],
        },
      },
      {
        id: 's1',
        type: 'widget',
        widgetType: 'stats',
        widgetConfig: {
          truenasKey: 'TRUENAS',
          network: { myspeedPass: 'MYSPEED', enabled: true },
        },
      },
      {
        id: 'c1',
        type: 'widget',
        widgetType: 'connections',
        widgetConfig: {
          vpn: { apiKey: 'VPNAPI', token: 'VPNTOK' },
          services: [{ id: 'x', token: 'SVC' }],
        },
      },
    ],
  };
}

function anySecretLeft(obj) {
  const found = [];
  JSON.stringify(obj, (k, v) => {
    if (typeof v === 'string' && ['DUP', 'KOP', 'MYSPEED', 'TRUENAS', 'VPNAPI', 'VPNTOK', 'SVC'].includes(v))
      found.push(k);
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
  return {
    id: 'a1',
    type: 'app',
    name: 'A',
    url: 'http://x',
    badge: {
      headers: [
        { key: 'Authorization', value: 'BADGESECRET', secret: true },
        { key: 'X-Env', value: 'prod', secret: false },
      ],
    },
  };
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

/* ── a stored secret belongs to the request it was stored for ─────────────── */

/* Refilling by item id alone let a config file take a credential out of an
   install: keep the id and the header, mark the value as still stored, and
   point the request somewhere else, and the next poll delivered the stored
   token to whoever the file named. A config is a thing people import from
   elsewhere, so the file is the attack. The two endpoints that test a badge or
   a widget already refuse this; the save path refuses it too now. */

test('a badge secret is not refilled once the request points elsewhere', () => {
  const stored = {
    items: [
      {
        id: 'b1',
        type: 'app',
        label: 'Badge',
        monitoring: {
          activity: {
            enabled: true,
            url: 'https://legit.example/api',
            headers: [{ key: 'Authorization', value: 'Bearer REAL', secret: true }],
          },
        },
      },
    ],
  };
  const incoming = {
    items: [
      {
        id: 'b1',
        type: 'app',
        label: 'Badge',
        monitoring: {
          activity: {
            enabled: true,
            url: 'https://attacker.example/collect',
            headers: [{ key: 'Authorization', value: '', secret: true }],
          },
        },
      },
    ],
  };
  const { withheld } = preserveAllSecrets(incoming, stored);
  assert.equal(incoming.items[0].monitoring.activity.headers[0].value, '', 'the token did not travel');
  assert.deepEqual(
    withheld.map(w => w.id),
    ['b1'],
    'and the save says which credential has to be entered again',
  );
});

test('a badge secret survives a save that changed nothing about the request', () => {
  const stored = {
    items: [
      {
        id: 'b1',
        type: 'app',
        monitoring: {
          activity: {
            url: 'https://legit.example/api',
            headers: [{ key: 'Authorization', value: 'Bearer REAL', secret: true }],
          },
        },
      },
    ],
  };
  /* What restoring an export looks like: the value is gone, everything else is
     as it was. */
  const incoming = {
    items: [
      {
        id: 'b1',
        type: 'app',
        monitoring: {
          activity: {
            url: 'https://legit.example/api',
            headers: [{ key: 'Authorization', secret: true, valueSet: true }],
          },
        },
      },
    ],
  };
  const { withheld } = preserveAllSecrets(incoming, stored);
  assert.equal(incoming.items[0].monitoring.activity.headers[0].value, 'Bearer REAL');
  assert.deepEqual(withheld, []);
});

test('renaming the app keeps its badge credential', () => {
  const activity = {
    url: 'https://legit.example/api',
    headers: [{ key: 'Authorization', value: 'Bearer REAL', secret: true }],
  };
  const stored = { items: [{ id: 'b1', type: 'app', label: 'Before', monitoring: { activity } }] };
  const incoming = {
    items: [
      {
        id: 'b1',
        type: 'app',
        label: 'After',
        href: 'https://new.example',
        monitoring: {
          activity: { url: 'https://legit.example/api', headers: [{ key: 'Authorization', value: '', secret: true }] },
        },
      },
    ],
  };
  const { withheld } = preserveAllSecrets(incoming, stored);
  assert.equal(incoming.items[0].monitoring.activity.headers[0].value, 'Bearer REAL');
  assert.deepEqual(withheld, []);
});

test('a widget secret is not refilled once its config points elsewhere', () => {
  const stored = {
    items: [
      {
        id: 'w1',
        type: 'widget',
        widgetType: 'books',
        label: 'Books',
        widgetConfig: { provider: 'abs', absUrl: 'https://books.legit.example', absKey: 'REAL_KEY' },
      },
    ],
  };
  const incoming = {
    items: [
      {
        id: 'w1',
        type: 'widget',
        widgetType: 'books',
        label: 'Books',
        widgetConfig: { provider: 'abs', absUrl: 'https://attacker.example', absKeySet: true },
      },
    ],
  };
  const { withheld } = preserveAllSecrets(incoming, stored);
  assert.equal(incoming.items[0].widgetConfig.absKey, undefined, 'the key did not travel');
  assert.deepEqual(
    withheld.map(w => w.id),
    ['w1'],
  );
});

test('a widget secret survives a save that changed nothing else', () => {
  const stored = {
    items: [
      {
        id: 'w1',
        type: 'widget',
        widgetType: 'books',
        widgetConfig: { provider: 'abs', absUrl: 'https://books.legit.example', absKey: 'REAL_KEY' },
      },
    ],
  };
  const incoming = {
    items: [
      {
        id: 'w1',
        type: 'widget',
        widgetType: 'books',
        widgetConfig: { provider: 'abs', absUrl: 'https://books.legit.example', absKeySet: true },
      },
    ],
  };
  const { withheld } = preserveAllSecrets(incoming, stored);
  assert.equal(incoming.items[0].widgetConfig.absKey, 'REAL_KEY');
  assert.deepEqual(withheld, []);
});

test('an item that never had a stored secret is not reported', () => {
  const stored = { items: [{ id: 'a1', type: 'app', monitoring: { activity: { url: 'https://a.example' } } }] };
  const incoming = { items: [{ id: 'a1', type: 'app', monitoring: { activity: { url: 'https://b.example' } } }] };
  assert.deepEqual(preserveAllSecrets(incoming, stored).withheld, []);
});
