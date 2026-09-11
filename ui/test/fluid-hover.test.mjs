/* The highlight is one element moved between rows. Two things about it are
   load-bearing and invisible in a screenshot: it must not take pointer events,
   and it must not exist until a row is actually hovered. A permanent child
   makes `#sres:empty` false, which keeps the desktop results card on screen
   with nothing in it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

/* fluid-hover imports the shared pill by its served `/js/` path. */
register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function classList(el) {
  const set = new Set();
  return {
    add: (...cs) => cs.forEach(c => set.add(c)),
    remove: c => set.delete(c),
    toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
    contains: c => set.has(c),
    _set: set,
  };
}

function fake(tag, { rect = { left: 0, top: 0, width: 0, height: 0 }, classes = [] } = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    get className() {
      return [...this.classList._set].join(' ');
    },
    style: {},
    attrs: {},
    children: [],
    parent: null,
    isConnected: true,
    scrollLeft: 0,
    scrollTop: 0,
    clientLeft: 0,
    clientTop: 0,
    rect,
    classList: classList(),
    setAttribute(n, v) {
      this.attrs[n] = v;
    },
    hasAttribute(n) {
      return n in this.attrs;
    },
    getAttribute(n) {
      return this.attrs[n] ?? null;
    },
    getBoundingClientRect() {
      return this.rect;
    },
    prepend(child) {
      child.parent = this;
      this.children.unshift(child);
    },
    get firstElementChild() {
      return this.children[0] || null;
    },
    matches(sel) {
      return (this._sel || []).includes(sel);
    },
    closest(sel) {
      let n = this;
      while (n) {
        if ((n._sel || []).includes(sel)) return n;
        n = n.parent;
      }
      return null;
    },
    addEventListener(type, fn) {
      (this._on ||= {})[type] = fn;
    },
  };
  for (const c of classes) el.classList.add(c);
  return el;
}

function install({ fine = true, dir = 'ltr' } = {}) {
  globalThis.matchMedia = () => ({ matches: fine });
  globalThis.getComputedStyle = () => ({
    direction: dir,
    borderTopLeftRadius: '10px',
    borderTopRightRadius: '10px',
    borderBottomRightRadius: '10px',
    borderBottomLeftRadius: '10px',
  });
  globalThis.document = { createElement: tag => fake(tag) };
  globalThis.addEventListener = () => {};
}

const mod = await import('../js/fluid-hover.js');

test('no highlight on a coarse pointer', () => {
  install({ fine: false });
  assert.equal(mod.fluidHoverSupported(), false);
  const list = fake('ul', { classes: [] });
  list._sel = ['.row-dd-list'];
  const li = fake('li');
  li._sel = ['li[role="option"]'];
  li.parent = list;
  mod.fluidHoverKb(li);
  assert.equal(list.children.length, 0, 'touch must never get a pill');
});

test('the pill appears on hover, is inert, and is reused', () => {
  install();
  const list = fake('ul', { rect: { left: 100, top: 50, width: 200, height: 120 } });
  list._sel = ['.row-dd-list'];
  const a = fake('li', { rect: { left: 100, top: 60, width: 200, height: 40 } });
  const b = fake('li', { rect: { left: 100, top: 100, width: 200, height: 40 } });
  for (const li of [a, b]) {
    li._sel = ['li[role="option"]'];
    li.parent = list;
  }

  let over;
  const fakeRoot = { addEventListener: (t, fn) => t === 'pointerover' && (over = fn) };
  mod.initFluidHover(fakeRoot);
  assert.equal(list.children.length, 0, 'nothing exists before the first hover');

  over({ pointerType: 'mouse', target: a });
  assert.equal(list.children.length, 1);
  const pill = list.children[0];
  assert.equal(pill.attrs['aria-hidden'], 'true', 'the pill is decoration');
  assert.ok(pill.classList.contains('mp'), 'it is the shared pill');
  assert.ok(pill.classList.contains('fh-hl'), 'in its hover variant');
  assert.equal(pill.style.transform, 'translate3d(0px,10px,0)');
  assert.equal(pill.style.height, '40px');

  over({ pointerType: 'mouse', target: b });
  assert.equal(list.children.length, 1, 'the same element moves, a second is not made');
  assert.equal(list.children[0], pill);
  assert.equal(pill.style.transform, 'translate3d(0px,50px,0)');
});

