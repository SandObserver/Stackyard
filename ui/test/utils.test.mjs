import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

/* utils.js imports a peer by its served path ('/js/icons.js?v=69c2b9bd...'), which Node
   cannot resolve from disk. Register the mapping hook in THIS process, then load
   utils.js dynamically so the hook is active when its imports resolve. Doing it
   here (rather than via --import) keeps it working under the test runner's
   per-file child processes. */
register('./js-root-hooks.mjs', import.meta.url);
const { clr, esc, sanitizeCssUrl, safeAllow } = await import('../js/utils.js');

test('clr maps the sentinel color names to concrete hex', () => {
  assert.equal(clr('dark'), '#1C1C1E');
  assert.equal(clr('light'), '#F2F2F7');
});

test('clr treats empty/falsy as dark', () => {
  assert.equal(clr(''), '#1C1C1E');
  assert.equal(clr(null), '#1C1C1E');
  assert.equal(clr(undefined), '#1C1C1E');
});

test('clr passes through any other value unchanged', () => {
  assert.equal(clr('#abcdef'), '#abcdef');
  assert.equal(clr('rebeccapurple'), 'rebeccapurple');
});

test('esc encodes the five HTML-significant characters', () => {
  assert.equal(esc('<a href="x">&\'y\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;');
});

test('esc encodes single quotes so single-quoted attributes stay safe', () => {
  assert.equal(esc("' onmouseover='alert(1)"), '&#39; onmouseover=&#39;alert(1)');
});

test('esc encodes ampersand before other entities (no double-encoding)', () => {
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('&lt;'), '&amp;lt;');
});

test('esc coerces null and undefined to empty string', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('sanitizeCssUrl strips characters that could break out of url(...)', () => {
  assert.equal(sanitizeCssUrl(`a'b"c`), 'abc');
  assert.equal(sanitizeCssUrl('a(b)c'), 'abc');
  assert.equal(sanitizeCssUrl('a\\b'), 'ab');
});

test('sanitizeCssUrl leaves a normal URL intact and coerces empties', () => {
  assert.equal(sanitizeCssUrl('https://host/path/img.png?v=2'), 'https://host/path/img.png?v=2');
  assert.equal(sanitizeCssUrl(null), '');
  assert.equal(sanitizeCssUrl(undefined), '');
});

/* ── a colour has to be a colour ──────────────────────────────────────────── */

/* The value is assigned to a background and can have arrived in an imported
   config. A url() there fetches from the host it names; the page's img-src
   refuses it today, and this is so that refusal is not the only thing in the
   way. */

test('clr keeps the colour forms the app and CSS actually use', () => {
  for (const ok of [
    '#fff',
    '#ff0000',
    '#ff0000cc',
    'rgb(255, 0, 0)',
    'rgba(255,0,0,.5)',
    'hsl(210 50% 40%)',
    'red',
    'rebeccapurple',
  ]) {
    assert.equal(clr(ok), ok, `${ok} should survive`);
  }
});

test('clr refuses anything that could fetch or inject, falling back to dark', () => {
  for (const bad of [
    'url(http://evil.example/a.png)',
    'red; background-image: url(http://evil.example/b.png)',
    'image-set("http://evil.example/c.png" 1x)',
    '#fff;}body{display:none',
    'var(--x)',
    'expression(alert(1))',
  ]) {
    assert.equal(clr(bad), '#1C1C1E', `${bad} should not reach a stylesheet`);
  }
});

/* ── an embedded panel is granted only what a panel needs ─────────────────── */

test('safeAllow keeps presentation features', () => {
  assert.equal(safeAllow('autoplay; fullscreen'), 'autoplay; fullscreen');
  assert.equal(safeAllow('picture-in-picture'), 'picture-in-picture');
});

test('safeAllow drops the capability features whatever the config asks for', () => {
  assert.equal(safeAllow('camera; microphone; geolocation'), 'fullscreen');
  assert.equal(safeAllow('autoplay; camera'), 'autoplay');
  assert.equal(safeAllow("camera 'self'; fullscreen"), 'fullscreen');
  assert.equal(safeAllow('display-capture; usb; serial; midi; payment'), 'fullscreen');
});

test('safeAllow falls back to fullscreen when nothing usable is asked for', () => {
  assert.equal(safeAllow(''), 'fullscreen');
  assert.equal(safeAllow(null), 'fullscreen');
  assert.equal(safeAllow(undefined), 'fullscreen');
});

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(uiRoot, f), 'utf8');

