import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const preload = read('../js/mobile-class.js');
const adminHtml = read('../admin/index.html');

/* Every combination of width, height, screen and device the rule reads. */
const VIEWPORTS = [];
for (const [w, h] of [
  [390, 844],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [700, 450],
  [1440, 900],
  [500, 900],
  [800, 600],
])
  for (const [sw, sh] of [
    [w, h],
    [390, 844],
    [1440, 900],
  ])
    for (const ua of ['Mozilla/5.0 (iPhone)', 'Mozilla/5.0 (Linux; Android 15)', 'Mozilla/5.0 (Macintosh)'])
      VIEWPORTS.push({ w, h, sw, sh, ua });

/** A window of one size, answering the media queries the two files ask. */
function windowOf({ w, h, sw, sh, ua }) {
  const answer = q => {
    let ok = true;
    for (const [, feature, value] of q.matchAll(/\(([\w-]+):([\w]+)\)/g)) {
      const px = Number.parseInt(value, 10);
      if (feature === 'max-width') ok &&= w <= px;
      else if (feature === 'min-width') ok &&= w >= px;
      else if (feature === 'max-height') ok &&= h <= px;
      else if (feature === 'orientation') ok &&= (value === 'portrait') === h >= w;
      else throw new Error(`unread media feature ${feature}`);
    }
    return { matches: ok };
  };
  return { matchMedia: answer, screen: { width: sw, height: sh }, navigator: { userAgent: ua } };
}

test('the preload script picks the layout layout.js picks, on every viewport', async () => {
  const { isMobileLayout } = await import('../js/layout.js');
  for (const v of VIEWPORTS) {
    const win = windowOf(v);
    const classes = new Set();
    const document = { documentElement: { classList: { add: c => classes.add(c) } } };
    vm.runInNewContext(preload, { window: win, document, ...win });
    Object.assign(globalThis, { window: win });
    for (const k of ['screen', 'navigator'])
      Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true });
    assert.equal(classes.has('is-mobile'), isMobileLayout(), JSON.stringify(v));
  }
});

test('the preload script is not a module', () => {
  assert.ok(!/\b(import|export)\b/.test(preload));
});

test('admin loads the preload script before its stylesheets', () => {
  const script = adminHtml.indexOf('/js/mobile-class.js');
  const stylesheet = adminHtml.indexOf('rel="stylesheet"');
  assert.ok(script > -1, 'admin/index.html does not load mobile-class.js');
  assert.ok(script < stylesheet);
  assert.ok(!/mobile-class\.js[^>]*\b(defer|async|type="module")/.test(adminHtml));
});
