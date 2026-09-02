/* One stored entry serves the dashboard and the settings pages. Two caches, or
   none on one side, show two different photos at the same time. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadWallpaper, readWallpaperCache, saveWallpaper, writeWallpaperCache } from '../js/wallpaper-cache.js';

/* ── the wallpaper across a reload ────────────────────────────────────────── */

/* Every admin save reloads every open dashboard. Asking Unsplash for a fresh
   random photo on each reload changes the wallpaper on every screen after an
   unrelated edit. */

const BG = { type: 'unsplash', collection: '1234' };
const T0 = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

test('a reload inside the cache window keeps the same photo', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0), 'https://images/a.jpg');
  assert.equal(readWallpaperCache(stored, BG, T0 + DAY - 1), 'https://images/a.jpg');
});

test('the photo is replaced once the window has passed', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0 + DAY), null);
});

test('changing the background settings picks a new photo', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, { ...BG, collection: '9999' }, T0), null);
  assert.equal(readWallpaperCache(stored, { type: 'color' }, T0), null);
});

/* A clock that moved backwards would otherwise hold one photo indefinitely. */
test('an entry stamped in the future is discarded', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0 - 1000), null);
});

test('a missing or unusable entry asks for a new photo', () => {
  for (const v of [null, undefined, '', 'not json', '{}', '{"url":"","key":"unsplash|1234","at":0}', '[]']) {
    assert.equal(readWallpaperCache(v, BG, T0), null, `for ${JSON.stringify(v)}`);
  }
  assert.equal(readWallpaperCache(JSON.stringify({ url: 'https://i/a.jpg', key: 'unsplash|1234' }), BG, T0), null);
});

/* Both pages run this without a storage of their own in every non-browser
   context that loads the module. */
test('a page with no usable storage falls back to a fresh photo', () => {
  assert.equal(loadWallpaper(BG, T0), null);
  assert.doesNotThrow(() => saveWallpaper('https://images/a.jpg', BG, T0));
});