/* ── A card can never clip the widget it holds ────────────────────────────── */

/* Desktop widget heights are fixed while their widths follow the grid, so a
   card's aspect drifts from the widget's design aspect. Cover cropped the
   difference and the card clipped what it cropped: 5px off a medium widget at
   1440px. Contain is identical wherever the aspects match. */
test('the widget is contained by its card, not cropped to it', () => {
  const src = read('js/utils.js');
  const fit = src.slice(src.indexOf('const fit = () =>'), src.indexOf('ifr.style.opacity'));
  assert.match(fit, /Math\.min\(w \/ dw, h \/ dh\)/, 'cover lets a card clip its own widget');
  assert.doesNotMatch(fit, /Math\.max\(w \/ dw, h \/ dh\)/);
});

test('a drifting aspect letterboxes instead of clipping', () => {
  const scale = (w, h, dw, dh) => Math.min(w / dw, h / dh);
  /* The measured desktop case: a medium card at 1440px. */
  const s = scale(330, 150, 360, 170);
  assert.ok(170 * s <= 150 + 1, `the widget renders ${Math.round(170 * s)} tall in a 150 card`);
  /* A matched aspect still fills the card exactly. */
  assert.equal(scale(340, 170, 360, 170) * 360, 340);
});

/* ── A tooltip only where the label is cut ────────────────────────────────── */

/* Tile labels are one line and ellipsise. The anchor's accessible name carries
   the full text either way, so this is for a pointer; on the live instance 3 of
   13 labels truncated and none could be read in full. */

test('a truncated label gets a title and an untruncated one does not', async () => {
  const { titleWhenTruncated } = await import('../js/utils.js');
  const make = (text, scrollWidth, clientWidth, tile) => ({
    textContent: text,
    scrollWidth,
    clientWidth,
    closest: () => tile,
  });
  const cut = { title: '', removeAttribute() {} };
  const whole = { title: '', removeAttribute() {} };
  const labels = [make('Backup and Storage', 180, 72, cut), make('Gitea', 40, 72, whole)];
  titleWhenTruncated(/** @type {any} */ ({ querySelectorAll: () => labels }));
  assert.equal(cut.title, 'Backup and Storage');
  assert.equal(whole.title, '', 'a tooltip on every tile is noise');
});

/* Widths change with the layout, so a title set at one size must clear at
   another. */
test('a title this set is removed once the label fits', async () => {
  const { titleWhenTruncated } = await import('../js/utils.js');
  const removed = [];
  const tile = {
    title: 'Backup and Storage',
    removeAttribute(name) {
      removed.push(name);
      this.title = '';
    },
  };
  const label = { textContent: 'Backup and Storage', scrollWidth: 40, clientWidth: 72, closest: () => tile };
  titleWhenTruncated(/** @type {any} */ ({ querySelectorAll: () => [label] }));
  assert.deepEqual(removed, ['title']);
});

/* A title someone else set, such as the one a hidden-label tile carries, is not
   this pass's to clear. */
test('a title it did not set is left alone', async () => {
  const { titleWhenTruncated } = await import('../js/utils.js');
  const tile = { title: 'Something else', removeAttribute: () => assert.fail('removed a title it did not set') };
  const label = { textContent: 'Gitea', scrollWidth: 40, clientWidth: 72, closest: () => tile };
  titleWhenTruncated(/** @type {any} */ ({ querySelectorAll: () => [label] }));
  assert.equal(tile.title, 'Something else');
});

test('the layout runs the pass when it tones the labels', () => {
  const dash = read('js/dashboard.js');
  const retone = dash.slice(dash.indexOf('function retone()'), dash.indexOf('function retone()') + 320);
  assert.match(retone, /titleWhenTruncated\(\)/, 'nothing re-runs it on a rebuild or a resize');
});
