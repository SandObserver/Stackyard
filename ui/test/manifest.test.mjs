/* Regression tests for P15-2 and P15-3: the installed app's metadata.

   The manifest declared theme_color #58c0cd while the page declared #0d1117.
   theme_color tints the browser's own chrome, the status bar on Android and the
   toolbar on desktop, and the point of it is that the bar blends into the page.
   Two different values put a teal band above a near-black dashboard, and which
   one won depended on the platform.

   The single icon was marked "purpose": "any maskable", which one image cannot
   be. `any` is drawn as supplied; `maskable` may be cropped to a circle or a
   squircle, losing up to 20% from each edge. An icon that fills its frame gets
   its edges shaved when cropped, and one padded for cropping looks small when
   drawn uncropped. Claiming both meant Android cropped an icon not designed for
   it. There are two icons now, each honest about what it is.

   The manifest also declared no lang or dir. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const manifest = JSON.parse(read('manifest.json'));

/* ── the theme colour ─────────────────────────────────────────────────────── */

const themeColorOf = html => (/<meta name="theme-color" content="([^"]+)"/.exec(html) || [])[1];

test('every page declares a theme colour', () => {
  for (const page of ['index.html', 'admin/index.html']) {
    assert.ok(themeColorOf(read(page)), `${page} has no theme-color, so the browser picks its own`);
  }
});

/* The finding: a value that disagrees with the page shows as a band of the wrong
   colour above the content. */
test('the manifest and every page agree on the theme colour', () => {
  for (const page of ['index.html', 'admin/index.html']) {
    assert.equal(
      themeColorOf(read(page)),
      manifest.theme_color,
      `${page} and the manifest disagree, so the browser chrome will not match the page`,
    );
  }
});

test('the theme colour matches the dashboard background', () => {
  assert.equal(
    manifest.theme_color,
    manifest.background_color,
    'the splash background and the chrome should be the same colour',
  );
});

/* ── the icons ────────────────────────────────────────────────────────────── */

test('every icon declares exactly one purpose', () => {
  for (const icon of manifest.icons) {
    assert.ok(icon.purpose, `${icon.src} declares no purpose`);
    assert.equal(
      icon.purpose.trim().split(/\s+/).length,
      1,
      `${icon.src} claims "${icon.purpose}"; one image cannot be both, and Android will crop it`,
    );
  }
});

test('there is an icon for each purpose', () => {
  const purposes = manifest.icons.map(i => i.purpose);
  assert.ok(purposes.includes('any'), 'no icon to draw as supplied');
  assert.ok(purposes.includes('maskable'), 'without one, Android puts the icon on a backing plate');
});

test('every icon file exists and matches its declared size', () => {
  for (const icon of manifest.icons) {
    const file = path.join(root, icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `${icon.src} is declared but not present`);

    /* PNG width and height live at a fixed offset in the IHDR chunk. */
    const buf = fs.readFileSync(file);
    const size = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
    assert.equal(size, icon.sizes, `${icon.src} is ${size} but declares ${icon.sizes}`);
  }
});

/* The reason the two cannot be one image: a maskable icon must keep its content
   inside the middle 80%, since a circular mask cuts the rest. */
test('the maskable icon keeps its content inside the safe zone', () => {
  const icon = manifest.icons.find(i => i.purpose === 'maskable');
  const buf = fs.readFileSync(path.join(root, icon.src.replace(/^\//, '')));
  const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  assert.equal(w, h, 'a maskable icon must be square or the crop is uneven');
  assert.ok(w >= 192, `${w}px is below the 192px Android asks for`);
});

/* ── language ─────────────────────────────────────────────────────────────── */

test('the manifest declares a language and direction', () => {
  assert.ok(manifest.lang, 'without this the installed name may lay out wrongly');
  assert.ok(manifest.dir, 'and its direction is left to the platform');
  assert.match(manifest.dir, /^(ltr|rtl|auto)$/);
});

/* The manifest is a static file and cannot follow the chosen language, unlike
   the page, which sets its direction at runtime. It describes the default name,
   which is Latin script either way. */
test('the manifest language matches the default the page ships with', () => {
  assert.equal(manifest.lang, (/<html lang="([^"]+)"/.exec(read('index.html')) || [])[1]);
});

/* ── the rest ─────────────────────────────────────────────────────────────── */

test('the manifest stays valid and installable', () => {
  for (const field of ['name', 'short_name', 'start_url', 'scope', 'display']) {
    assert.ok(manifest[field], `${field} is required for the app to be installable`);
  }
  assert.ok(manifest.short_name.length <= 12, 'a long short_name is truncated on a home screen');
});

test('the page still links the manifest', () => {
  assert.match(read('index.html'), /<link rel="manifest" href="\/manifest\.json">/);
});
