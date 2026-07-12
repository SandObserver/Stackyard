import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, KEY_STYLES, EXTRA_STYLES,
  hashString, normalizeUrl, sameDashboard,
  deriveComposition, deriveColor, buildModel,
} from '../js/dashboard-switch-model.js';

/* ── normalizeUrl ── */

test('normalizeUrl adds a default http scheme when missing', () => {
  assert.equal(normalizeUrl('dash.lan'), 'http://dash.lan');
  assert.equal(normalizeUrl('dash.lan:8080'), 'http://dash.lan:8080');
});

test('normalizeUrl lowercases scheme and host but not the path', () => {
  assert.equal(normalizeUrl('HTTP://Dash.LAN/App'), 'http://dash.lan/App');
});

test('normalizeUrl collapses cosmetic differences (trailing slash, default port, case)', () => {
  const a = normalizeUrl('HTTP://Dash.lan/');
  const b = normalizeUrl('http://dash.lan');
  const c = normalizeUrl('http://dash.lan:80');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a, 'http://dash.lan');
});

test('normalizeUrl drops the https default port but keeps others', () => {
  assert.equal(normalizeUrl('https://dash.lan:443'), 'https://dash.lan');
  assert.equal(normalizeUrl('https://dash.lan:8443'), 'https://dash.lan:8443');
});

test('normalizeUrl treats a one-character or port difference as distinct targets', () => {
  assert.notEqual(normalizeUrl('http://dash.lan:8080'), normalizeUrl('http://dash.lan:8443'));
  assert.notEqual(normalizeUrl('http://dash1.lan'), normalizeUrl('http://dash2.lan'));
  assert.notEqual(normalizeUrl('http://dash.lan/a'), normalizeUrl('http://dash.lan/b'));
});

test('normalizeUrl strips only a single trailing slash and preserves subpaths', () => {
  assert.equal(normalizeUrl('http://dash.lan/app/'), 'http://dash.lan/app');
  assert.equal(normalizeUrl('http://dash.lan/app'), 'http://dash.lan/app');
});

test('normalizeUrl rejects non-http(s) schemes and junk', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('ftp://dash.lan'), null);
  assert.equal(normalizeUrl('   '), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(42), null);
});

/* ── sameDashboard ── */

test('sameDashboard matches on origin, ignoring path when the slot has no subpath', () => {
  assert.equal(sameDashboard('http://dash.lan', 'http://dash.lan/#home'), true);
  assert.equal(sameDashboard('http://dash.lan', 'http://dash.lan/admin'), true);
});

test('sameDashboard distinguishes different origins', () => {
  assert.equal(sameDashboard('http://dash.lan', 'http://dash.lan:8080'), false);
  assert.equal(sameDashboard('http://a.lan', 'http://b.lan'), false);
});

test('sameDashboard requires a subpath prefix when the slot carries one', () => {
  assert.equal(sameDashboard('http://host/app', 'http://host/app/page'), true);
  assert.equal(sameDashboard('http://host/app', 'http://host/app'), true);
  assert.equal(sameDashboard('http://host/app', 'http://host/other'), false);
});

/* ── deriveComposition rules ── */

test('deriveComposition is deterministic for a given canonical URL', () => {
  const a = deriveComposition('http://dash.lan');
  const b = deriveComposition('http://dash.lan');
  assert.deepEqual(a, b);
});

test('deriveComposition honours all element rules across a large sample', () => {
  const keyById = new Map(KEY_STYLES.map(k => [k.id, k]));
  const extraSet = new Set(EXTRA_STYLES);
  const seenCompositions = new Set();
  for (let i = 0; i < 1000; i++) {
    const { keys, extras } = deriveComposition(`http://host-${i}.lan:${1000 + i}`);
    assert.ok(keys.length >= 1 && keys.length <= 3, `keys length ${keys.length}`);
    assert.equal(new Set(keys).size, keys.length, 'keys must be distinct');
    keys.forEach(k => assert.ok(keyById.has(k), `unknown key ${k}`));
    /* At most 3 keys and 4 metals, so metals must all be distinct. */
    const metals = keys.map(id => keyById.get(id).metal);
    assert.equal(new Set(metals).size, metals.length, `repeated metal in ${metals}`);
    assert.ok(extras.length <= 1, `extras length ${extras.length}`);
    extras.forEach(e => assert.ok(extraSet.has(e), `unknown extra ${e}`));
    keys.forEach(k => assert.ok(!extraSet.has(k)));
    seenCompositions.add(JSON.stringify({ keys, extras }));
  }
  /* The composition genuinely varies (not a constant): many distinct racks. */
  assert.ok(seenCompositions.size > 20, `only ${seenCompositions.size} distinct racks`);
});

