/* An icon name resolves to several candidate URLs and only the browser knows
   which exists, so the walk is on error.

   The folder picker carried its own copy of this with no walk at all: it set
   one URL and stopped, so every app whose first candidate missed showed a
   broken image. Both sites share one painter now, and this covers the walk the
   duplicate was missing. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

/* An <img> that reports failure for anything not in `exists`, the way a browser
   does after the request comes back. */
function makeDom(exists) {
  const created = [];
  globalThis.document = {
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        style: { cssText: '' },
        parent: null,
        alt: '',
        onerror: null,
        tried: [],
        set src(v) {
          this.tried.push(v);
          this._src = v;
          if (!exists.includes(v)) queueMicrotask(() => this.onerror && this.onerror());
        },
        get src() {
          return this._src;
        },
        remove() {
          if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
        },
      };
      created.push(node);
      return node;
    },
  };
  return created;
}

function host() {
  return {
    textContent: '',
    children: [],
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
      return c;
    },
  };
}

/* The walk is driven by microtasks, so let them all run. */
const settle = () => new Promise(r => setTimeout(r, 0));

const { paintIcon } = await import('../js/admin-shared.js');
const { iconChain } = await import('../js/icons.js');

test('an icon that resolves is painted as an image', async () => {
  const chain = iconChain('plex');
  makeDom([chain[0]]);
  const h = host();
  paintIcon(h, 'plex', 'P');
  await settle();
  assert.equal(h.children.length, 1, 'no image was appended');
  assert.equal(h.textContent, '', 'it fell back although the first candidate exists');
});

/* The defect: the picker set candidates[0] and stopped. */
test('a first candidate that misses falls through to the next', async () => {
  const chain = iconChain('plex');
  assert.ok(chain.length > 1, 'this icon name should offer more than one candidate');
  makeDom([chain[chain.length - 1]]);
  const h = host();
  paintIcon(h, 'plex', 'P');
  await settle();
  const img = h.children[0];
  assert.ok(img, 'the image was dropped even though a later candidate exists');
  assert.equal(img.src, chain[chain.length - 1], 'it stopped before the candidate that works');
  assert.equal(img.tried.length, chain.length, 'it skipped candidates instead of walking them');
});

test('an icon that resolves to nothing falls back to the letter', async () => {
  makeDom([]);
  const h = host();
  paintIcon(h, 'plex', 'P');
  await settle();
  assert.equal(h.textContent, 'P', 'a broken image was left in place');
  assert.equal(h.children.length, 0, 'the failed image is still in the tree');
});

test('no icon at all is the letter, without touching the network', async () => {
  const created = makeDom([]);
  const h = host();
  paintIcon(h, '', 'P');
  await settle();
  assert.equal(h.textContent, 'P');
  assert.equal(created.length, 0, 'an image was requested for an app that has no icon');
});
