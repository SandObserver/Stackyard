import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount, placement } from './connections-map-mount.mjs';

const { D, M } = placement();
const toGrid = (lon, lat) => [
  ((lon + 180) / 360) * D.cols - 0.5,
  ((D.maxLat - lat) / (D.maxLat - D.minLat)) * D.rows - 0.5,
];
const near = (cell, g, max) => Math.hypot(cell[0] - g[0], cell[1] - g[1]) <= max;

function random(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

const ONCE_DROPPED =
  'CH AT BE HU EE LT MD SK SI IL QA KW BH JO LB HK TW BD LK SG AM MU DJ PA DO GT HN SV CR JM CU LU CY';

test('every country that used to be dropped has a place on the map', () => {
  const missing = ONCE_DROPPED.split(' ').filter(cc => M.capacity(cc) === 0);
  assert.deepEqual(missing, []);
});

test('a country with no cells of its own borrows one cell near it', () => {
  for (const [cc, lon, lat] of [
    ['MT', 14.51, 35.9],
    ['XK', 21.17, 42.67],
    ['FJ', 178.44, -18.13],
  ]) {
    assert.equal(M.capacity(cc), 1, cc);
    const [a] = M.allocate({ [cc]: 50 });
    assert.equal(a.n, 1);
    assert.equal(a.over, true, `${cc} should draw its single dot larger`);
    const cells = M.place(cc, a.n, new Set());
    assert.equal(cells.length, 1);
    assert.ok(near(cells[0], toGrid(lon, lat), 4), `${cc} landed at ${cells[0]}`);
  }
});

test('codes the map cannot place are ignored, not drawn somewhere', () => {
  const got = M.allocate({ ZZ: 5, us: 3, __proto__: 4, EU: 9, DE: -1, FR: Number.NaN, IT: 'x', ES: 2 });
  assert.deepEqual(
    got.map(a => a.cc),
    ['ES'],
  );
});

test('dot counts follow the rules for any audience size', () => {
  const codes = [...new Set(D.countries)].filter(cc => /^[A-Z]{2}$/.test(cc));
  const rnd = random(7);
  for (let run = 0; run < 400; run++) {
    const k = 1 + Math.floor(rnd() * 60);
    const scale = [1, 10, 1e3, 1e7][run % 4];
    const regions = {};
    while (Object.keys(regions).length < k)
      regions[codes[Math.floor(rnd() * codes.length)]] = Math.max(1, Math.round(rnd() * scale));
    const got = M.allocate(regions);
    const total = got.reduce((s, a) => s + a.n, 0);
    const budget = Math.max(k, Math.max(40, Math.ceil(1.5 * k)));
    assert.equal(got.length, k, 'every country gets a dot');
    for (const a of got) {
      assert.ok(a.n >= 1, `${a.cc} has no dot`);
      assert.ok(a.n <= Math.max(1, Math.floor(a.users)), `${a.cc} has more dots than users`);
      assert.ok(a.n <= M.capacity(a.cc), `${a.cc} has more dots than cells`);
    }
    assert.ok(total <= budget, `total ${total} over the budget ${budget}`);
  }
});

test('more users never means fewer dots', () => {
  const rnd = random(11);
  const codes = ['US', 'DE', 'IN', 'BR', 'RU', 'IR', 'UG', 'BE', 'SG', 'IL', 'JP', 'AU', 'CN', 'FR', 'GB'];
  for (let run = 0; run < 300; run++) {
    const regions = {};
    for (const cc of codes) if (rnd() < 0.6) regions[cc] = 1 + Math.floor(rnd() ** 3 * 5000);
    const ccs = Object.keys(regions);
    if (!ccs.length) continue;
    const pick = ccs[Math.floor(rnd() * ccs.length)];
    const before = M.allocate(regions).find(a => a.cc === pick);
    const after = M.allocate({ ...regions, [pick]: regions[pick] * 3 }).find(a => a.cc === pick);
    assert.ok(after.n >= before.n, `${pick}: ${before.n} -> ${after.n}`);
  }
});

test('a country too small for its share is marked to draw larger dots', () => {
  const got = Object.fromEntries(M.allocate({ IL: 400, US: 400 }).map(a => [a.cc, a]));
  assert.equal(got.IL.over, true);
  assert.equal(got.IL.n, M.capacity('IL'));
  assert.equal(got.US.over, false);
});

test('one dot lands on the largest populated area', () => {
  assert.ok(near(M.place('RU', 1, new Set())[0], toGrid(37.62, 55.75), 1.5), 'Russia: Moscow');
  assert.ok(near(M.place('GL', 1, new Set())[0], toGrid(-51.74, 64.18), 1.5), 'Greenland: Nuuk, not the ice');
  assert.ok(near(M.place('US', 1, new Set())[0], toGrid(-74.0, 40.7), 1.5), 'United States: New York');
});

test('dots stay inside the country, never repeat, and are the same every refresh', () => {
  for (const [cc, n] of [
    ['US', 25],
    ['RU', 12],
    ['BR', 7],
    ['IN', 9],
    ['GL', 2],
  ]) {
    const a = M.place(cc, n, new Set());
    const b = M.place(cc, n, new Set());
    const own = new Set(M.cellsOf(cc).map(M.key));
    assert.equal(a.length, n, cc);
    assert.deepEqual(a, b, `${cc} moved between refreshes`);
    assert.equal(new Set(a.map(M.key)).size, n, `${cc} reuses a cell`);
    assert.ok(
      a.every(c => own.has(M.key(c))),
      `${cc} has a dot outside its cells`,
    );
  }
});

test('a second service in the same country takes the next free cells', () => {
  for (const [cc, n] of [
    ['DE', 2],
    ['FR', 3],
    ['IL', 1],
  ]) {
    const taken = new Set();
    const first = M.place(cc, n, taken).map(M.key);
    const second = M.place(cc, n, taken);
    assert.equal(second.length, n, `${cc}: the second service lost dots`);
    assert.deepEqual(
      second.map(M.key).filter(k => first.includes(k)),
      [],
      `${cc}: the second service covers the first`,
    );
    assert.ok(
      second.every(c => first.some(k => near(c, k.split(',').map(Number), 3))),
      `${cc}: the second service landed far away`,
    );
  }
});

const svc = (name, extra = {}) => ({ id: name, name, color: '#BF5AF2', kind: 'regions', regions: { FR: 1 }, ...extra });
const texts = el =>
  el.children
    .filter(c => typeof c === 'object' && c.tagName === 'BDI')
    .map(c => c.textContent)
    .join('');

test('the key shows at most three lines', async () => {
  const map = await mount();
  try {
    map.render({ services: Array.from({ length: 12 }, (_, i) => svc('Site ' + (i + 1))) });
    const lines = map.key.children;
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.slice(0, 2).map(texts), ['Site 1', 'Site 2']);
    assert.equal(texts(lines[2]), '+10 more');
    assert.match(lines[2].title, /^Site 3, Site 4, .*Site 12$/);

    map.render({ services: [svc('B'), svc('A'), svc('C')] });
    assert.deepEqual(map.key.children.map(texts), ['A', 'B', 'C'], 'three fit, so no count line');
  } finally {
    map.restore();
  }
});

