import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { creditPlacement } = await import('../js/photo-credit.js');

test('the credit sits beside the Dock, limited to the room left of it', () => {
  assert.deepEqual(creditPlacement(1440, { left: 520, right: 920 }, false, 20), { place: 'bottom', maxWidth: 480 });
});

test('in a right-to-left layout the room is measured right of the Dock', () => {
  assert.deepEqual(creditPlacement(1440, { left: 400, right: 1000 }, true, 20), { place: 'bottom', maxWidth: 400 });
});

/* Both are fixed to the bottom edge, so a credit wider than the room overlaps the Dock. */
test('a Dock that leaves too little room moves the credit to the top', () => {
  assert.equal(creditPlacement(800, { left: 100, right: 700 }, false, 20).place, 'top');
});

test('with no Dock the credit keeps the bottom corner', () => {
  assert.deepEqual(creditPlacement(1000, null, false, 20), { place: 'bottom', maxWidth: 480 });
});

/* A link cut off past the ellipsis still takes focus, and its ring is clipped. */
test('only the name gives way, so the Unsplash link is never cut off', async () => {
  const fs = await import('node:fs');
  const { installDom } = await import('./fake-dom.mjs');
  const css = fs
    .readFileSync(new URL('../css/dashboard.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = sel => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at > -1, `${sel} is not declared`);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.doesNotMatch(rule('#photo-credit'), /overflow:hidden/, 'the box clips the focus ring');
  assert.match(rule('#photo-credit'), /display:flex/);
  assert.match(rule('#photo-credit[hidden]'), /display:none/);
  assert.match(rule('#photo-credit > *'), /flex-shrink:0/);
  assert.match(rule('#photo-credit > a:first-child'), /flex-shrink:1;[^}]*overflow:hidden; text-overflow:ellipsis/);

  const dom = installDom();
  try {
    const { showPhotoCredit } = await import('../js/photo-credit.js');
    const box = dom.document.createElement('div');
    showPhotoCredit(box, { name: 'Ann', profile: 'https://u.example/ann', site: 'https://unsplash.com' });
    assert.deepEqual(
      box.children.map(c => [c.tagName, c.textContent]),
      [
        ['A', 'Ann'],
        ['SPAN', '/'],
        ['A', 'Unsplash'],
      ],
    );
    assert.equal(box.hidden, false);
    showPhotoCredit(box, null);
    assert.equal(box.hidden, true);
    assert.equal(box.children.length, 0);
  } finally {
    dom.restore();
  }
});
