/* The mobile folder overlay.

   A badge sits outside its icon's top-right corner by design, so each page is
   inset by the overhang and clips itself. Pages laid flush in one strip render
   a right-column badge in the next page's space: trimmed while its own page is
   shown, and a sliver at the far edge after a swipe. The inset comes out of the
   box padding, so the icons do not move.

   The overlay takes focus itself. A focus trap falling back to the first
   focusable element lands on the first app link, and WebKit paints its own ring
   for a script-driven focus on an anchor.

   Source-shape tests: the geometry is written in JavaScript against a real
   layout, which is not available here. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const ui = read('js/ui.js');
const css = read('css/dashboard.css');

const overlay = ui.slice(ui.indexOf('export function openFolderMobile('), ui.indexOf('export function buildMobile('));
assert.ok(overlay.length > 0, 'openFolderMobile was renamed or moved');

test('a wide window centres a phone-size folder instead of enlarging it', () => {
  assert.match(overlay, /const ptScale = Math\.min\(vw, FOLDER_MAX_VW\) \/ 393;/);
  assert.match(overlay, /boxW = Math\.min\(vw, FOLDER_MAX_VW\) - margin \* 2/);
  assert.match(overlay, /boxLeft = Math\.round\(\(vw - boxW\) \/ 2\)/);
  assert.match(overlay, /'--left': boxLeft \+ 'px'/);
  assert.match(ui, /export const FOLDER_MAX_VW = 430;/);
});

test('a pointer click on the scrim closes the folder', () => {
  assert.match(overlay, /ov\.onclick = e => \{\s*if \(e\.target === ov\) closeMob\(\);/);
});

test('the page is inset by the badge overhang', () => {
  assert.match(
    overlay,
    /badgeOvh = Math\.min\(Math\.ceil\(11 \* \(sc \|\| 1\)\)/,
    'the inset must follow the badge scale',
  );
  assert.match(overlay, /pageW = gridInnerW \+ badgeOvh \* 2/);
  assert.match(overlay, /pageH = gridH \+ badgeOvh \* 2/);
});

test('the inset comes out of the box padding, so the icons keep their place', () => {
  assert.match(overlay, /'--pt': padVT - badgeOvh/);
  assert.match(overlay, /'--ph': padH - badgeOvh/);
  assert.match(overlay, /'--pb': padVB - badgeOvh/);
});

test('the inset never exceeds the padding it is taken from', () => {
  assert.match(overlay, /Math\.min\(Math\.ceil\(11 \* \(sc \|\| 1\)\), padH, padVT, padVB\)/);
});

test('the icon grid itself is unchanged', () => {
  assert.match(overlay, /folderIconW = Math\.min\(Math\.floor\(\(innerW - gap \* 2\) \/ 3\), isz\)/);
  assert.match(css, /\.dyn-page-grid\s*{[^}]*grid-template-columns:repeat\(3,var\(--fiw\)\)/);
});

test('the strip is measured and moved in padded pages', () => {
  assert.match(overlay, /width: pages\.length \* pageW \+ 'px'/);
  assert.match(overlay, /translateX\(\$\{-pageDir\(\) \* curPage \* pageW\}px\)/);
  assert.doesNotMatch(overlay, /curPage \* gridInnerW/, 'a page step shorter than the page leaves the seam visible');
});

test('the viewport is one padded page', () => {
  assert.match(overlay, /css\(clipW, \{ '--gw': pageW \+ 'px', '--gh': pageH \+ 'px' \}\)/);
});

test('a page clips its own overflow', () => {
  const rule = css.match(/\.dyn-page-grid\s*{[^}]*}/);
  assert.ok(rule, '.dyn-page-grid rule not found');
  assert.match(rule[0], /overflow:hidden/, 'without this the badge crosses into the next page');
  assert.match(rule[0], /padding:var\(--ovh,0\)/);
  assert.match(overlay, /'--ovh': badgeOvh \+ 'px'/);
});

/* showModal focuses the first thing it can find, which is the first app in the
   folder. The overlay takes focus itself so a reader is told which folder
   opened before hearing its contents. */