test('the key is a button only where it opens something', async () => {
  const map = await mount();
  try {
    map.render({ services: [svc('Admin', { adminUrl: 'https://example.com' }), svc('Plain')] });
    const [admin, plain] = map.key.children;
    assert.equal(admin.tagName, 'BUTTON');
    assert.equal(admin.attrs['aria-label'], 'Admin, open admin');
    assert.equal(plain.tagName, 'SPAN');
  } finally {
    map.restore();
  }
});

test('an unavailable service shows a hollow dot and says so', async () => {
  const map = await mount();
  try {
    map.render({ services: [svc('Down', { error: 'timeout', kind: undefined })] });
    const [line] = map.key.children;
    const [dot, , state] = line.children;
    assert.equal(dot.style.backgroundColor, 'transparent');
    assert.match(dot.style.boxShadow, /^inset /);
    assert.equal(state.textContent, ', Unavailable');
    assert.match(map.sr.textContent, /^Down: Unavailable$/);
  } finally {
    map.restore();
  }
});

test('screen readers get what the map shows', async () => {
  const map = await mount();
  try {
    map.render({
      services: [
        svc('Conduit', { regions: { MM: 5, FR: 1 } }),
        { id: 'g', name: 'Gluetun', kind: 'point', lat: 43.7, lng: -79.4, city: 'Toronto', country: 'Canada' },
      ],
    });
    assert.match(map.sr.textContent, /^Conduit: Myanmar[^,]* 5, France 1\. Gluetun: Toronto, Canada$/);
  } finally {
    map.restore();
  }
});

test('the key can be turned off', async () => {
  const map = await mount();
  try {
    map.render({ services: [svc('A')], meta: { showLegend: false } });
    assert.equal(map.key.hidden, true);
    assert.equal(map.key.children.length, 0);
  } finally {
    map.restore();
  }
});
