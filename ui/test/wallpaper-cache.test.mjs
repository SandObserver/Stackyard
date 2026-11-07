import fs from 'node:fs';
/* One stored entry serves the dashboard and the settings pages. Two caches, or
   none on one side, show two different photos at the same time. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadWallpaper,
  readWallpaperCache,
  saveBootHint,
  saveWallpaper,
  sizedWallpaperUrl,
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

/* ── the size asked for ───────────────────────────── */

const RAW = 'https://images.unsplash.com/photo-1?ixid=abc&w=2880&h=1800&q=75&auto=format&fit=crop&crop=entropy';
const params = url => new URL(url).searchParams;

test('a phone gets its own shape in device pixels', () => {
  const upright = params(sizedWallpaperUrl(RAW, { width: 390, height: 844, dpr: 3, landscape: false }));
  assert.equal(upright.get('w'), '1170');
  assert.equal(upright.get('h'), '2532');
});

test('a phone reports the same screen at any rotation, so rotation alone decides the shape', () => {
  const sideways = params(sizedWallpaperUrl(RAW, { width: 390, height: 844, dpr: 3, landscape: true }));
  assert.equal(sideways.get('w'), '2532');
  assert.equal(sideways.get('h'), '1170');
});

test('a large screen is capped and keeps its shape', () => {
  const p = params(sizedWallpaperUrl(RAW, { width: 1728, height: 1117, dpr: 2, landscape: true }));
  assert.equal(p.get('w'), '2880');
  assert.equal(p.get('h'), '1862');
});

test('the photo view tracking value and the crop survive', () => {
  const p = params(sizedWallpaperUrl(RAW, { width: 1920, height: 1080, dpr: 1, landscape: true }));
  assert.equal(p.get('ixid'), 'abc');
  assert.equal(p.get('fit'), 'crop');
  assert.equal(p.get('w'), '1920');
});

test('an address stored before this format is brought up to it', () => {
  const old = 'https://images.unsplash.com/photo-1?ixid=abc&w=2800&h=1800&q=85&fm=jpg&fit=crop&crop=entropy';
  const p = params(sizedWallpaperUrl(old, { width: 1920, height: 1080, dpr: 1, landscape: true }));
  assert.equal(p.get('fm'), null);
  assert.equal(p.get('auto'), 'format');
  assert.equal(p.get('q'), '75');
});

test('only Unsplash addresses change', () => {
  const size = { width: 1920, height: 1080, dpr: 1, landscape: true };
  for (const url of ['https://example.com/a.jpg?w=1', '/icons/wallpaper/a.jpg', 'not a url'])
    assert.equal(sizedWallpaperUrl(url, size), url);
});

test('a screen with no size leaves the address alone', () => {
  assert.equal(sizedWallpaperUrl(RAW, { width: 0, height: 0, dpr: 1, landscape: true }), RAW);
});

/* ── hints for the next visit ───────────────────────── */

test('a hint keeps the fields it does not name, under the key the early script reads', t => {
  const store = new Map();
  const was = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  t.after(() => {
    if (was) Object.defineProperty(globalThis, 'localStorage', was);
    else delete globalThis.localStorage;
  });
  saveBootHint({ url: 'https://images/a.jpg', color: 'rgb(1,2,3)' });
  saveBootHint({ lang: 'fa' });
  assert.deepEqual(JSON.parse(store.get('sy-boot')), { url: 'https://images/a.jpg', color: 'rgb(1,2,3)', lang: 'fa' });
  const early = fs.readFileSync(new URL('../js/boot-hints.js', import.meta.url), 'utf8');
  assert.ok(early.includes("localStorage.getItem('sy-boot')"));
  assert.doesNotMatch(early, /--bg-image|innerHTML|appendChild/, 'a hint may not paint a stored photo or layout');
});
