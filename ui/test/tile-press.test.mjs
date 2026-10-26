/* Every tile presses the same way on touch-down: the desktop app tile, the
   desktop folder, and the phone app, Dock and folder tiles. Source-shape tests:
   :active needs a real pointer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/dashboard.css');
const dashboard = read('js/dashboard.js');

const TILES = [
  '.icon:active .iwrap',
  '.icon:active .dyn-folder-box',
  '.dyn-mob-icon:active > .plate',
  '.dyn-dock-icon:active > .plate',
  '.dyn-mob-btn:active > .dyn-box',
  '.dyn-fold-anchor:active > .plate',
];

test('every tile shares the desktop press', () => {
  const rule = css.match(/\.icon:active \.iwrap,[^{]*\{[^}]*\}/)?.[0] ?? '';
  for (const sel of TILES) assert.ok(rule.includes(sel), `${sel} does not press`);
  assert.match(rule, /transform:scale\(\.92\); filter:brightness\(\.88\);/);
  assert.match(rule, /transition:transform \.1s ease-out, filter \.1s ease-out;/);
});

test('the desktop folder lifts on hover like an app tile', () => {
  const rule = css.match(/@media \(hover:hover\) \{\s*\.icon:hover \.iwrap,[^}]*\}/)?.[0] ?? '';
  assert.ok(rule.includes('.icon:hover .dyn-folder-box'));
  assert.match(rule, /transform:scale\(1\.03\)/);
});

/* Keep. Without it Safari leaves the tile scaled after a new tab opens. */
test('a phone tile that opens a new tab resets its press', () => {
  for (const cls of ['dyn-mob-icon', 'dyn-dock-icon', 'dyn-fold-anchor']) {
    assert.match(css, new RegExp(`\\.${cls}\\.settled > \\.plate`), `${cls} has no .settled reset`);
    assert.match(dashboard, new RegExp(`a\\[target="_blank"\\]:is\\([^)]*\\.${cls}`), `${cls} is never settled`);
  }
});

/* [ids, classes, types]. Pseudo-classes count as classes; :is() counts as its
   most specific argument. */
function specificity(sel) {
  const total = [0, 0, 0];
  let rest = sel.replace(/:(?:is|not|has)\(([^()]*)\)/g, (_, list) => {
    const best = list
      .split(',')
      .map(specificity)
      .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
    for (let i = 0; i < 3; i++) total[i] += best[i];
    return ' ';
  });
  rest = rest.replace(/:where\([^()]*\)/g, ' ');
  total[0] += (rest.match(/#[\w-]+/g) || []).length;
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  total[2] += (rest.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return total;
}
const beats = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

test('the specificity helper counts what the cascade counts', () => {
  assert.deepEqual(specificity('.icon:active .iwrap'), [0, 3, 0]);
  assert.deepEqual(specificity('.dyn-mob-icon:hover > .plate'), [0, 3, 0]);
  assert.deepEqual(specificity(':is(#pages, .dyn-strip).dragging :is(.plate, .dyn-box)'), [1, 2, 0]);
  assert.deepEqual(specificity('body.is-mob a'), [0, 1, 2]);
});

const TILE_SURFACE = /\.(plate|iwrap|dwrap|dyn-box|dyn-folder-box)\s*$/;

/* Each selector that scales or dims a tile on press or hover. */
function pressAndHover() {
  const found = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|[;\s])(?:transform|filter)\s*:\s*(?!none)/.test(m[2])) continue;
    for (const sel of m[1].split(',').map(x => x.trim())) {
      if (/:(?:active|hover)/.test(sel) && TILE_SURFACE.test(sel)) found.push(sel);
    }
  }
  return found;
}

/* A drag that starts on a tile keeps :active, so the drag rule must outrank
   every press and hover. */
test('a drag that starts on a tile is not a press', () => {
  const drag = css.match(/([^{}]*\.dragging[^{}]*)\{\s*transform:none; filter:none\s*\}/)?.[1].trim();
  assert.ok(drag, 'the drag rule is gone');
  const rivals = pressAndHover();
  assert.ok(rivals.length >= 15, `expected every press and hover, found ${rivals.length}`);
  for (const sel of rivals) {
    assert.ok(
      beats(specificity(drag), specificity(sel)) > 0,
      `${sel} (${specificity(sel)}) outranks ${drag} (${specificity(drag)})`,
    );
  }
});

test('a long press on a phone tile shows no link preview', () => {
  for (const cls of ['dyn-mob-icon', 'dyn-dock-icon']) {
    assert.match(css, new RegExp(`\\.${cls}\\s+\\{[^}]*-webkit-touch-callout:none`), cls);
  }
});

test('reduced motion drops the scale on every tile', () => {
  const block = css.slice(css.indexOf('/* Reduced motion: neutralize'));
  for (const sel of [
    '.icon .dyn-folder-box',
    '.dyn-mob-icon > .plate',
    '.dyn-dock-icon > .plate',
    '.dyn-mob-btn > .dyn-box',
  ]) {
    assert.ok(block.slice(0, 800).includes(sel), sel);
  }
});
