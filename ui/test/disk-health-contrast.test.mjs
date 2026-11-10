import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../widgets/disk-health/index.html', import.meta.url), 'utf8');

const luminance = rgb =>
  rgb
    .map(v => v / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ratio = (alpha, bg) => {
  const fg = bg.map(v => 255 * alpha + v * (1 - alpha));
  return (luminance(fg) + 0.05) / (luminance(bg) + 0.05);
};

const HOVER = '@media (hover:hover) and (pointer:fine)';

/** @param {string} selector @param {string} [media] the at-rule the rule sits in */
const rule = (selector, media) => {
  const from = media ? page.indexOf(`\n  ${media} {`) : 0;
  assert.ok(from >= 0, `${media} moved`);
  const indent = media ? '    ' : '  ';
  const at = page.indexOf(`\n${indent}${selector} {`, from);
  assert.ok(at >= 0, `${selector} moved`);
  return page.slice(at, page.indexOf('}', at));
};
const ink = selector => Number(/color:rgba\(255,255,255,([\d.]+)\)/.exec(rule(selector))?.[1]);
const fill = (selector, media) => hex(/background(?:-color)?:(#[0-9A-Fa-f]{6})/.exec(rule(selector, media))?.[1] ?? '');

/* SC 1.4.3: 11px text needs 4.5:1. */
for (const [text, on, bg, media] of [
  ['bay name', '.bay-name', '.bay'],
  ['bay name on a pressed bay', '.bay-name', '.bay.assigned.touch-active'],
  ['bay name on a hovered bay', '.bay-name', '.bay.assigned:hover', HOVER],
  ['unread bay name', '.bay.unread .bay-name', '.bay.unread'],
  ['bay number', '#nums span', '#panel'],
]) {
  test(`the ${text} clears 4.5:1`, () => {
    const r = ratio(ink(on), fill(bg, media));
    assert.ok(r >= 4.5, `${text} reads at ${r.toFixed(2)}:1`);
  });
}
