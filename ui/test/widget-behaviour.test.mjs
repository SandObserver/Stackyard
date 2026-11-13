import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = f => fs.readFileSync(new URL(`../widgets/${f}`, import.meta.url), 'utf8');

const nowplaying = read('nowplaying/index.html');

function liftApply() {
  const fn = nowplaying.match(/const spokenKey=[\s\S]*?function apply\(d\)\{[\s\S]*?\n {2}\}/);
  assert.ok(fn, 'apply and spokenKey are defined in the widget');
  return new Function('paint', `let provider='',baseLink='',sessions=[],idx=0;${fn[0]};return apply;`);
}

test('Now Playing announces a track change, never a progress tick', () => {
  const calls = [];
  const apply = liftApply()(changed => calls.push(changed));
  const session = (title, progress, state = 'playing') => ({ title, subtitle: '', player: 'TV', state, progress });
  apply({ sessions: [session('Heat', 0.1)] });
  apply({ sessions: [session('Heat', 0.2)] });
  apply({ sessions: [session('Heat', 0.3, 'paused')] });
  apply({ sessions: [session('Ronin', 0.3, 'paused')] });
  assert.deepEqual(calls, [true, false, true, true]);
});

test('Now Playing does not rewrite its live region with the same words', () => {
  assert.match(nowplaying, /if\(announce&&srEl\.textContent!==label\) srEl\.textContent=label;/);
});

