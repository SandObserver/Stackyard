/* The selection pill replaces the fill on the active nav item, so two things
   must hold. The hidden nav (the one belonging to the other layout) reports a
   zero rect and must be left alone rather than placed in a corner. And the
   sidebar's pill is a solid accent fill under inverted label text, so the ink
   has to wait for the pill to arrive or a label sits light on the bare pane
   mid-flight. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fake(tag, rect, classes = []) {
  const set = new Set(classes);
  return {
    tagName: tag.toUpperCase(),
    style: {},
    attrs: {},
    children: [],
    rect,
    scrollTop: 0,
    clientLeft: 0,
    clientTop: 0,
    classList: {
      add: (...c) => c.forEach(x => set.add(x)),
      remove: (...c) => c.forEach(x => set.delete(x)),
      contains: c => set.has(c),
      _set: set,
    },
    setAttribute(n, v) {
      this.attrs[n] = v;
    },
    getBoundingClientRect() {
      return this.rect;
    },
    prepend(c) {
      this.children.unshift(c);
    },
    get firstElementChild() {
      return this.children[0] || null;
    },
    querySelector(sel) {
      return this._q?.[sel] ?? null;
    },
  };
}

function install() {
  globalThis.getComputedStyle = () => ({
    direction: 'ltr',
    borderTopLeftRadius: '22px',
    borderTopRightRadius: '22px',
    borderBottomRightRadius: '22px',
    borderBottomLeftRadius: '22px',
  });
  globalThis.document = { createElement: t => fake(t, { left: 0, top: 0, width: 0, height: 0 }) };
  globalThis.addEventListener = () => {};
}

const { syncGlideSelect, initGlideSelect } = await import('../js/glide-select.js');

const ZERO = { left: 0, right: 0, top: 0, width: 0, height: 0 };

function navRoot({ sidebarRect, activeRect, dockRect = ZERO }) {
  const sb = fake('ul', sidebarRect);
  const active = fake('button', activeRect, ['nl', 'active']);
  sb._q = { '.nl.active': active };
  const dock = fake('nav', dockRect);
  dock._q = { '.mtab.active': null };
  return {
    sb,
    active,
    dock,
    querySelectorAll: sel => (sel === '.sb-nav' ? [sb] : sel === '.mtabbar' ? [dock] : []),
  };
}

test('a nav hidden for the other layout is left alone', () => {
  install();
  const r = navRoot({ sidebarRect: ZERO, activeRect: ZERO });
  syncGlideSelect(r);
  assert.equal(r.sb.children.length, 0, 'no pill is placed against a zero rect');
  assert.equal(r.dock.children.length, 0);
});

test('the pill lands on the active item', () => {
  install();
  const r = navRoot({
    sidebarRect: { left: 10, right: 210, top: 100, width: 200, height: 200 },
    activeRect: { left: 10, right: 210, top: 146, width: 200, height: 44 },
  });
  syncGlideSelect(r);
  assert.equal(r.sb.children.length, 1);
  const pill = r.sb.children[0];
  assert.ok(pill.classList.contains('gs-pill'));
  assert.equal(pill.attrs['aria-hidden'], 'true');
  assert.equal(pill.style.transform, 'translate3d(0px,46px,0)');
  assert.equal(pill.style.height, '44px');
  assert.equal(pill.style.borderRadius, '22px 22px 22px 22px');
});

test('the ink is held only when the pill actually travels', () => {
  install();
  const r = navRoot({
    sidebarRect: { left: 10, right: 210, top: 100, width: 200, height: 200 },
    activeRect: { left: 10, right: 210, top: 146, width: 200, height: 44 },
  });
  syncGlideSelect(r);
  assert.equal(r.sb.classList.contains('gs-moving'), false, 'the first placement has nowhere to travel from');

  const moved = fake('button', { left: 10, right: 210, top: 190, width: 200, height: 44 }, ['nl', 'active']);
  r.sb._q = { '.nl.active': moved };
  syncGlideSelect(r);
  assert.equal(r.sb.classList.contains('gs-moving'), true, 'a real move holds the ink');
  assert.equal(r.sb.children.length, 1, 'the same pill moves');
  assert.equal(r.sb.children[0].style.transform, 'translate3d(0px,90px,0)');
});

/* The tab bar is display:none until the page is marked authenticated, so the
   sync at init measures zero and places nothing. Without the observer the dock
   never gets a pill at all. */
test('each nav is observed, so one laid out later still gets its pill', () => {
  install();
  const observed = [];
  globalThis.ResizeObserver = class {
    observe(el) {
      observed.push(el);
    }
  };
  const r = navRoot({ sidebarRect: ZERO, activeRect: ZERO });
  initGlideSelect(r);
  assert.deepEqual(observed, [r.sb, r.dock], 'both navs are watched');
  delete globalThis.ResizeObserver;
});

test('the sidebar fill gives way only while its pill exists', () => {
  const css = fs.readFileSync(path.join(root, 'css/admin.css'), 'utf8');
  assert.match(css, /\.sb-nav:has\(> \.gs-pill\.on\) \.nl\.active\{background:transparent\}/);
  assert.match(css, /\.mtabbar:has\(> \.gs-pill\.on\) \.mtab\.active\{background:transparent\}/);
});

test('the label ink waits for the pill', () => {
  const css = fs.readFileSync(path.join(root, 'css/admin.css'), 'utf8');
  const rule = /\.sb-nav\.gs-moving \.nl\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the ink hold must be declared');
  const delay = /color\s+[\d.]+m?s\s+[a-z-]+\s+([\d.]+)s/.exec(rule[1]);
  assert.ok(delay, 'the colour transition must carry a delay');
  assert.ok(Number(delay[1]) >= 0.15, `the delay must cover the glide, got ${delay[1]}s`);
});

test('reduced motion drops the hold as well as the glide', () => {
  const css = fs.readFileSync(path.join(root, 'css/admin.css'), 'utf8');
  const block = css.slice(css.lastIndexOf('prefers-reduced-motion'));
  assert.match(block, /\.mp,\.mp\.on\{transition:none\}/);
  assert.match(block, /\.sb-nav\.gs-moving \.nl\{transition:background var\(--t\),color var\(--t\)\}/);
});
