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

   They had drifted. A widget's blue was #0A84FF and the dashboard's was
   #0091FF; the same happened to red, orange, yellow, green, teal, pink and
   purple, each stuck at the value it had when that widget was written. Fifty
   greys sat within a few units of a palette grey without being one.

   Bespoke colours are listed below with what they are. The test is a
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
    /* Drawn from the title when a book has no cover. */
    '#4A3018': 'books, cover fallback',
    '#6B4A28': 'books, cover fallback',
    '#956D51': 'books, cover fallback',
    '#A16A00': 'books, cover fallback',
    '#C55300': 'books, cover fallback',
    '#C9A227': 'books, cover fallback',
    '#008198': 'books, cover fallback',
    '#008575': 'books, cover fallback',
    /* A drawn device, not a control. */
    '#D3D7DE': 'dashboard-switch, device ring',
    '#D6D6DB': 'dashboard-switch, device label',
    '#D7DBE1': 'dashboard-switch, device screen glow',
    '#D2D2D2': 'nowplaying, artwork gradient end',
    /* Chosen to read apart from each other at a glance on a clock face, which
       the neighbouring palette hues do not. Deliberate, do not "correct" them
       to cyan, pink and orange. */
    '#18B4F0': 'analog clock, hour hand',
    '#FC1878': 'analog clock, minute hand',
    '#FC9C00': 'analog clock, second hand',
    /* GitHub's own light contribution scale, in the demo fixture. */
    '#EBEDF0': 'GitHub demo contribution scale, step 0',
    '#9BE9A8': 'GitHub demo contribution scale, step 1',
    '#40C463': 'GitHub demo contribution scale, step 2',
    '#30A14E': 'GitHub demo contribution scale, step 3',
    '#216E39': 'GitHub demo contribution scale, step 4',
  }).map(([k, v]) => [k.toUpperCase(), v]),
);

/* Not just the page. A widget's demo fixture, its data module and its manifest
   all carry colours, and those drifted too. */
const SCANNED = /\.(html|js|json)$/;

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (SCANNED.test(e.name)) out.push(p);
  }
  return out;
}

const all = files(widgets).map(p => [path.relative(widgets, p), fs.readFileSync(p, 'utf8')]);

test('the scan sees the widgets', () => {
  assert.ok(all.length >= 14, `only ${all.length} widget pages found, the scan is probably wrong`);
});

test('every widget colour is a palette value or a named bespoke one', () => {
  const offenders = [];
  for (const [name, src] of all) {
    for (const m of src.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
      const hex = m[0].toUpperCase();
      if (PALETTE.has(hex) || BESPOKE.has(hex)) continue;
      offenders.push(`${name}: ${m[0]}`);
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
  const joined = all
    .map(([, src]) => src)
    .join('')
    .toUpperCase();
  const stale = [...BESPOKE.keys()].filter(hex => !joined.includes(hex));
  assert.deepEqual(stale, [], `Listed but unused, remove it:\n  ${stale.join('\n  ')}`);
});