function liftAddEvents() {
  const src = read('disk-health/index.html');
  const fn = src.match(/function addEvents\(bay, i\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'addEvents is defined in the widget');
  const seen = { shown: 0, hidden: 0, opened: 0 };
  const listeners = new Map();
  const classes = new Set();
  const bay = {
    addEventListener: (t, f) => listeners.set(t, f),
    classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
  };
  const bayData = [{}];
  let touch = null;
  new Function('bay', 'bayData', 'showTip', 'hideTip', 'openBay', 'twoTap', `${fn[0]};addEvents(bay,0);`)(
    bay,
    bayData,
    () => seen.shown++,
    () => seen.hidden++,
    () => seen.opened++,
    (el, opts) => {
      assert.equal(el, bay);
      touch = opts;
    },
  );
  const fire = (type, pointerType) => listeners.get(type)({ pointerType });
  return { seen, fire, touch, classes, bayData, listeners };
}

test('Disk Health hands a finger to the shared two-tap reveal', () => {
  const { seen, touch, classes, bayData, listeners } = liftAddEvents();
  assert.ok(touch, 'addEvents does not use twoTap');
  assert.deepEqual(
    ['touchstart', 'touchmove', 'touchend'].filter(t => listeners.has(t)),
    [],
  );
  touch.reveal();
  assert.ok(classes.has('touch-active'));
  assert.equal(seen.shown, 1);
  touch.conceal();
  assert.ok(!classes.has('touch-active'));
  assert.equal(seen.hidden, 1);
  touch.open();
  assert.equal(seen.opened, 1);
  assert.equal(touch.canReveal(), true);
  bayData[0] = null;
  assert.equal(touch.canReveal(), false, 'an empty bay reveals on a tap');
  assert.equal(touch.timeout, undefined, 'a revealed bay closes on its own');
});

test('Disk Health keeps no touch tracking or reset hook of its own', () => {
  const src = read('disk-health/index.html');
  assert.doesNotMatch(src, /addEventListener\('touch(start|move|end)'/);
  assert.doesNotMatch(src, /__clearActive|postMessage/);
});

test('Disk Health reads the input in use, not whether the device has touch', () => {
  const { seen, fire } = liftAddEvents();
  fire('pointerenter', 'mouse');
  fire('pointerleave', 'mouse');
  fire('pointerdown', 'mouse');
  fire('click');
  assert.deepEqual(seen, { shown: 1, hidden: 1, opened: 1 });
});

test('a finger does not open the tooltip through hover or open a bay through click', () => {
  const { seen, fire } = liftAddEvents();
  fire('pointerenter', 'touch');
  fire('pointerdown', 'touch');
  fire('click');
  assert.deepEqual(seen, { shown: 0, hidden: 0, opened: 0 });
});

function liftShowReading() {
  const src = read('system-summary/index.html');
  const limit = src.match(/const ROLL_MIN_CHANGE = \d+;/);
  const fn = src.match(/function showReading\(r, value\) \{[\s\S]*?\n\}/);
  assert.ok(limit && fn, 'showReading is defined in the widget');
  const writes = [];
  const showReading = new Function('rollText', `${limit[0]};${fn[0]};return showReading;`)((_el, _text, opts) =>
    writes.push(opts.instant),
  );
  return { showReading, writes };
}

test('System Summary rolls a figure only at a change of 5 points or more', () => {
  const { showReading, writes } = liftShowReading();
  const row = { val: {}, latest: '' };
  for (const v of [41, 42, 46, 51, 51, null, 80]) showReading(row, v);
  assert.deepEqual(writes, [true, true, true, false, true, true, true]);
});

test('Downloads fits its headline and shows short units on a box label', () => {
  const src = read('downloads/index.html');
  assert.match(src, /const summary = header\(data, now\);\n {2}fitText\(bigEl, 15\);/);
  assert.match(src, /duration\(it\.eta, 'narrow'\)/);
  assert.match(src, /bigEl\.replaceChildren\(placeholder\(78, 20, 6\)\)/);
});

test('Dashboard Switch draws its failure and empty states in the shared caption', () => {
  const src = read('dashboard-switch/index.html');
  assert.match(src, /catch \(e\) \{\n\s+state\.fail\(e\);/);
  assert.match(src, /state\.empty\(wt\('ui\.empty'/);
  assert.doesNotMatch(src, /\.kc:focus-visible \.key/);
});

test('the VPN name truncates on one line and the place clamps on a small card', () => {
  const src = read('connections/connections-vpn.html');
  const rule = selector => src.match(new RegExp(`(?:^|\\n)\\s*${selector}\\{([^}]*)\\}`))?.[1] ?? '';
  const tag = rule('\\.vpn-tag');
  for (const decl of ['min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) {
    assert.ok(tag.includes(decl), `.vpn-tag has ${decl}`);
  }
  assert.ok(rule('\\.state').includes('flex:none'), 'the state keeps its width');
  assert.ok(rule('body\\.size-small \\.info').includes('align-self:stretch'), 'text is bounded by the card');
  assert.ok(rule('body\\.size-small \\.vpn-tag').includes('align-self:stretch'), 'the name is bounded by the card');
  const place = rule('body\\.size-small \\.place');
  assert.doesNotMatch(place, /display|line-clamp|overflow/, 'a small card keeps the two-line clamp');
  assert.ok(rule('\\.place').includes('overflow-wrap:anywhere'), 'a long host name breaks inside the clamp');
});

test('every widget page with secondary text answers increased contrast', () => {
  for (const f of [
    'books/index.html',
    'dns/index.html',
    'system-summary/index.html',
    'github/pullrequests.html',
    'github/contributions.html',
    'connections/connections-vpn.html',
    'downloads/index.html',
    'disk-health/index.html',
    'upnext/index.html',
  ]) {
    assert.match(read(f), /@media \(prefers-contrast: ?more\)/, f);
  }
});

test('frosted widget surfaces drop their blur for reduced transparency', () => {
  for (const [f, sel] of [
    ['disk-health/index.html', '#tip'],
    ['weather/index.html', '.aq-cap'],
    ['connections/connections-map.html', '#tt'],
  ]) {
    const src = read(f);
    const rule = src.match(/html\[data-transparency="reduce"\] ([^{]+)\{([^}]*)\}/);
    assert.ok(rule, `${f} answers reduced transparency`);
    assert.equal(rule[1].trim(), sel, `${f} removes the blur on ${sel}`);
    assert.match(rule[2], /backdrop-filter:none/, f);
  }
});

test('the Connections VPN state words clear 4.5:1 on the solid card', () => {
  const src = read('connections/connections-vpn.html');
  const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = c => 0.2126 * lin(c[0] / 255) + 0.7152 * lin(c[1] / 255) + 0.0722 * lin(c[2] / 255);
  const rgba = v => {
    const hex = /^#([0-9a-f]{6})$/i.exec(v);
    if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(v.replace(/\s/g, ''));
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  };
  const vars = rule => Object.fromEntries([...rule.matchAll(/(--[\w-]+):\s*([^;}]+)/g)].map(m => [m[1], m[2].trim()]));
  const dark = vars(/:root\{([^}]*)\}/.exec(src)[1]);
  const light = { ...dark, ...vars(/html\[data-theme="light"\] \{([^}]*)\}/.exec(src)[1]) };
  assert.match(src, /\.state\.off\{color:var\(--fg2\)\}/, 'Off reads in the secondary grey');
  assert.match(src, /\.state\.err\{color:var\(--red\)\}/);
  for (const [theme, set, card] of [
    ['dark', dark, [28, 28, 30]],
    ['light', light, [255, 255, 255]],
  ]) {
    for (const name of ['--fg2', '--red']) {
      const c = rgba(set[name]);
      const ink = c.slice(0, 3).map((v, i) => v * c[3] + card[i] * (1 - c[3]));
      const r = (Math.max(lum(ink), lum(card)) + 0.05) / (Math.min(lum(ink), lum(card)) + 0.05);
      assert.ok(r >= 4.5, `${name} in ${theme}: ${r.toFixed(2)}`);
    }
  }
});

test('Books repaints on resize and only the pointer writes the live region', () => {
  const src = read('books/index.html');
  assert.match(src, /addEventListener\('resize',\(\)=>\{ if\(shownData\) paintShelves\(shownData\); \}\)/);
  assert.match(src, /if\(e\.type==='mouseenter'\) sr\.textContent=describe\(b\);/);
});

test('Up Next shortens today only on a small card and caps its gutter', () => {
  const src = read('upnext/index.html');
  assert.match(src, /size === 'small' \? wt\('ui\.todayShort', 'Today'\) : wt\('ui\.today', 'Today'\)/);
  assert.match(src, /Math\.min\(widest, size === 'small' \? 56 : 76\)/);
  const fr = JSON.parse(read('upnext/i18n/fr.json'));
  assert.equal(fr['ui.todayShort'], 'Auj.');
});

test('hidden tabs skip the minute timers', () => {
  assert.match(
    read('weather/index.html'),
    /setInterval\(\(\) => \{ if \(document\.hidden\) return; describe\(\); \}, 60000\)/,
  );
  assert.match(read('upnext/index.html'), /setInterval\(\(\) => \{\n\s+if \(document\.hidden\) return;/);
});
