/* One picker serves every list in the admin. These assertions are about that
   being true, and about the keyboard contract the old hand-wired dropdowns did
   not honour: they opened, and then nothing a keyboard user pressed did
   anything. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const src = read('js/listbox.js');
const html = read('admin/index.html');
const css = read('css/admin.css');
const jsFiles = fs
  .readdirSync(path.join(root, 'js'))
  .filter(f => f.endsWith('.js') && f !== 'listbox.js')
  .map(f => [f, read(path.join('js', f))]);

test('the keyboard contract is implemented', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Escape', 'Enter', 'Tab']) {
    assert.match(src, new RegExp(`'${key}'`), `${key} is not handled`);
  }
  assert.match(src, /nextActiveIndex\(e\.key, active, o\.length\)/, 'Home and End come from the shared helper');
  assert.match(src, /function typeahead\(/, 'type-ahead is how a native select is navigated');
});

test('the open state is announced', () => {
  assert.match(src, /btn\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(src, /btn\.setAttribute\('aria-expanded', 'false'\)/);
});

test('Escape returns focus to the trigger', () => {
  assert.match(src, /case 'Escape':[\s\S]{0,80}close\(\{ focusBtn: true \}\)/);
});

/* The list is last on <body>. The browser's Tab from there leaves the form. */
test('Tab moves on from the trigger, not from the list', () => {
  assert.match(src, /case 'Tab':\s*e\.preventDefault\(\);\s*close\(\);\s*focusBeside\(btn, e\.shiftKey \? -1 : 1\)/);
});

/* The menu is fixed and the settings pane scrolls by itself. */
test('scrolling anything but the list closes the menu', () => {
  assert.match(
    src,
    /'scroll',\s*e => \{\s*if \(!list\.contains\([^)]*\(e\.target\)\)\) close\(\);\s*\},\s*\{ capture: true, signal: outside\.signal \}/,
  );
});

/* Settings load after the pickers are built. A label written from outside the
   picker is lost, and the saved value reads as the default. */
