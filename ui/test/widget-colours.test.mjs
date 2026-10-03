import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Widget colours against the palette.

   A widget is a separate document and keeps its own stylesheet, so it cannot
   name a token: most of its colours sit in canvas fills and SVG attributes
   where a var() is not a colour. It carries the values instead, and this is
   what stops them drifting back.

   Without this each widget's colours stay at the value they had when it was
   written. Bespoke colours are listed below with what they are. The test is a
   ratchet: a new colour has to be a palette value or be named here. */

const widgets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets');

const PALETTE = new Set(
  [
    '#FF4245',
    '#FF9230',
    '#FFD600',
    '#30D158',
    '#00DAC3',
    '#00D2E0',
    '#3CD3FE',
    '#0091FF',
    '#6D7CFF',
    '#DB34F2',
    '#FF375F',
    '#B78A66',
    '#8E8E93',
    '#636366',
    '#48484A',
    '#3A3A3C',
    '#2C2C2E',
    '#1C1C1E',
    /* Label primary, and ink on a coloured fill. */
    '#FFFFFF',
    '#FFF',
    '#000000',
    '#000',
  ].map(h => h.toUpperCase()),
);

/* Colours that are not the project's to choose. */
const BESPOKE = new Map(
  Object.entries({
    '#0E4429': 'GitHub contribution scale, step 1',
    '#006D32': 'GitHub contribution scale, step 2',
    '#26A641': 'GitHub contribution scale, step 3',
    '#39D353': 'GitHub contribution scale, step 4',
    '#3FB950': 'GitHub, open pull request',
    '#E5A00D': 'Plex brand',
    '#6C6C70': 'Books secondary text on white, 5.1:1',
    '#E5E5EA': 'Analog clock dial in the dark theme',
    '#007CA6': 'Jellyfin brand',
    '#4CAF50': 'Emby brand',
    /* An embedded illustration set, one path list per condition. Artwork, not
       interface colour. */
    '#DAD6CB': 'weather illustration',
    '#E9E5D9': 'weather illustration',
    '#3E4962': 'weather illustration',
    '#5C6C91': 'weather illustration',
    '#7388B6': 'weather illustration',
    '#A2BFFF': 'weather illustration',
    '#1F9FB0': 'weather illustration',
    '#BEBEBE': 'weather illustration',
    '#A2A2A2': 'weather, cloud by day',
    '#BCBCBC': 'weather, cloud by night',
    '#F0852A': 'weather, temperature reading',
    /* Drawn from the title when a book has no colour of its own. */
    '#E7E0D2': 'books, spine',
    '#3D5A80': 'books, spine',
    '#A8483E': 'books, spine',
    '#C9BBA0': 'books, spine',
    '#5C6B57': 'books, spine',
    '#8D99A6': 'books, spine',
    '#2E3340': 'books, spine',
    '#B58B52': 'books, spine',
    '#7B5E57': 'books, spine',
    '#4E6E6A': 'books, spine',
    '#D6453D': 'books, bookmark ribbon',
    /* A drawn device, not a control. */
    '#D3D7DE': 'dashboard-switch, device ring',
    '#D6D6DB': 'dashboard-switch, device label',
    '#D7DBE1': 'dashboard-switch, device screen glow',
    '#D2D2D2': 'nowplaying, artwork gradient end',
    /* Chosen to read apart from each other at a glance on a clock face, which
       the neighbouring palette hues do not. Deliberate, do not "correct" them
       to cyan, pink and orange. */
    '#3FBCF2': 'analog clock, hour disc',
    '#FE3A86': 'analog clock, minute disc',
    '#FDA632': 'analog clock, second disc',
    '#633680': 'analog clock, minute and hour discs overlapping',
    '#F00F14': 'analog clock, minute and second discs overlapping',
    '#577C40': 'analog clock, hour and second discs overlapping',
    '#5F2123': 'analog clock, all three discs overlapping',
    /* GitHub's own light contribution scale, in the demo fixture. */
    '#EBEDF0': 'GitHub demo contribution scale, step 0',
    '#9BE9A8': 'GitHub demo contribution scale, step 1',
    '#40C463': 'GitHub demo contribution scale, step 2',
    '#30A14E': 'GitHub demo contribution scale, step 3',
    '#216E39': 'GitHub demo contribution scale, step 4',
    '#3C3C43': 'connections map, secondary label in the light theme',
    '#EBEBF5': 'secondary label in the dark theme',
    '#E4E4EC': 'connections map, land dots in the dark theme',
    '#1C1C20': 'connections map, hover card in the dark theme',
    '#1E1E22': 'connections map, detail card',
    '#141416': 'disk health, detail panel',
    '#64646E': 'backup, idle status flag',
    '#787880': 'books, progress track',
    '#808080': 'nowplaying, arrow hover fill',
    '#96969E': 'connections VPN, idle dots',
    '#FAF6EE': 'books, title ink on a dark spine',
    '#E8E8EA': 'widget template, text in the dark theme',
  }).map(([k, v]) => [k.toUpperCase(), v]),
);