test('deriveComposition depends on the canonical URL, so equivalent inputs match', () => {
  const viaModel = normalizeUrl('HTTP://Dash.lan/');
  assert.deepEqual(deriveComposition(viaModel), deriveComposition('http://dash.lan'));
});

/* ── deriveColor ── */

test('deriveColor is stable and returns a palette id', () => {
  const ids = new Set(PALETTE.map(p => p.id));
  const c1 = deriveColor('http://dash.lan');
  assert.equal(c1, deriveColor('http://dash.lan'));
  assert.ok(ids.has(c1));
});

test('deriveColor spreads across the palette over a sample', () => {
  const used = new Set();
  for (let i = 0; i < 200; i++) used.add(deriveColor(`http://host-${i}.lan`));
  assert.ok(used.size > 1, 'colour should vary across dashboards');
});

/* ── buildModel ── */

test('buildModel caps slots at 2 for small and 5 for medium', () => {
  const keychains = Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, url: `http://host-${i}.lan` }));
  assert.equal(buildModel({ keychains }, { size: 'small' }).slots.length, 2);
  assert.equal(buildModel({ keychains }, { size: 'medium' }).slots.length, 5);
  /* unknown size falls back to medium */
  assert.equal(buildModel({ keychains }, {}).capacity, 5);
});

test('buildModel drops rows without a usable URL', () => {
  const m = buildModel({ keychains: [
    { name: 'ok', url: 'http://a.lan' },
    { name: 'blank', url: '' },
    { name: 'bad', url: 'javascript:alert(1)' },
    { name: 'missing' },
  ] }, { size: 'medium' });
  assert.equal(m.slots.length, 1);
  assert.equal(m.slots[0].name, 'ok');
});

test('buildModel de-duplicates keychains that canonicalize to the same URL', () => {
  const m = buildModel({ keychains: [
    { name: 'first', url: 'http://dash.lan' },
    { name: 'dup', url: 'HTTP://dash.lan:80/' },
  ] }, { size: 'medium' });
  assert.equal(m.slots.length, 1);
  assert.equal(m.slots[0].name, 'first');
});

test('buildModel falls back to the host when a name is blank', () => {
  const m = buildModel({ keychains: [{ url: 'http://dash.lan:8080' }] }, { size: 'small' });
  assert.equal(m.slots[0].name, 'dash.lan:8080');
});

test('buildModel honours a picked colour and derives one when unset or invalid', () => {
  const picked = buildModel({ keychains: [{ url: 'http://a.lan', color: 'pink' }] }, {}).slots[0];
  assert.equal(picked.color, 'pink');
  assert.equal(picked.colorHex, '#f5325b');

  const derived = buildModel({ keychains: [{ url: 'http://a.lan', color: 'not-a-color' }] }, {}).slots[0];
  assert.equal(derived.color, deriveColor('http://a.lan'));
  assert.ok(PALETTE.some(p => p.id === derived.color));
});

test('buildModel flags the current dashboard by origin', () => {
  const m = buildModel({ keychains: [
    { name: 'A', url: 'http://a.lan' },
    { name: 'B', url: 'http://b.lan' },
  ] }, { size: 'medium', currentHref: 'http://b.lan/admin/index.html' });
  assert.equal(m.slots.find(s => s.name === 'A').isCurrent, false);
  assert.equal(m.slots.find(s => s.name === 'B').isCurrent, true);
});

test('buildModel marks nothing current when the host origin is unreadable', () => {
  const m = buildModel({ keychains: [{ url: 'http://a.lan' }] }, { size: 'small', currentHref: '' });
  assert.equal(m.slots[0].isCurrent, false);
});

test('buildModel defaults openIn to same and accepts new', () => {
  assert.equal(buildModel({ keychains: [] }, {}).openIn, 'same');
  assert.equal(buildModel({ keychains: [], openIn: 'new' }, {}).openIn, 'new');
  assert.equal(buildModel({ keychains: [], openIn: 'bogus' }, {}).openIn, 'same');
});

test('buildModel tolerates missing or malformed config', () => {
  assert.deepEqual(buildModel().slots, []);
  assert.deepEqual(buildModel({}).slots, []);
  assert.deepEqual(buildModel({ keychains: 'nope' }).slots, []);
  assert.equal(buildModel({ keychains: [null, 3, 'x'] }).slots.length, 0);
});

/* ── hashString sanity ── */

test('hashString is a stable uint32', () => {
  const h = hashString('http://dash.lan');
  assert.equal(h, hashString('http://dash.lan'));
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});
