import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
globalThis.window = { matchMedia: () => ({ matches: false }) };

/* Enough of a DOM for elements that carry styles, a class and children, and a
   root whose theme a test can set. */
let hostTheme = 'dark';
globalThis.document = {
  documentElement: { getAttribute: () => hostTheme },
  createElement: () => ({
    style: { cssText: '' },
    className: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  }),
};

const { columns, barFill, contrastInk } = await import('../js/widget-toolbox.js');

const heights = c => c.el.children.map(col => col.children[0].style.height);

test('values fill from the right, and missing ones draw nothing', () => {
  const c = columns({ count: 4 });
  c.update([50, 100]);
  assert.deepEqual(heights(c), ['0', '0', 'max(2px, 50.00%)', 'max(2px, 100.00%)']);
});

test('a reading of zero keeps a sliver, so it differs from no reading', () => {
  const c = columns({ count: 2 });
  c.update([0, null]);
  assert.deepEqual(heights(c), ['max(2px, 0.00%)', '0']);
});

test('bad values are no reading and out-of-range ones are clamped', () => {
  const c = columns({ count: 5 });
  c.update([NaN, Infinity, '40', -20, 250]);
  assert.deepEqual(heights(c), ['0', '0', '0', 'max(2px, 0.00%)', 'max(2px, 100.00%)']);
});

test('a scale maps its own range, and dim fades the readings it names', () => {
  const c = columns({ count: 2 });
  c.update([300, 310], { min: 300, max: 320, dim: v => v < 305 });
  assert.deepEqual(heights(c), ['max(2px, 0.00%)', 'max(2px, 50.00%)']);
  assert.deepEqual(
    c.el.children.map(col => col.children[0].style.opacity),
    ['0.45', ''],
  );
});

test('a scale with no range falls back to a share of 100', () => {
  const c = columns({ count: 1 });
  c.update([25], { min: 10, max: 10 });
  assert.deepEqual(heights(c), ['max(2px, 15.00%)']);
});

test('more values than columns keeps the newest', () => {
  const c = columns({ count: 2 });
  c.update([10, 20, 30]);
  assert.deepEqual(heights(c), ['max(2px, 20.00%)', 'max(2px, 30.00%)']);
});

test('a colour carrying a second declaration is refused', () => {
  const c = columns({ count: 1, color: 'red; background-image: url(x)' });
  assert.equal(c.el.children[0].children[0].style.backgroundColor, '#0a84ff');
  c.setColor('#30D158');
  assert.equal(c.el.children[0].children[0].style.backgroundColor, '#30D158');
  c.setColor('url(x)');
  assert.equal(c.el.children[0].children[0].style.backgroundColor, '#30D158', 'a bad colour keeps the last good one');
});

test('track: null leaves the track to the page, so a theme can restyle it', () => {
  assert.equal(columns({ count: 1, track: null }).el.children[0].style.backgroundColor, undefined);
  assert.equal(barFill(10, { track: null }).style.backgroundColor, undefined);
  assert.equal(barFill(10).style.backgroundColor, 'rgba(255,255,255,0.10)');
});

test('the bar validates its colour too', () => {
  assert.equal(barFill(10, { color: '#abc;position:fixed' }).children[0].style.backgroundColor, '#0a84ff');
  assert.equal(barFill(10, { color: '#00D2E0' }).children[0].style.backgroundColor, '#00D2E0');
});

const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('a colour that already reads is left alone on either card', () => {
  hostTheme = 'dark';
  assert.equal(contrastInk('#FF375F', 4.5), '#ff375f');
  hostTheme = 'light';
  assert.equal(contrastInk('#00D2E0', 1.5), '#00d2e0');
});

test('a faint colour is moved only as far as the card needs', () => {
  hostTheme = 'light';
  const white = contrastInk('#FFFFFF', 1.5);
  assert.ok(ratio(white, '#ffffff') >= 1.5 && ratio(white, '#ffffff') < 1.7, white);
  assert.ok(ratio(contrastInk('#FFD600', 4.5), '#ffffff') >= 4.5);
  hostTheme = 'dark';
  const black = contrastInk('#000000', 4.5);
  assert.ok(ratio(black, '#1c1c1e') >= 4.5, black);
});

test('anything but six-digit hex comes back unchanged', () => {
  for (const v of ['rgb(1,2,3)', '#abc', '', undefined]) assert.equal(contrastInk(v), v);
});
