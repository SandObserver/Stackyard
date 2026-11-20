/* A page change is announced. A control that can be reached and operated, whose
   effect is never spoken, is worse than one that cannot be reached at all.

   Health changes are deliberately left out. They are polled rather than
   user-initiated, so announcing them talks over whatever someone is doing
   whenever a service flaps. A live region says what the user did, not
   everything that changes. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, bootDashboard } from './dashboard-page.mjs';
import { fire } from './fake-dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');

const apps = Array.from({ length: 40 }, (_, i) => app(`a${i}`));
const page = await bootDashboard({
  config: { items: [...apps, app('d', { dock: true })], settings: { language: 'en' } },
  storage: { dash_page: '1' },
});
const doc = page.dom.document;
const live = () => doc.getElementById('page-live').textContent;
const total = () => page.dash.totalPages;
const said = n => `Page ${n} of ${total()}`;
const key = k => fire(doc, 'keydown', { key: k });
const dot = i => fire(doc.querySelectorAll('#dots .dot')[i], 'click', { bubbles: false });

/* ── the region ───────────────────────────────────────────────────────────── */

test('the dashboard has a live region for page changes', () => {
  const el = /<div id="page-live"[^>]*>/.exec(html);
  assert.ok(el, 'without one there is nothing for a screen reader to read');
  assert.match(el[0], /aria-live="polite"/, 'assertive would interrupt what the user is doing');
  assert.match(el[0], /aria-atomic="true"/, 'so the whole message is read, not the changed part');
});

/* Announced, not shown: the page number is already visible in the dots. */
test('the region is available to a screen reader but not on screen', () => {
  assert.match(/<div id="page-live"[^>]*>/.exec(html)[0], /class="visually-hidden"/);
  assert.doesNotMatch(
    /<div id="page-live"[^>]*>/.exec(html)[0],
    /aria-hidden/,
    'aria-hidden would make the region useless',
  );
});

test('visually-hidden keeps the element rendered', () => {
  /* display:none or visibility:hidden would remove it from the accessibility
     tree, so nothing would be announced. */
  const css = read('css/dashboard.css');
  const block = css.slice(css.indexOf('.visually-hidden {'), css.indexOf('}', css.indexOf('.visually-hidden {')));
  assert.doesNotMatch(block, /display\s*:\s*none/);
  assert.doesNotMatch(block, /visibility\s*:\s*hidden/);
  assert.match(block, /position\s*:\s*absolute/);
});

/* ── what gets announced ──────────────────────────────────────────────────── */

/* The page restored on load was not chosen by the user, so it is not spoken.
   Neither is the health poll the boot runs. */
test('restoring the page on load announces nothing', () => {
  assert.ok(total() >= 3, `only ${total()} pages`);
  assert.equal(page.dash.pg, 1, 'the stored page was not restored');
  assert.equal(live(), '');
});

test('a dot announces the page it turns to', () => {
  dot(2);
  assert.equal(page.dash.pg, 2);
  assert.equal(live(), said(3));
});

test('the arrow keys announce through the same path', () => {
  key('ArrowLeft');
  assert.equal(live(), said(2));
  key('ArrowRight');
  assert.equal(live(), said(3));
});

/* Repeating the same page would otherwise announce it again on every click. */
test('nothing is announced when the page did not change', () => {
  doc.getElementById('page-live').textContent = '';
  dot(2);
  assert.equal(live(), '');
});

test('a swipe pages through the same path', () => {
  assert.ok(page.dash.CB.homeSwipe, 'the swipe pager is not handed to the phone layout');
  assert.match(read('js/ui.js'), /swipe: \(\) => CB\(\)\.homeSwipe/);
});

test('the announcement is translated', () => {
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    assert.ok(cat.home?.pageAnnounce, `${file} is missing home.pageAnnounce`);
    assert.match(cat.home.pageAnnounce, /\{page\}/, `${file} drops {page}`);
    assert.match(cat.home.pageAnnounce, /\{total\}/, `${file} drops {total}`);
  }
});

test('a missing region does not break paging', () => {
  doc.getElementById('page-live').remove();
  key('ArrowLeft');
  assert.equal(page.dash.pg, 1);
});

/* Recomposing a badge into the tile name needs the tile's own name, or the
   badge text would accumulate. The paint itself is in dashboard-badges.test.mjs. */
test('every desktop tile records its own name', () => {
  const tiles = doc.querySelectorAll('#pages .icon, #dock .di');
  assert.equal(tiles.length, 41);
  for (const a of tiles) assert.equal(a.dataset.tileName, a.getAttribute('aria-label').split(', ')[0]);
  page.stop();
});

/* ── the hidden dots ──────────────────────────────────────────────────────── */

/* Mobile shows its own pill dots and hides the desktop container, so nothing
   builds dots into it. */
test('mobile no longer builds dots into a hidden container', () => {
  const ui = read('js/ui.js');
  assert.doesNotMatch(ui, /const de = \[\]/, 'unreachable markup that still had to be kept in step');
  /* Hidden and emptied, in that order. Which call empties it is the
     innerHTML ratchet's business, not this test's. */
  assert.match(
    ui,
    /dw\.style\.cssText\s*=\s*'display:none';\s*dw\.(?:replaceChildren\(\)|innerHTML\s*=\s*'')/,
    'the container is still cleared',
  );
});

/* ── W-12: the badge belongs to its tile's name ───────────────────────────── */

test('every phone tile records its own name', () => {
  const ui = read('js/ui.js');
  const labelled = ui.match(/\ba\.setAttribute\('aria-label', [^)]+\);\n\s*(?:a\.dataset\.tileName = )?/g) || [];
  assert.ok(labelled.length >= 2, 'the scan found no tiles');
  const unnamed = labelled.filter(m => !m.endsWith('a.dataset.tileName = '));
  assert.deepEqual(unnamed, [], 'a tile is labelled without recording its name');
});

/* Two, both user-initiated: the page change and the search results. A badge is
   neither, which is why it must not add a third. */
test('the declared live regions are only the two intended ones', () => {
  const ids = [...html.matchAll(/<[^>]*id="([^"]+)"[^>]*aria-live=/g)].map(m => m[1]).sort();
  assert.deepEqual(ids, ['page-live', 'sres-live']);
});

/* The heading must sit inside a landmark. */
test('the heading is inside a landmark', () => {
  assert.match(read('index.html'), /<header[^>]*>\s*<h1>/, 'the h1 is not in a landmark');
});

test('every Fetch and Test result line in Settings is a status region', () => {
  const sources = ['js/admin-app-form.js', 'js/widget-config-form.js'].map(read).join('\n');
  const markup = sources.match(/<span[^>]*class="row-status"[^>]*>/g) || [];
  for (const tag of markup) assert.match(tag, /role="status"/, tag);
  const built = sources.split("const status = document.createElement('span');").slice(1);
  assert.ok(markup.length + built.length >= 4);
  for (const after of built)
    assert.match(after, /^\s*status\.className = 'row-status';\s*status\.setAttribute\('role', 'status'\);/);
});
