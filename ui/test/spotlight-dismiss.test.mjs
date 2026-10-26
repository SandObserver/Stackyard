import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const css = read('css/dashboard.css');
const js = read('js/spotlight.js');

test('the Search pill is a button that cannot be text-selected', () => {
  assert.match(html, /<div id="mob-search-pill" role="button" tabindex="0">/);
  const rule = css.match(/#mob-search-pill \{([^}]*)\}/)[1];
  assert.match(rule, /user-select:none/);
  assert.match(rule, /-webkit-touch-callout:none/);
  assert.match(read('js/ui.js'), /pillNew\.onkeydown = e => \{\s*if \(e\.key !== 'Enter' && e\.key !== ' '\) return;/);
});

test('closing search puts focus back where it was', () => {
  const handler = js.match(/ov\.addEventListener\('close', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(handler, 'the close handler is gone');
  assert.match(handler[1], /if \(!ov\.contains\(document\.activeElement\)\) return;/);
  assert.match(handler[1], /back\.focus\(\)/);
  assert.match(handler[1], /inp\.blur\(\)/);
  assert.match(js, /returnFocus = document\.activeElement;\s*ov\.classList\.add\('on'\);\s*ov\.showModal\(\);/);
});

class FakeEl extends EventTarget {
  constructor(id) {
    super();
    this.id = id;
    this.value = '';
    this.style = {};
    this.attrs = {};
    this.children = [];
    const cls = new Set();
    this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle() {} };
  }
  setAttribute(n, v) {
    this.attrs[n] = String(v);
  }
  appendChild(c) {
    this.children.push(c);
  }
  replaceChildren() {
    this.children = [];
  }
  querySelector() {
    return null;
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  blur() {}
  get isConnected() {
    return true;
  }
}

/* Chromium puts focus back on close() and fires the close event later, in its
   own task. */
function spotlightHarness() {
  const ov = new FakeEl('spot');
  const inp = new FakeEl('sin');
  let before = null;
  ov.open = false;
  ov.showModal = () => {
    ov.open = true;
    before = globalThis.document.activeElement;
  };
  ov.close = () => {
    ov.open = false;
    before?.focus();
  };
  ov.contains = n => n === ov || n === inp;
  const byId = { spot: ov, sin: inp, sres: new FakeEl('sres'), 'spot-cancel': new FakeEl('spot-cancel') };
  const pill = new FakeEl('pill');
  globalThis.HTMLElement = FakeEl;
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.document = {
    activeElement: pill,
    body: new FakeEl('body'),
    getElementById: id => byId[id] ?? null,
    createElement: tag => new FakeEl(tag),
    addEventListener() {},
  };
  return { ov, inp, pill };
}

test('a close event that lands after Search reopened leaves focus in the field', async () => {
  const { ov, inp, pill } = spotlightHarness();
  const { initSpotlight } = await import('../js/spotlight.js');
  const CB = {};
  initSpotlight({ getItems: () => [], isMob: () => false, typeToOpen: () => true, CB, iconChain: () => [] });
  CB.spotOpen('');
  CB.spotClose();
  CB.spotOpen('a');
  assert.equal(document.activeElement, inp);
  ov.dispatchEvent(new Event('close'));
  assert.equal(document.activeElement, inp, 'the late close moved focus out of the reopened field');

  CB.spotClose();
  inp.focus();
  ov.dispatchEvent(new Event('close'));
  assert.equal(document.activeElement, pill, 'a plain close no longer puts focus back');
});

test('a folder result shows the folder icon grid', () => {
  assert.match(js, /if \(isFolder && folderGlyph\) \{[\s\S]*?folderGlyph\(app, 44\)/);
});

test('Cancel sits beside the field, not inside the pill', () => {
  const bar = html.match(/<div class="spot-bar">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(bar, 'the search bar markup moved');
  const field = bar[1].match(/<div class="spot-field">([\s\S]*?)<\/div>/);
  assert.ok(field, 'the field wrapper is gone');
  assert.match(field[1], /id="sin"/, 'the input belongs to the field');
  assert.doesNotMatch(field[1], /id="spot-cancel"/, 'Cancel must sit outside the pill');
  assert.match(bar[1], /id="spot-cancel"/);
});

test('Cancel is shown on every layout', () => {
  const rule = css.match(/#spot-cancel \{([^}]*)\}/);
  assert.ok(rule, 'the Cancel rule is gone');
  assert.doesNotMatch(rule[1], /display:none/, 'Cancel is hidden again');
});

test('Cancel clears the minimum touch target on a phone', () => {
  const rule = css.match(/body\.is-mob #spot-cancel \{([^}]*)\}/);
  assert.ok(rule, 'the phone Cancel rule is gone');
  assert.match(rule[1], /min-width:44px/);
  assert.match(rule[1], /min-height:44px/);
});

test('Cancel carries the tint, not a plain white label', () => {
  const rule = css.match(/body\.is-mob #spot-cancel \{([^}]*)\}/);
  assert.match(rule[1], /color:var\(--accent\)/);
});

test('the field keeps the search-bar height and the body type scale', () => {
  const rule = css.match(/body\.is-mob #spot \.spot-field \{([^}]*)\}/);
  assert.ok(rule, 'the phone field rule is gone');
  assert.match(rule[1], /min-height:48px/);
  assert.match(css, /body\.is-mob #spot #sin \{[^}]*font-size:var\(--fs-body\)/);
});

test('the overlay respects the safe area on both edges', () => {
  assert.match(css, /body\.is-mob #spot #sres \{[^}]*env\(safe-area-inset-top\)/);
  assert.match(css, /body\.is-mob #spot #sbox \{[^}]*env\(safe-area-inset-bottom\)/);
});

test('no floating close button remains', () => {
  assert.doesNotMatch(html, /spot-cancel-mob/);
  assert.doesNotMatch(css, /spot-cancel-mob/);
  assert.doesNotMatch(js, /spot-cancel-mob/);
});

test('a tap on Cancel does not also reach the focus-the-field handler', () => {
  const handler = js.match(/cancelBtn\.addEventListener\(\s*'touchend',([\s\S]*?)\{ passive: false \}/);
  assert.ok(handler, 'the Cancel touch handler is gone');
  assert.match(handler[1], /stopPropagation/);
});

test('the overlay follows the visual viewport, not just its height', () => {
  const fn = js.match(/function _applyKbLayout\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, '_applyKbLayout is gone');
  assert.match(fn[1], /vv\.offsetTop/, 'the page slide is ignored');
  assert.match(fn[1], /ov\.style\.top =/, 'the top edge is never moved back');
  assert.match(fn[1], /ov\.style\.bottom =/);
});

test('closing puts both edges back', () => {
  const fn = js.match(/function close\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'close is gone');
  assert.match(fn[1], /ov\.style\.top = ''/);
  assert.match(fn[1], /ov\.style\.bottom = ''/);
  assert.match(fn[1], /classList\.remove\('kb'\)/);
});

test('the browser is asked to resize the page for the keyboard, except where the key is unknown', () => {
  assert.doesNotMatch(html, /interactive-widget/, 'Safari logs an error for the key in the page');
  const dash = read('js/dashboard.js');
  assert.match(dash, /if \(!\('GestureEvent' in window\)\) \{[\s\S]{0,200}interactive-widget=resizes-content/);
});

test('the list drops the status-bar inset once the keyboard has moved it', () => {
  assert.match(css, /body\.is-mob #spot\.kb #sres \{[^}]*padding-top:12px/);
});

test('a click on a result leaves the new tab to the link', () => {
  assert.match(js, /target: isInternal \? '_self' : '_blank'/);
  assert.match(js, /\} else if \(viaTouch && app\.href\) \{\s*window\.open\(/);
  assert.match(js, /a\.onclick = \(\) => doOpen\(false\);/);
  assert.match(js, /e\.preventDefault\(\);\s*doOpen\(true\);/);
});
