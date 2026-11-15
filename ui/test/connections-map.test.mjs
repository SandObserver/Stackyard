import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../widgets/connections/world-map.js';
import { mount } from './connections-map-mount.mjs';

const D = M.WORLD;
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
    assert.match(lines[2].attrs['aria-label'], /^\+10 more, Site 3, Site 4, .*Site 12$/);

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

const failed = (name, extra = {}) =>
  svc(name, { kind: undefined, error: 'Auth rejected, check the password.', errorKind: 'auth', ...extra });
const press = (el, detail = 1) => el.dispatch('click', { detail });
const textOf = el => (typeof el === 'object' ? el.textContent + el.children.map(textOf).join('') : String(el));
const rowsIn = pop => pop.querySelectorAll('.pop-row');

test('a failed service shows a hollow dot and its kind of failure under its name', async () => {
  const map = await mount();
  try {
    map.render({ services: [failed('Down', { errorKind: 'timeout' })] });
    const [line] = map.key.children;
    const dot = line.querySelector('.dot');
    assert.equal(dot.style.backgroundColor, 'transparent');
    assert.match(dot.style.boxShadow, /^inset /);
    const sub = line.querySelector('.sub');
    assert.ok(sub.querySelector('svg.why'), 'the kind line has its glyph');
    assert.equal(textOf(sub), 'Took too long');
    assert.equal(map.sr.textContent, 'Down: Took too long. Auth rejected, check the password');
  } finally {
    map.restore();
  }
});

test('a failed service is a button named by its kind and described by the full reason', async () => {
  const map = await mount();
  try {
    map.render({ services: [failed('Umami')] });
    const [line] = map.key.children;
    assert.equal(line.tagName, 'BUTTON');
    assert.equal(line.attrs['aria-label'], 'Umami, Key rejected');
    assert.equal(line.attrs['aria-expanded'], 'false');
    const desc = map.body.querySelectorAll('span').find(s => s.id === line.attrs['aria-describedby']);
    assert.equal(desc.textContent, 'Auth rejected, check the password.');
    assert.equal(desc.lang, 'en');
  } finally {
    map.restore();
  }
});

test('pressing a failed service opens its reason right after it, and pressing again closes it', async () => {
  const map = await mount();
  try {
    map.render({ services: [failed('Umami', { adminUrl: 'https://umami.example.com' }), failed('Zed')] });
    const [umami, plain] = map.key.children;
    press(umami);
    const pop = map.pop();
    assert.equal(pop.open, true);
    assert.equal(map.key.children[1], pop, 'the reason follows its item in reading order');
    assert.equal(umami.attrs['aria-expanded'], 'true');
    const [row] = rowsIn(pop);
    assert.equal(textOf(row.querySelector('.pop-h')), 'Umami');
    assert.equal(row.querySelector('.pop-kind').textContent, 'Key rejected');
    const msg = row.querySelector('.pop-msg');
    assert.equal(msg.textContent, 'Auth rejected, check the password.');
    assert.equal(msg.lang, 'en');
    assert.equal(row.querySelector('button.pop-act').textContent, 'open admin');

    press(umami, 0);
    assert.equal(pop.open, false, 'Enter on the open item closes it');
    assert.equal(umami.attrs['aria-expanded'], 'false');
    assert.equal(pop.parent, map.body, 'a closed popover leaves the legend');

    press(plain);
    assert.equal(rowsIn(pop)[0].querySelector('button.pop-act'), null, 'no admin address, no Open admin');
  } finally {
    map.restore();
  }
});

test('a press on the open item closes it and does not open it again', async () => {
  const map = await mount();
  try {
    map.render({ services: [failed('Umami')] });
    const [umami] = map.key.children;
    press(umami);
    const pop = map.pop();
    umami.dispatch('pointerdown');
    pop.hidePopover();
    press(umami);
    assert.equal(pop.open, false);
    press(umami);
    assert.equal(pop.open, true, 'the next press opens it');
  } finally {
    map.restore();
  }
});

test('Escape from inside the reason puts focus back on its item', async () => {
  const map = await mount();
  try {
    map.render({ services: [failed('Umami', { adminUrl: 'https://umami.example.com' })] });
    const [umami] = map.key.children;
    press(umami, 0);
    const pop = map.pop();
    pop.querySelector('button.pop-act').focus();
    pop.hidePopover();
    assert.equal(map.doc.activeElement, umami);
  } finally {
    map.restore();
  }
});

