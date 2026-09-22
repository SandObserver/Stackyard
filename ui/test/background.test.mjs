/* One background, two screens. The dashboard and Settings painted their own
   copies of this and had already drifted: one named the backdrop colour once,
   the other spelled it twice.

   backgroundFor touches no DOM, so the three modes are checked directly. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { backgroundFor, applyBackground, BACKDROP } = await import('../js/background.js');

const stubRoot = () => {
  const set = {};
  return { set, style: { setProperty: (k, v) => (set[k] = v) } };
};

test('a colour fills the page and needs no dimming', () => {
  const b = backgroundFor({ type: 'color', color: '#123456' });
  assert.equal(b.color, '#123456');
  assert.equal(b.image, 'none');
  assert.equal(b.brightness, '1');
  assert.equal(b.url, null, 'nothing to sample');
});

/* Both screens used to delete the characters that made a colour invalid, which
   paints whatever is left. The value is rejected now.

   The allowlist checks the shape of a colour, not its contents, so it still
   passes something like `rgb(0 0 0 / bad)` through; CSS then ignores it and the
   property keeps its previous value. That is the point: an unusable value
   changes nothing rather than painting a colour nobody chose. */
test('a malformed colour falls back instead of being repaired', () => {
  const bad = [
    'red; background-image: url(https://evil.example/)',
    'url(https://evil.example/)',
    'expression(alert(1))',
    'var(--x)',
    "a'b",
    '#xyz',
    '!!',
  ];
  for (const c of bad) assert.equal(backgroundFor({ type: 'color', color: c }).color, BACKDROP, c);
});

test('a url wallpaper sits on the backdrop and carries what the sampler needs', () => {
  const b = backgroundFor({ type: 'url', url: 'https://x.test/a.jpg', brightness: 0.4, fit: 'fit' });
  assert.equal(b.color, BACKDROP);
  assert.equal(b.image, "url('https://x.test/a.jpg')");
  assert.equal(b.brightness, '0.4');
  assert.equal(b.size, 'contain');
  assert.equal(b.fit, 'fit');
  assert.equal(b.url, 'https://x.test/a.jpg');
});

test('a wallpaper fills the page unless fit is asked for', () => {
  const fill = backgroundFor({ type: 'url', url: 'https://x.test/a.jpg' });
  assert.equal(fill.size, 'cover');
  assert.equal(fill.fit, 'fill');
});

/* The fit control belongs to a URL wallpaper. An unsplash photo is framed by
   the service, and letterboxing it leaves bars down the sides. */
test('an unsplash wallpaper is never letterboxed', () => {
  const b = backgroundFor({ type: 'unsplash', fit: 'fit' }, 'https://x.test/u.jpg');
  assert.equal(b.fit, 'fill');
  assert.equal(b.size, 'cover');
});

test('the documented default brightness is used when none is set', () => {
  assert.equal(backgroundFor({ type: 'url', url: 'https://x.test/a.jpg' }).brightness, '0.62');
});

test('a brightness that is not a number falls back rather than painting NaN', () => {
  assert.equal(backgroundFor({ type: 'url', url: 'https://x.test/a.jpg', brightness: 'dim' }).brightness, '0.62');
});

/* A quote or a paren closes the url() and starts another declaration. */
test('a wallpaper url cannot break out of the css value', () => {
  const b = backgroundFor({ type: 'url', url: "a.jpg'); background: url('evil" });
  assert.equal(b.image.includes("');"), false, b.image);
  assert.match(b.image, /^url\('[^'()]*'\)$/);
});

test('settings that name no background paint nothing', () => {
  for (const bg of [{}, null, undefined, { type: 'color' }, { type: 'url' }, { type: 'unsplash' }]) {
    assert.equal(backgroundFor(bg), null, JSON.stringify(bg));
  }
});

test('applyBackground sets the four properties the stylesheet reads', () => {
  const root = stubRoot();
  applyBackground(root, backgroundFor({ type: 'color', color: '#abcdef' }));
  assert.deepEqual(root.set, {
    '--bg-image': 'none',
    '--bg-color': '#abcdef',
    '--bg-brightness': '1',
    '--bg-size': 'cover',
  });
});
