/* A dashboard page that has scrolled off is still in the DOM.

   Nothing took it out of the tab order, so Tab walked past the last tile of the
   visible page onto tiles on pages two and three: focus left the screen, the
   pager did not follow it, and there was no indicator to see because the
   element was outside the viewport. A reader also read every page as one flat
   list, which makes the pager meaningless.

   `inert` covers both halves: it removes the subtree from the tab order and
   from the accessibility tree. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { installDom, pageBody } from './fake-dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('js/ui.js');
register('./js-root-hooks.mjs', import.meta.url);
const { inertAllBut } = await import('../js/utils.js');
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');

function strip(n) {
  const children = Array.from({ length: n }, () => {
    const attrs = new Set();
    return {
      attrs,
      setAttribute: name => attrs.add(name),
      removeAttribute: name => attrs.delete(name),
    };
  });
  return { children };
}

test('every page but the current one is inert', () => {
  const s = strip(3);
  inertAllBut(/** @type {any} */ (s), 1);
  assert.deepEqual(
    s.children.map(c => c.attrs.has('inert')),
    [true, false, true],
  );
  inertAllBut(/** @type {any} */ (s), 0);
  assert.deepEqual(
    s.children.map(c => c.attrs.has('inert')),
    [false, true, true],
    'the page left behind becomes inert and the new one is released',
  );
});

test('a home page turn marks the other pages inert before the strip moves', () => {
  const dom = installDom({ markup: pageBody('index.html') });
  const pages = dom.document.getElementById('pages');
  pages.innerHTML = '<div class="page"></div><div class="page"></div><div class="page"></div>';
  const dash = createDashboardState();
  dash.totalPages = 3;
  const inertAt = () => pages.children.map(c => c.hasAttribute('inert'));
  let atMove = null;
  let shift = '';
  Object.defineProperty(pages.style, 'transform', {
    configurable: true,
    get: () => shift,
    set: v => {
      atMove = inertAt();
      shift = v;
    },
  });
  const { goTo } = createPager(dash);
  goTo(1, false);
  assert.deepEqual(atMove, [true, false, true], 'the pages have to be marked before the strip moves');
  goTo(2, false);
  assert.deepEqual(inertAt(), [true, true, false]);
  dom.restore();
});

test('the folder overlay pages the same way', () => {
  const start = ui.indexOf('function gotoPage(');
  assert.match(ui.slice(start, ui.indexOf('\n  }\n', start)), /inertAllBut\(strip, curPage\)/);
});

/* An interior dot cannot be wider than the gap between it and its neighbour:
   their hit areas meet. 2.5.8 asks for 24. */
test('the pagination dots are 24 CSS px apart', () => {
  const css = read('css/dashboard.css');
  const dots = /#dots \{([\s\S]*?)\}/.exec(css);
  assert.ok(dots, '#dots rule is missing');
  const gap = /gap:(\d+)px/.exec(dots[1]);
  assert.ok(gap, '#dots has no gap');
  const size = /\.dot \{[\s\S]*?width:(\d+)px/.exec(css);
  assert.ok(size, '.dot has no width');
  const pitch = Number(gap[1]) + Number(size[1]);
  assert.ok(
    pitch >= 24,
    `the dots sit ${pitch}px apart, so an interior target is ${pitch}px wide, under the 24 of 2.5.8`,
  );
});