test('the overlay takes focus itself, not the first app', () => {
  assert.match(overlay, /ov\.tabIndex = -1/);
  assert.match(overlay, /ov\.showModal\(\);\s*ov\.focus\(\)/);
});

test('the native focus ring cannot render on a folder app link', () => {
  assert.match(css, /\.folder-overlay-mobile:focus, \.dyn-fold-anchor:focus,/);
  assert.match(css, /\.folder-overlay:focus, \.folder-icon-link:focus \{ outline:none; \}/);
  for (const [reset, visible] of [
    ['.dyn-fold-anchor:focus,', '.dyn-fold-anchor:focus-visible'],
    ['.folder-icon-link:focus ', '.folder-icon-link:focus-visible'],
  ]) {
    assert.ok(
      css.indexOf(visible) > css.indexOf(reset),
      `${visible}: the accent ring must be declared after the reset or it never applies`,
    );
  }
});

/* Desktop WebKit paints the same ring as the phone. */
test('the desktop overlay takes focus itself too', () => {
  const desktop = ui.slice(ui.indexOf('export function openFolderDesktop('), ui.indexOf('function mFolder('));
  assert.match(desktop, /ov\.tabIndex = -1/);
  assert.match(desktop, /ov\.showModal\(\);\s*ov\.focus\(\)/);
});

