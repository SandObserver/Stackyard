import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const css = read('css/dashboard.css');
const js = read('js/spotlight.js');

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
  assert.match(rule[1], /min-height:44px/);
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

test('the browser is asked to resize the page for the keyboard', () => {
  assert.match(html, /name="viewport"[^>]*interactive-widget=resizes-content/);
});

test('the list drops the status-bar inset once the keyboard has moved it', () => {
  assert.match(css, /body\.is-mob #spot\.kb #sres \{[^}]*padding-top:12px/);
});