/* Not just the page. A widget's demo fixture, its data module and its manifest
   all carry colours. */
const SCANNED = /\.(html|js|json)$/;

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (SCANNED.test(e.name)) out.push(p);
  }
  return out;
}

/* The template is what a new widget is copied from. */
const template = path.resolve(widgets, '..', '..', 'docs', 'widget-template');

const all = [...files(widgets), ...files(template)].map(p => [path.relative(widgets, p), fs.readFileSync(p, 'utf8')]);

const hex2 = n =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

function hslToHex(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = n => 255 * (l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
}

/* Every literal colour as #RRGGBB, or #RGB as written. Alpha is not a colour
   choice, so #RRGGBBAA and rgba() are read without it. A component built at
   run time, such as rgba(color, 0.5), is not a literal. Named colours are not
   read: the words collide with prose and identifiers. */
const NUM = '(-?[\\d.]+)(%|deg|turn|rad)?';
const COLOUR = new RegExp(
  `#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\\b|\\b(rgba?|hsla?)\\(\\s*${NUM}[\\s,]+${NUM}[\\s,]+${NUM}`,
  'gi',
);

const channel = (n, unit) => (unit === '%' ? n * 2.55 : n);
const degrees = (n, unit) => (unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : n);

function colours(src) {
  const out = [];
  for (const m of src.matchAll(COLOUR)) {
    if (m[1]) {
      const h = m[1].length === 8 ? m[1].slice(0, 6) : m[1].length === 4 ? m[1].slice(0, 3) : m[1];
      out.push({ written: m[0], hex: `#${h}`.toUpperCase() });
      continue;
    }
    const [a, b, c] = [3, 5, 7].map(i => Number(m[i]));
    const hex = m[2].toLowerCase().startsWith('hsl')
      ? hslToHex(((degrees(a, m[4]) % 360) + 360) % 360, b, c)
      : `#${hex2(channel(a, m[4]))}${hex2(channel(b, m[6]))}${hex2(channel(c, m[8]))}`;
    out.push({ written: m[0], hex: hex.toUpperCase() });
  }
  return out;
}

test('the scan reads every way of writing a colour', () => {
  assert.deepEqual(
    colours('a:#12345678; b:rgb(12, 34, 56); c:rgba(255,255,255,.5); d:hsl(0 100% 50%); e:rgba(color,0.5)').map(
      c => c.hex,
    ),
    ['#123456', '#0C2238', '#FFFFFF', '#FF0000'],
  );
  assert.deepEqual(
    colours('a:rgb(100%,0%,0%); b:RGB(1,2,3); c:hsl(-120 100% 50%); d:hsl(0.5turn 100% 50%); e:#ABC').map(c => c.hex),
    ['#FF0000', '#010203', '#0000FF', '#00FFFF', '#ABC'],
  );
});

test('the scan sees the widgets', () => {
  assert.ok(all.length >= 14, `only ${all.length} widget pages found, the scan is probably wrong`);
});

test('every widget colour is a palette value or a named bespoke one', () => {
  const offenders = [];
  for (const [name, src] of all) {
    for (const { written, hex } of colours(src)) {
      if (PALETTE.has(hex) || BESPOKE.has(hex)) continue;
      offenders.push(`${name}: ${written}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Not a palette value. Use one, or add it to BESPOKE with what it is:\n  ${offenders.join('\n  ')}`,
  );
});

/* A bespoke entry that no widget uses any more is a stale exemption, and the
   next colour that happens to match it slips through unexamined. */
test('every bespoke colour is still used', () => {
  const used = new Set(all.flatMap(([, src]) => colours(src).map(c => c.hex)));
  const stale = [...BESPOKE.keys()].filter(hex => !used.has(hex));
  assert.deepEqual(stale, [], `Listed but unused, remove it:\n  ${stale.join('\n  ')}`);
});