test('saved settings reach the pickers through the picker', () => {
  const settings = read('js/admin-settings.js');
  assert.doesNotMatch(settings, /-btn'\)|childNodes\[0\]/, 'loadSettings writes a picker button directly again');
  assert.match(read('js/admin.js'), /loadSettings\(c\);\s*syncPickerLabels\(\);/);
});

/* A list that is only pointed at cannot be reached by the keyboard. */
test('options are focusable and the focus roves', () => {
  assert.match(src, /li\.tabIndex = n === active \? 0 : -1/);
  assert.match(src, /o\[active\]\.focus\(\)/);
});

/* The settings panel scrolls and clips, and the phone tab bar outranks anything
   the panel can draw. A list positioned inside that panel is cut off at its edge
   and covered by the bar. The top layer is outside both. */
test('the list is mounted on the page, above the tab bar', () => {
  assert.match(src, /document\.body\.appendChild\(list\)/, 'left in the row it is clipped by the scrolling panel');
  assert.match(css, /\.row-dd-list\{position:fixed;[^}]*z-index:9000/, 'the phone tab bar sits at 8000');
});

/* iOS repaints neither the strip of canvas its collapsing toolbar exposes nor a
   frame drawn before placement. Both were traced to the top layer; the page
   geometry is identical open and closed and desktop Safari is clean. */
test('the menu does not use the top layer', () => {
  for (const gone of [/setAttribute\('popover'/, /\.showPopover\(/, /\.hidePopover\(/]) {
    assert.doesNotMatch(src, gone, `${gone} is back; recheck iOS before allowing it`);
  }
});

/* The toolbar collapse resizes the visual viewport a frame after the menu
   opens, leaving it measured against the old one. */
test('the menu is measured against the visible area and re-placed when it changes', () => {
  assert.match(src, /visualViewport\?\.height \?\? window\.innerHeight/);
  assert.match(src, /visualViewport\?\.addEventListener\('resize', place/);
});

/* Dismissal belongs to the browser now. Nothing here may listen on the document:
   that is what used to strand a listener per discarded row. */
/* The listener is scoped to the open state. The admin rebuilds its forms, and a
   listener that outlives the row holds the detached subtree it closes over. */
test('the outside-press listener is scoped to the open state', () => {
  assert.match(src, /outside = new AbortController\(\)/);
  assert.match(src, /\{ signal: outside\.signal \}/);
  assert.match(src, /outside\?\.abort\(\)/);
});

/* Anchor positioning is above the support floor, so the placement is by hand. */
test('the anchored list is placed inside the viewport', () => {
  assert.match(src, /if \(top \+ pr\.height > vh - 8\)/, 'it must flip up when there is no room below');
  assert.match(src, /vw - pr\.width - 8/, 'it must not run off the side');
  assert.match(src, /getAttribute\('dir'\)/, 'it aligns to the trailing edge, which flips in an RTL language');
});

/* Twelve entries are taller than a phone screen. Every list scrolls, not just
   the multi-select one that happened to have a cap. */
test('every list has a height cap it can scroll', () => {
  assert.match(css, /\.row-dd-list\{[^}]*max-height:min\(360px,60vh\)/);
  assert.match(css, /\.row-dd-list\{[^}]*overflow-y:auto/);
});

test('a group heading is drawn but not selectable', () => {
  assert.match(src, /class="row-dd-group" role="presentation"/);
  assert.match(src, /o\.group == null/, 'a heading must not count as a value');
});

/* The hover effect keys off this markup. A second shape would need a second
   entry in the effect's list, which is how the old split started. */
test('it renders the markup the hover effect already targets', () => {
  assert.match(src, /class="row-dd-list/);
  assert.match(src, /<li role="option"/);
  assert.match(read('js/fluid-hover.js'), /container: '\.row-dd-list', item: 'li\[role="option"\]'/);
});

test('no module builds a picker of its own any more', () => {
  const offenders = [];
  for (const [name, s] of jsFiles) {
    if (/<select|createElement\('select'\)/.test(s)) offenders.push(`${name}: builds a native select`);
    if (/class="row-dd"/.test(s)) offenders.push(`${name}: hand-writes the dropdown markup`);
  }
  assert.deepEqual(offenders, [], `every list must come from listbox.js:\n  ${offenders.join('\n  ')}`);
});

test('the markup declares mount points, not dropdowns', () => {
  assert.doesNotMatch(html, /class="row-dd"/, 'a hand-written dropdown is back in the page');
  assert.match(html, /<div id="[a-z-]+-slot"><\/div>/, 'the pickers need empty mount points to fill');
});

test('the superseded helper is gone', () => {
  assert.doesNotMatch(read('js/admin-shared.js'), /wireChecklist/, 'two pickers again');
});

/* A segmented control's labels do not wrap, so four long provider names are
   wider than a phone and pushed the whole form off screen. It cannot shrink, so
   when it does not fit it becomes the picker. One fallback, not a third
   pattern. */
test('a segmented control that does not fit becomes the picker', () => {
  const form = read('js/widget-config-form.js');
  assert.match(form, /new ResizeObserver\(/, 'the fit has to be measured, not guessed from a breakpoint');
  assert.match(form, /ro\.disconnect\(\);\s*\n\s*const box = createListbox\(/);
  assert.match(form, /group\.replaceWith\(box\.el\)/);
});

/* A pop-up button shows a menu anchored to it. A sheet is a different control
   for a different job, and a menu that turned into one on a phone was wrong. */
test('the menu is anchored at every size, never a sheet', () => {
  for (const gone of ['dd-sheet', 'dd-title', 'dd-grab', 'isSheet']) {
    assert.doesNotMatch(src, new RegExp(gone), `${gone} is back`);
    assert.doesNotMatch(css, new RegExp(gone), `${gone} is back in the stylesheet`);
  }
  assert.doesNotMatch(src, /matchMedia/, 'the shape must not depend on the pointer');
});

/* The menu is the same menu on a phone. Only the target grows. */
test('a touch pointer gets a full tap target', () => {
  assert.match(css, /\.row-dd-list li\[role="option"\] \{ min-height:44px; \}/);
});

/* Showing a popover forces a style pass, and a frame drawn before place() lands
   is a flash at the user-agent's default spot. */
test('the menu starts off screen until it is placed', () => {
  assert.match(css, /\.row-dd-list\{position:fixed;inset:auto;margin:0;top:-9999px/);
  assert.doesNotMatch(css, /\.row-dd-list\{[^}]*left:/, 'a physical side does not flip for Persian');
});

/* The exposed strip is the page canvas. A different value there is a band. */
test('the canvas matches the layer that paints the ground', () => {
  assert.match(css, /html\{background:var\(--bg-color,var\(--bg-base\)\)\}/);
});

/* The lists live on <body> while their rows do not, and the admin rebuilds a
   form by replacing its children. Without a sweep every rebuild strands one
   list per picker on the page for the rest of the session. */
test('a rebuilt form does not strand its old menus', () => {
  assert.match(src, /const mounted = new Set\(\)/);
  assert.match(src, /function pruneDetached\(\)/);
  assert.match(src, /if \(!m\.placed \|\| m\.dd\.isConnected\) continue;/);
  assert.match(src, /m\.list\.remove\(\)/);
  const fn = /export function createListbox\([\s\S]*?pruneDetached\(\);/.exec(src);
  assert.ok(fn, 'the sweep must run when a picker is built');
});

/* The list is not a descendant of its button, so nothing associates the two
   without this. */
test('the button names the list it controls', () => {
  assert.match(src, /aria-controls="\$\{listId\}"/);
  assert.match(src, /<ul class="row-dd-list\$\{multiple \? ' checklist' : ''\}" id="\$\{listId\}"/);
});

/* Fetch-populated fields (a Beszel system, a weather city) carry no default and
   are required. A native select landed on its first option; leaving it blank
   would block the save until the user picked one as well. */
test('a required select lands on its first option', () => {
  const form = read('js/widget-config-form.js');
  assert.match(form, /if \(!field\.optional && !chosen && opts\.length\) chosen = String\(opts\[0\]\.value\)/);
  assert.match(
    form,
    /const paint = \(\) => \{\s*\n\s*normalise\(\);/,
    'fetched options arrive after the field is built',
  );
});
