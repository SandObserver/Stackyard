/* One stored entry serves the dashboard and the settings pages. Two caches, or
   none on one side, show two different photos at the same time. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadWallpaper,
  readWallpaperCache,
  saveWallpaper,
  validCredit,
  writeWallpaperCache,
} from '../js/wallpaper-cache.js';

/* ── the wallpaper across a reload ────────────────────────────────────────── */

/* Every admin save reloads every open dashboard. Asking Unsplash for a fresh
   random photo on each reload changes the wallpaper on every screen after an
   unrelated edit. */

const BG = { type: 'unsplash', collection: '1234' };
const T0 = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const CREDIT = {
  name: 'Annie Spratt',
  profile: 'https://unsplash.com/@anniespratt?utm_source=stackyard&utm_medium=referral',
  site: 'https://unsplash.com/?utm_source=stackyard&utm_medium=referral',
};
const PHOTO = { url: 'https://images/a.jpg', credit: CREDIT };

test('a reload inside the cache window keeps the same photo', () => {
  const stored = writeWallpaperCache(PHOTO, BG, T0);
  assert.deepEqual(readWallpaperCache(stored, BG, T0), PHOTO);
  assert.deepEqual(readWallpaperCache(stored, BG, T0 + DAY - 1), PHOTO);
});

test('the photo is replaced once the window has passed', () => {
  const stored = writeWallpaperCache(PHOTO, BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0 + DAY), null);
});

test('changing the background settings picks a new photo', () => {
  const stored = writeWallpaperCache(PHOTO, BG, T0);
  assert.equal(readWallpaperCache(stored, { ...BG, collection: '9999' }, T0), null);
  assert.equal(readWallpaperCache(stored, { type: 'color' }, T0), null);
});

/* A clock that moved backwards would otherwise hold one photo indefinitely. */
test('an entry stamped in the future is discarded', () => {
  const stored = writeWallpaperCache(PHOTO, BG, T0);
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
  assert.doesNotThrow(() => saveWallpaper(PHOTO, BG, T0));
});

/* An entry stored before credits existed would show an Unsplash photo with no
   credit for up to a day. */
test('an entry without a credit field asks for a new photo', () => {
  const old = JSON.stringify({ url: 'https://images/a.jpg', key: 'unsplash|1234', at: T0 });
  assert.equal(readWallpaperCache(old, BG, T0), null);
});

test('a stored credit that is not a pair of Unsplash links is dropped', () => {
  const stored = JSON.stringify({
    ...PHOTO,
    credit: { ...CREDIT, profile: 'javascript:alert(1)' },
    key: 'unsplash|1234',
    at: T0,
  });
  assert.deepEqual(readWallpaperCache(stored, BG, T0), { url: PHOTO.url, credit: null });
});

test('only a named credit with two unsplash.com links is valid', () => {
  assert.deepEqual(validCredit(CREDIT), CREDIT);
  for (const bad of [
    null,
    'x',
    { ...CREDIT, name: ' ' },
    { ...CREDIT, profile: 'https://evil.example/@a' },
    { ...CREDIT, site: 'http://unsplash.com/' },
    { ...CREDIT, profile: 'https://unsplash.com.evil.example/' },
  ]) {
    assert.equal(validCredit(bad), null, JSON.stringify(bad));
  }
});