/* A non-passive touchmove listener holds every scroll on the main thread. */
test('the folder box keeps pinch zoom and pages by touch-action, not by a blocking listener', () => {
  assert.match(css, /\.dyn-box-mob\s+\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.doesNotMatch(
    overlay,
    /passive: false \}\);\s*box\.addEventListener|box\.addEventListener\(\s*'touchmove',[\s\S]{0,200}preventDefault/,
  );
  assert.match(overlay, /swipePager\(box, strip, \{/, 'the folder pages swipe');
});

const motion = ui.slice(ui.indexOf('function folderMotion('), ui.indexOf('let folderOverlay = null;'));

test('a folder grows from the size and place of the tile that opened it', () => {
  assert.match(motion, /const s = from\.width \/ r\.width;/);
  assert.match(
    motion,
    /from\.left \+ from\.width \/ 2 - r\.left - \(r\.width \* s\) \/ 2,\s*from\.top \+ from\.height \/ 2 - r\.top - \(r\.height \* s\) \/ 2,\s*s,?\s*\]/,
  );
  assert.match(ui, /`translate\(\$\{v\[0\]\}px, \$\{v\[1\]\}px\) scale\(\$\{v\[2\]\}\)`/);
  assert.match(motion, /p\.style\.transformOrigin = '0 0'/);
  assert.match(motion, /duration: open \? 300 : 250/);
  assert.match(ui, /openFolderDesktop\(item, a\)/);
  assert.match(ui, /openFolderMobile\(item, isz, ir, im, sc, a\)/);
});

test('reduced motion keeps only the fade', () => {
  assert.match(motion, /prefers-reduced-motion: reduce/);
  assert.match(motion, /!still && tile\?\.isConnected/);
  assert.match(motion, /if \(!from\?\.width\) return \[0, 0, 1\];/);
});

/* The dialog closes at once, so focus goes back to the tile and the dashboard
   stops being inert. Only the picture shrinks away. */
test('a closing folder takes no input and shrinks from where it is', () => {
  assert.match(motion, /const now = opening\.map\(folderNow\);/, 'an interrupted open would jump');
  assert.match(ui, /function folderNow\(tr\) \{\s*const cs = getComputedStyle\(tr\.el\);/);
  assert.match(
    css,
    /:is\(\.folder-overlay, \.folder-overlay-mobile\):not\(\[open\]\) \* \{ pointer-events:none !important \}/,
  );
  assert.match(css, /\.folder-overlay-mobile:not\(\[open\]\) \{ display:block \}/);
  assert.match(
    css,
    /:is\(\.folder-overlay, \.folder-overlay-mobile\):not\(\[open\]\) \{\s*background:none !important; -webkit-backdrop-filter:none !important; backdrop-filter:none !important;/,
    'a fading blur darkens the top edge of the screen',
  );
  assert.match(motion, /stop = playFolder\(\s*parts\.flatMap/, 'only the panel animates the close');
  const dash = read('js/dashboard.js');
  assert.doesNotMatch(
    dash,
    /querySelector\('\.folder-overlay'\)|'\.folder-overlay, \.folder-overlay-mobile'/,
    'a closing folder would block the pager',
  );
});

/* A rebuild removes the tile a folder shrinks into and drops the badges its
   apps registered. */
test('every rebuild closes an open folder first', () => {
  const dash = read('js/dashboard.js');
  const desktop = dash.slice(dash.indexOf('function buildDesktop('), dash.indexOf('const OFF_PAGE_RATE'));
  assert.match(desktop, /^function buildDesktop\(\) \{[\s\S]{0,200}closeFolders\(\);/);
  const mobile = ui.slice(ui.indexOf('export function buildMobile('), ui.indexOf('export function resetMobileChrome('));
  assert.match(mobile, /^export function buildMobile\(\) \{\s*closeFolders\(\);/);
});

function fakeDom() {
  const animations = [];
  class Node extends EventTarget {
    constructor(tag) {
      super();
      this.tag = tag;
      this.children = [];
      this.parent = null;
      this.dataset = {};
      this.style = { setProperty: (k, v) => (this.style[k] = v) };
      this.open = false;
    }
    get isConnected() {
      return this === doc.body || Boolean(this.parent?.isConnected);
    }
    setAttribute() {}
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      return c;
    }
    append(...cs) {
      for (const c of cs) this.appendChild(c);
    }
    prepend(c) {
      this.appendChild(c);
    }
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
    }
    replaceChildren() {}
    contains() {
      return false;
    }
    querySelectorAll() {
      return [];
    }
    focus() {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    }
    animate() {
      const a = { cancel() {}, finished: new Promise(() => {}) };
      animations.push(a);
      return a;
    }
    showModal() {
      this.open = true;
    }
    close() {
      if (!this.open) return;
      this.open = false;
      queueMicrotask(() => this.dispatchEvent(new Event('close')));
    }
    set textContent(_v) {
      this.children = [];
    }
  }
  const doc = { createElement: tag => new Node(tag), addEventListener() {}, activeElement: null };
  doc.body = new Node('body');
  return { doc, animations };
}

test('closing folders for a rebuild removes the folder at once, with no shrink', async () => {
  const { doc, animations } = fakeDom();
  register('./js-root-hooks.mjs', import.meta.url);
  Object.assign(globalThis, {
    window: globalThis,
    document: doc,
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ opacity: '1', transform: 'none' }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  const { initUI, openFolderDesktop, closeFolders } = await import('../js/ui.js');
  initUI({ items: [], S: {}, BEL: new Map(), bupd() {}, breg() {}, bunreg() {} });
  const tile = doc.createElement('button');
  doc.body.appendChild(tile);

  openFolderDesktop({ id: 'f', children: [] }, tile);
  const folder = doc.body.children.find(c => c.tag === 'dialog');
  assert.ok(folder?.open, 'the folder did not open');
  tile.remove();
  const opened = animations.length;

  closeFolders();
  assert.equal(folder.open, false, 'the folder is still open over the new dashboard');
  assert.equal(folder.isConnected, false, 'the folder is left on the page');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(animations.length, opened, 'the folder shrank toward a tile that is gone');

  openFolderDesktop({ id: 'f', children: [] }, tile);
  const again = doc.body.children.find(c => c.tag === 'dialog');
  assert.ok(again?.open, 'the next folder press closed a folder that was already gone');
  closeFolders();
});