test('right-to-left measures from the other edge and travels the other way', () => {
  install({ dir: 'rtl' });
  const list = fake('ul', { rect: { left: 100, right: 300, top: 50, width: 200, height: 120 } });
  list._sel = ['.row-dd-list'];
  /* An inset row: 20px in from the inline start, which is the right edge here. */
  const li = fake('li', { rect: { left: 100, right: 280, top: 60, width: 180, height: 40 } });
  li._sel = ['li[role="option"]'];
  li.parent = list;
  let over;
  mod.initFluidHover({ addEventListener: (t, fn) => t === 'pointerover' && (over = fn) });
  over({ pointerType: 'mouse', target: li });
  assert.equal(list.children[0].style.transform, 'translate3d(-20px,10px,0)');
});

test('a disabled row is skipped', () => {
  install();
  const list = fake('ul', { rect: { left: 0, top: 0, width: 100, height: 50 } });
  list._sel = ['.row-dd-list'];
  const li = fake('li', { rect: { left: 0, top: 0, width: 100, height: 25 } });
  li._sel = ['li[role="option"]'];
  li.parent = list;
  li.setAttribute('aria-disabled', 'true');
  let over;
  mod.initFluidHover({ addEventListener: (t, fn) => t === 'pointerover' && (over = fn) });
  over({ pointerType: 'mouse', target: li });
  assert.equal(list.children.length, 0);
});

test('a touch event never moves the pill', () => {
  install();
  const list = fake('ul', { rect: { left: 0, top: 0, width: 100, height: 50 } });
  list._sel = ['.row-dd-list'];
  const li = fake('li', { rect: { left: 0, top: 0, width: 100, height: 25 } });
  li._sel = ['li[role="option"]'];
  li.parent = list;
  let over;
  mod.initFluidHover({ addEventListener: (t, fn) => t === 'pointerover' && (over = fn) });
  over({ pointerType: 'touch', target: li });
  assert.equal(list.children.length, 0);
});

/* The pill is prepended, so it becomes the group's first child and `:first-child`
   stops matching the top row. The group is rounded and cannot clip, so the row
   carries its own corners: without the paired rule the top corners square off
   the moment anyone hovers the list. */
test('the top row keeps its corners once the pill is in the group', () => {
  const text = fs.readFileSync(path.join(root, 'css/admin.css'), 'utf8');
  const rule = /([^{}]*)\{[^{}]*border-start-start-radius:var\(--sy-radius-group\)[^{}]*\}/.exec(text);
  assert.ok(rule, 'the group corner rule must exist');
  assert.match(rule[1], /\.grp > \.fh-hl \+ \.row\b/);
  assert.match(rule[1], /\.grp > \.fh-hl \+ \.row-wrap > \.row:first-child/);
});

const css = {
  dashboard: fs.readFileSync(path.join(root, 'css/dashboard.css'), 'utf8'),
  admin: fs.readFileSync(path.join(root, 'css/admin.css'), 'utf8'),
};

for (const [name, text] of Object.entries(css)) {
  test(`${name}.css: the pill takes no pointer events`, () => {
    const rule = /(^|[,\s])\.mp\s*\{([^}]*)\}/m.exec(text);
    assert.ok(rule, 'the stylesheet must define the pill');
    assert.match(rule[2], /pointer-events\s*:\s*none/);
  });

  test(`${name}.css: reduced motion stops the slide`, () => {
    const at = text.indexOf('prefers-reduced-motion');
    assert.ok(at > -1, 'the stylesheet must answer reduced motion');
    assert.match(text.slice(at), /\.mp[^}]*\{[^}]*transition\s*:\s*none/);
  });

  test(`${name}.css: the row fill gives way only while the pill is on screen`, () => {
    assert.match(text, /:has\(> \.fh-hl\.on\)/);
  });

  /* A z-index on a row makes it a stacking context. The settings dropdown lives
     inside a row, so its own z-index then only ranks it within that row, and
     every row after it paints on top of the open menu. */
  test(`${name}.css: nothing the pill needs carries a z-index`, () => {
    const rules = [
      ...text.matchAll(
        /(^|\n)([^\n{}]*(?:\.mp|\.fh-hl|\.gs-pill|\.row-dd-list\s*>\s*li|\.sb-nav\s*>|\.mtabbar\s*>|#sres\s*>)[^\n{}]*)\{([^}]*)\}/g,
      ),
    ];
    assert.ok(rules.length, 'the stylesheet must define the pill and its rows');
    for (const r of rules) {
      assert.doesNotMatch(r[3], /z-index/, `z-index in: ${r[2].trim()}`);
    }
  });
}
