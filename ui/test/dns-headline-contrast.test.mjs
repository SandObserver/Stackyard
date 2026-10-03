import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const page = fs.readFileSync(new URL('../widgets/dns/index.html', import.meta.url), 'utf8');

globalThis.location = /** @type {any} */ ({ search: '' });
globalThis.document = /** @type {any} */ ({ documentElement: { getAttribute: () => 'light' } });
const { readableInk } = await import('../js/widget-toolbox.js');

const luminance = hex =>
  [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const onWhite = hex => 1.05 / (luminance(hex) + 0.05);

const segmentColours = [...page.matchAll(/key:'\w+',[^}]*color:'(#[0-9A-Fa-f]{6})'/g)].map(m => m[1]);

/* The headline is large bold text, so 1.4.3 asks for 3:1. */
test('every segment headline clears 3:1 on the light card', () => {
  assert.equal(segmentColours.length, 3, 'the segment colours moved');
  for (const c of segmentColours)
    assert.ok(onWhite(readableInk(c, 3)) >= 3, `${c} reads at ${onWhite(readableInk(c, 3)).toFixed(2)}:1`);
});

test('the headline takes the readable ink, not the raw segment colour', () => {
  const fn = /function showHeadline\(\)[\s\S]*?\n\}/.exec(page)?.[0] ?? '';
  assert.match(fn, /pctEl\.style\.color = readableInk\(s\.color, 3\)/);
});
