/* Every tile presses the same way on touch-down: the desktop app tile, the
   desktop folder, and the phone app, Dock and folder tiles. Source-shape tests:
   :active needs a real pointer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FakeElement, fire, installDom } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/dashboard.css');

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
  const rule = css.match(/@media \(hover:hover\) and \(pointer:fine\) \{\s*\.icon:hover \.iwrap,[^}]*\}/)?.[0] ?? '';
  assert.ok(rule.includes('.icon:hover .dyn-folder-box'));
  assert.match(rule, /transform:scale\(1\.03\)/);
});

/* fake-dom reads no :is(). A compound with one expands to a list. */
const matches = FakeElement.prototype.matches;
FakeElement.prototype.matches = function (sel) {
  const m = /^(.*):is\(([^()]*)\)(.*)$/.exec(sel);
  if (!m) return matches.call(this, sel);
  return m[2].split(',').some(part => this.matches(`${m[1]}${part.trim()}${m[3]}`));
};

const PHONE_TILES = ['dyn-mob-icon', 'dyn-dock-icon', 'dyn-fold-anchor'];
const DESKTOP_TILES = ['icon', 'di', 'folder-icon-link'];

/* Keep. Without it Safari leaves the tile scaled after a new tab opens. */
test('a phone tile that opens a new tab resets its press', async () => {
  for (const cls of PHONE_TILES)
    assert.match(css, new RegExp(`\\.${cls}\\.settled > \\.plate`), `${cls} has no .settled reset`);
  const tiles = [...PHONE_TILES, ...DESKTOP_TILES];
  const dom = installDom({
    markup:
      tiles.map(c => `<a class="${c}" target="_blank" href="http://x.local"><span class="plate"></span></a>`).join('') +
      '<a class="dyn-mob-icon" href="/admin/"><span class="plate"></span></a>',
  });
  const { wireTileSettle } = await import('../js/dashboard-input.js');
  wireTileSettle();
  const links = dom.document.querySelectorAll('a');
  for (const a of links) fire(a.firstElementChild, 'click');
  for (const a of links.slice(0, tiles.length))
    assert.ok(a.classList.contains('settled'), `${a.className} is never settled`);
  assert.ok(!links.at(-1).classList.contains('settled'), 'a tile that stays in this tab keeps its press');
  fire(links[0], 'pointerleave', { bubbles: false });
  assert.ok(!links[0].classList.contains('settled'), 'the press never comes back');
  dom.restore();
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
  const held = css.match(/:is\(([^)]*)\)\s*\{[^}]*-webkit-touch-callout:none/);
  assert.ok(held, 'no shared rule turns the preview off');
  const tiles = held[1].split(',').map(s => s.trim());
  for (const cls of ['dyn-mob-icon', 'dyn-dock-icon']) assert.ok(tiles.includes(`.${cls}`), cls);
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
