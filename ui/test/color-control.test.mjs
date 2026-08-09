import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* admin-color-control imports peers by their served paths, so map them first. */
register('./js-root-hooks.mjs', import.meta.url);

/* The canvas is how a CSS colour is parsed: assigning to fillStyle normalises
   whatever CSS accepts. Node has no canvas, so this stands in for the parts the
   module relies on, and counts how many are built.

   P11-6 is about that count. _cssToHex created a canvas and a 2D context on
   every call, including for the eight preset swatches, which are already
   #rrggbb and need no parsing at all. */
const NAMED = { red: '#ff0000', rebeccapurple: '#663399', white: '#ffffff' };
let canvasCount = 0;

function stubContext() {
  let value = '#000000';
  return {
    set fillStyle(x) {
      const s = String(x).trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(s)) value = s;
      else if (/^#[0-9a-f]{3}$/.test(s)) value = '#' + [...s.slice(1)].map(c => c + c).join('');
      else if (NAMED[s]) value = NAMED[s];
      else {
        const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) value = `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
      }
      /* Anything else leaves the previous value, which is what a browser does:
         an invalid assignment to fillStyle is ignored. */
    },
    get fillStyle() {
      return value;
    },
  };
}

globalThis.document = {
  createElement: () => {
    canvasCount++;
    return { getContext: () => stubContext() };
  },
};

const { _internals } = await import('../js/admin-color-control.js');
const { cssToHex, hsvToRgb, hexToHsv } = _internals;

/* ── the finding ─────────────────────────────────────────────────────────── */

test('a value already in #rrggbb form is not parsed through a canvas', () => {
  canvasCount = 0;
  for (const hex of ['#1c1c1e', '#8e8e93', '#f2f2f7', '#ff393c', '#ffcd00', '#35c759', '#0289ff', '#cb30df']) {
    assert.equal(cssToHex(hex), hex);
  }
  assert.equal(canvasCount, 0, 'the eight presets should need no parsing at all');
});

test('a colour that does need parsing still gets a canvas', () => {
  canvasCount = 0;
  assert.equal(cssToHex('red'), '#ff0000');
  assert.equal(cssToHex('rgb(1, 2, 3)'), '#010203');
  assert.ok(canvasCount >= 2, 'named and rgb() forms are resolved by the canvas');
});

/* ── behaviour that must not have changed ────────────────────────────────── */

test('output is lowercase whatever the input case', () => {
  assert.equal(cssToHex('#FFCD00'), '#ffcd00');
  assert.equal(cssToHex('#AbCdEf'), '#abcdef');
});

test('surrounding whitespace is tolerated', () => {
  assert.equal(cssToHex('  #1c1c1e  '), '#1c1c1e');
});

test('shorthand, named and rgb forms resolve as before', () => {
  assert.equal(cssToHex('#abc'), '#aabbcc');
  assert.equal(cssToHex('rebeccapurple'), '#663399');
  assert.equal(cssToHex('rgba(4,5,6,0.5)'), '#040506', 'alpha is dropped');
});

/* A browser ignores an invalid assignment to fillStyle, so the '#000' seeded
   just before it is what comes back. Pinned because callers treat the result as
   a colour rather than checking it. */
test('an unreadable value falls back rather than throwing', () => {
  for (const bad of ['not-a-colour', '', '#12345', '#1234567']) {
    assert.equal(cssToHex(bad), '#000000', JSON.stringify(bad));
  }
});

test('a null or undefined input does not throw', () => {
  assert.equal(cssToHex(undefined), '#000000');
  assert.equal(cssToHex(null), '#000000');
});

/* ── the conversions the control is built on ─────────────────────────────── */

test('hsvToRgb and hexToHsv round-trip the presets', () => {
  for (const hex of ['#1c1c1e', '#ff393c', '#35c759', '#0289ff', '#cb30df']) {
    const hsv = hexToHsv(hex);
    assert.ok(hsv, hex);
    const [r, g, b] = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const back = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    /* Rounding to integer h/s/v loses a little, so allow one step per channel. */
    const want = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    [r, g, b].forEach((n, i) => assert.ok(Math.abs(n - want[i]) <= 2, `${hex} -> ${back}`));
  }
});

/* The reformat that came with this: the hue is normalised before the chroma is
   derived from it, so a negative hue can no longer produce a negative channel
   (h=-30 used to give [255, 0, -127], formatting as "#ff00-7f"). */
test('every hue yields channels in range', () => {
  for (let h = -720; h <= 720; h += 7) {
    for (const s of [0, 50, 100]) {
      for (const v of [0, 50, 100]) {
        const c = hsvToRgb(h, s, v);
        assert.ok(
          c.every(n => Number.isInteger(n) && n >= 0 && n <= 255),
          `h=${h} s=${s} v=${v} -> ${c}`,
        );
      }
    }
  }
});

test('a hue and its wrapped equivalent agree', () => {
  assert.deepEqual(hsvToRgb(-30, 100, 100), hsvToRgb(330, 100, 100));
  assert.deepEqual(hsvToRgb(400, 100, 100), hsvToRgb(40, 100, 100));
});
