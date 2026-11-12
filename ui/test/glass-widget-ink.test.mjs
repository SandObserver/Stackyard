/* A translucent card shows the wallpaper through an 85% fill. Over a white
   wallpaper the dark card lightens, over a black one the light card darkens, so
   an ink that clears 4.5:1 on the solid card can fail on glass. Each widget
   view on a translucent card steps those inks up under html[data-glass]. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const widgets = path.join(root, 'widgets');

/** Every view whose card is translucent, by its manifest. */
function glassViews() {
  const out = [];
  for (const name of fs.readdirSync(widgets)) {
    const file = path.join(widgets, name, 'widget.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const views = m.views ? Object.values(m.views) : [];
    if (views.length) {
      for (const v of views) if ((v.card || m.card) === 'translucent') out.push(path.join(name, v.src));
    } else if (m.card === 'translucent') out.push(path.join(name, 'index.html'));
  }
  return [...new Set(out)];
}

const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = c => 0.2126 * lin(c[0] / 255) + 0.7152 * lin(c[1] / 255) + 0.0722 * lin(c[2] / 255);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const worst = light => (light ? [255, 255, 255] : [28, 28, 30]).map(c => c * 0.85 + (light ? 0 : 255) * 0.15);

/** [r, g, b, a] or null for a value this check does not read. */
function colour(value) {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}

/** Contrast of an ink on the worst case of the glass card of one theme. */
function onGlass(value, light) {
  const c = colour(value);
  if (!c) return Infinity;
  const card = worst(light);
  const ink = c.slice(0, 3).map((v, i) => v * c[3] + card[i] * (1 - c[3]));
  return ratio(ink, card);
}

/* Inks that are not text on the card. [view, selector, why]. */
const OWN_SURFACE = [
  ['github', '.tip', 'a tooltip with its own fill'],
  ['dns', '.pct', 'the widget sets it at run time with readableInk, which measures the glass card'],
  ['dns', '.flow.ph', 'the empty-state outline drawn in currentColor, not text'],
  ['backup', '.card-front-name', 'on the white front card'],
];

/** The text rules at rest, with the theme they apply to and whether they are the glass step. */
function inkRules(html) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const flat = style.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  const out = [];
  for (const [, prelude, body] of flat.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = [...body.matchAll(/(color|--fg2?|--fg3|--grey|--red)\s*:\s*([^;]+)/g)];
    if (!decls.length) continue;
    for (const raw of prelude.split(',')) {
      const sel = raw.trim();
      const glass = sel.includes('[data-glass]');
      const light = sel.includes('[data-theme="light"]') && !sel.includes(':not([data-theme="light"])');
      const tail = sel.replace(/^(?:html|:root)(?:\[[^\]]*\]|:not\([^)]*\))*\s*/, '').trim() || ':root';
      for (const [, prop, value] of decls) out.push({ sel, tail, prop, value: value.trim(), glass, light });
    }
  }
  return out;
}

test('every translucent widget view is checked', () => {
  const views = glassViews();
  assert.ok(views.length >= 4, views.join(', '));
  for (const v of views) assert.match(fs.readFileSync(path.join(widgets, v), 'utf8'), /widget-theme\.js/, v);
});

test('every ink on a translucent card clears its minimum on glass', () => {
  const failures = [];
  for (const view of glassViews()) {
    const rules = inkRules(fs.readFileSync(path.join(widgets, view), 'utf8'));
    const own = OWN_SURFACE.filter(([w]) => view.startsWith(w)).map(([, s]) => s);
    for (const light of [false, true]) {
      /* What applies in this theme on glass: the glass step, else the theme rule, else the base rule. */
      const keys = new Set(rules.map(r => `${r.tail}|${r.prop}`));
      for (const key of keys) {
        const [tail, prop] = key.split('|');
        if (own.some(s => tail.startsWith(s))) continue;
        const pick = filter => rules.filter(x => `${x.tail}|${x.prop}` === key && filter(x)).at(-1);
        const rule =
          pick(x => x.glass && x.light === light) ??
          pick(x => !x.glass && x.light === light) ??
          pick(x => !x.glass && !x.light);
        if (!rule) continue;
        const min = prop === '--fg3' || prop === '--grey' ? 3 : 4.5;
        const measured = onGlass(rule.value, light);
        if (measured < min)
          failures.push(`${view} ${tail} ${prop} ${rule.value} (${light ? 'light' : 'dark'}): ${measured.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, [], `Below the minimum on glass:\n  ${failures.join('\n  ')}`);
});