test('the count line is a button that lists the hidden services and why they failed', async () => {
  const map = await mount();
  try {
    map.render({ services: [svc('A'), svc('B'), failed('C', { errorKind: 'timeout' }), svc('D'), failed('E')] });
    const more = map.key.children[2];
    assert.equal(more.tagName, 'BUTTON');
    assert.ok(more.querySelector('.ring'), 'a hollow ring says a hidden service failed');
    assert.equal(more.attrs['aria-label'], '+3 more, C Took too long, D, E Key rejected');
    press(more);
    const rows = rowsIn(map.pop());
    assert.deepEqual(
      rows.map(r => textOf(r.querySelector('.pop-h'))),
      ['C', 'D', 'E'],
    );
    assert.equal(rows[0].querySelector('.pop-kind').textContent, 'Took too long');
    assert.equal(rows[1].querySelector('.pop-kind'), null, 'a working service shows only its name');
  } finally {
    map.restore();
  }
});

test('a refresh keeps the reason open on the same item with the new reading', async () => {
  const map = await mount();
  try {
    map.render({ services: [svc('A'), failed('Umami', { adminUrl: 'https://umami.example.com' })] });
    press(map.key.children[1], 0);
    map.pop().querySelector('button.pop-act').focus();

    map.render({
      services: [svc('A'), failed('Umami', { adminUrl: 'https://umami.example.com', error: 'Timed out' })],
    });
    const pop = map.pop();
    const umami = map.key.children.find(c => c.dataset.key === 's:Umami');
    assert.equal(pop.open, true);
    assert.equal(umami.attrs['aria-expanded'], 'true');
    assert.equal(map.key.children[map.key.children.indexOf(umami) + 1], pop);
    assert.equal(rowsIn(pop)[0].querySelector('.pop-msg').textContent, 'Timed out');
    assert.equal(map.doc.activeElement, pop.querySelector('button.pop-act'), 'focus stays where it was');

    map.render({ services: [svc('A'), svc('Umami')] });
    assert.equal(pop.open, false, 'a service that works again has nothing to show');
  } finally {
    map.restore();
  }
});

test('a refresh keeps the hidden services list open', async () => {
  const map = await mount();
  const five = err => ({ services: [svc('A'), svc('B'), failed('C', { error: err }), svc('D'), svc('E')] });
  try {
    map.render(five('first'));
    press(map.key.children[2]);
    map.render(five('second'));
    const pop = map.pop();
    assert.equal(pop.open, true);
    assert.equal(map.key.children[3], pop);
    assert.equal(map.key.children[2].attrs['aria-expanded'], 'true');
    assert.equal(rowsIn(pop)[0].querySelector('.pop-msg').textContent, 'second');
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

test('islands by the date line stay in the Pacific', () => {
  for (const cc of ['TO', 'WS', 'AS', 'PF']) {
    const [cell] = M.place(cc, 1, new Set());
    assert.ok(cell[0] >= 90, `${cc} landed at column ${cell[0]}, across the map`);
  }
});

/* Counts distance checks, not time, so a busy machine cannot fail it. 145,746
   today; scanning all land for every placement is 414,537. */
test('placing many countries stays fast', () => {
  let checks = 0;
  const hypot = Math.hypot;
  Math.hypot = (...a) => (checks++, hypot(...a));
  try {
    const codes = Object.keys(D.areas).filter(cc => /^[A-Z]{2}$/.test(cc));
    const taken = new Set();
    for (let s = 0; s < 12; s++) {
      const regions = {};
      codes.slice(0, 220).forEach((cc, i) => {
        regions[cc] = 1 + ((i * 37 + s) % 500);
      });
      for (const a of M.allocate(regions)) M.place(a.cc, a.n, taken);
    }
  } finally {
    Math.hypot = hypot;
  }
  assert.ok(checks < 200_000, `12 services in 220 countries took ${checks} distance checks`);
});

test('a highlighted service leaves the others as plain map dots', async () => {
  const map = await mount();
  try {
    map.render({
      services: [
        svc('Alpha', { color: '#FF0000', regions: { FR: 1 } }),
        svc('Beta', { color: '#0000FF', regions: { BR: 3 } }),
      ],
    });
    const [alpha] = map.key.children;
    for (const fn of alpha.listeners.pointerenter) fn();
    map.runFrames();
    const fills = map.painted();
    const colours = new Set(fills.map(f => f.color));
    assert.ok(colours.has('rgb(255,0,0)'), 'the highlighted service is drawn');
    assert.ok(!colours.has('rgb(0,0,255)'), 'the other service still shows in colour');
    const lit = fills.filter(f => f.color === 'rgb(255,0,0)').length;
    const land = fills.filter(f => f.color !== 'rgb(255,0,0)').length;
    assert.equal(lit + land, M.all.length, 'a cell is left empty');
  } finally {
    map.restore();
  }
});
