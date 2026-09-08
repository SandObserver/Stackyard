/* Runs with DEMO_MODE on, so it must be its own process. node --test isolates
   files, so setting the env here does not affect the other test files. */
process.env.DEMO_MODE = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { _internals } = require('../src/proxy');
const { fetchJSON, pingUrl } = _internals;

const demoRaw = fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-config.json'), 'utf8');
const demo = JSON.parse(demoRaw);

/* Only these hosts may appear in the demo config. Anything else, including any
   real or private host, fails the build. The check is an allowlist so the repo
   never has to name the hosts it is trying to keep out. */
function hostAllowed(host) {
  return (
    host === 'example.com' || host.endsWith('.example.com') || host === 'github.com' || host === 'cdn.jsdelivr.net'
  );
}

const URL_RE = /https?:\/\/([^/"'\s)]+)/gi;
const PRIVATE_IP_RE = /\b(?:10\.\d|127\.\d|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|pass)$/i;

function walk(node, fn, keyPath = '') {
  if (Array.isArray(node)) {
    node.forEach(v => walk(v, fn, keyPath));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      fn(k, v);
      walk(v, fn, keyPath + '.' + k);
    }
  }
}

test('demo config exposes no host outside the public allowlist', () => {
  const bad = [];
  for (const m of demoRaw.matchAll(URL_RE)) {
    const host = m[1].toLowerCase();
    if (!hostAllowed(host)) bad.push(host);
  }
  assert.deepEqual([...new Set(bad)], [], `disallowed hosts: ${[...new Set(bad)].join(', ')}`);
});

test('demo config contains no private IP address', () => {
  assert.doesNotMatch(demoRaw, PRIVATE_IP_RE);
});

test('demo config carries no secret values, only Set flags', () => {
  const leaks = [];
  walk(demo, (k, v) => {
    if (typeof v === 'string' && v && SECRET_KEY_RE.test(k)) leaks.push(k);
  });
  assert.deepEqual(leaks, [], `secret-shaped values present: ${leaks.join(', ')}`);
});

test('demo config has the expected showcase shape', () => {
  const types = demo.items.reduce((a, i) => {
    a[i.type] = (a[i.type] || 0) + 1;
    return a;
  }, {});
  assert.equal(types.widget, 6);
  assert.equal(types.app, 24);
  assert.equal(types.folder, 2);
  assert.equal(demo.settings.background.url, '/demo-wallpaper.jpg');
  assert.equal(demo.settings.background.brightness, 0.4);
  assert.equal(demo.items.filter(i => i.dock).length, 4);
  assert.equal(demo.settings.auth.enabled, false);
  /* Distinct widget types only (no duplicated widget shown twice). */
  const wtypes = demo.items.filter(i => i.type === 'widget').map(i => i.widgetType);
  assert.equal(new Set(wtypes).size, wtypes.length);
});

/* The grid is six fixed columns. A medium widget spans two, and the Settings
   tile is an extra cell, so a total that is not a multiple of six leaves the
   last row short. */
test('the demo fills whole grid rows', () => {
  const children = new Set(demo.items.flatMap(i => i.children || []));
  const cells = demo.items
    .filter(i => !i.dock && !children.has(i.id))
    .reduce((n, i) => n + (i.widgetSize === 'medium' ? 2 : 1), 1);
  assert.equal(cells % 6, 0, `${cells} cells does not fill the last row`);
});

/* Tile color is chosen per app, the way a built-out dashboard looks: most tiles
   keep the default dark plate and a few carry a brand color. A folder draws its
   own plate, and the Settings tile is not configurable. */
test('every app tile names a color', () => {
  const apps = demo.items.filter(i => i.type === 'app');
  assert.deepEqual(
    apps.filter(i => !i.color).map(i => i.id),
    [],
  );
  assert.deepEqual(
    demo.items.filter(i => i.type === 'folder' && i.color).map(i => i.id),
    [],
  );
  assert.ok(apps.filter(i => i.color === 'dark').length >= apps.length / 2, 'dark is the common case');
  /* An icon drawn in light ink needs a tile dark enough to hold it. */
  for (const i of apps.filter(i => /-light\.svg$/.test(i.iconUrl || ''))) {
    assert.notEqual(i.color, 'light', `${i.id} carries a light icon and cannot sit on a light tile`);
  }
});

test('loadConfig serves the bundled demo config in demo mode', () => {
  const cfg = loadConfig();
  assert.equal(cfg.settings.background.url, '/demo-wallpaper.jpg');
  assert.ok(cfg.items.some(i => i.id === 'w-stats'));
});

test('fetchJSON makes no outbound request in demo mode', async () => {
  const r = await fetchJSON('https://media.example.com/anything');
  assert.equal(r.status, 503);
  assert.equal(r.data, null);
});

test('pingUrl makes no outbound request in demo mode', async () => {
  const r = await pingUrl('https://media.example.com');
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});
