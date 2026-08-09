/* Regression tests for P9-8: page dots were not controls.

   When a dashboard holds more apps than fit on one screen, the dots at the
   bottom move between pages. They were plain divs with a click handler, and a
   div is not a control: Tab skips it, a screen reader announces nothing, and
   Enter and Space do nothing. Paging worked by pointer only, so a keyboard user
   could not leave page one.

   They are real buttons now. Reaching for role="button" and tabindex instead
   would mean reimplementing by hand what the element already does, and the key
   handling is the part that gets forgotten.

   Built in JavaScript against a live document, so these read the source. The
   behaviour they pin is the shape of what is built rather than what a browser
   does with it, which is the browser's job once it is a button. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dashboard = read('js/dashboard.js');

/* The helper both call sites use. */
const mkDot = dashboard.slice(dashboard.indexOf('function mkDot('), dashboard.indexOf('function buildDesktop('));

test('a dot is a button, not a div', () => {
  assert.match(mkDot, /mk\('button'\)/, 'a div cannot be reached by Tab or operated by Enter');
  assert.doesNotMatch(mkDot, /mk\('div'\)/);
});

/* Inside a form a button defaults to submit; type is set so it never does
   anything but what its handler says. */
test('the button declares its type', () => {
  assert.match(mkDot, /\.type = 'button'/);
});

/* A row of unlabelled buttons tells a screen reader nothing about where each
   one goes. */
test('each dot says which page it goes to', () => {
  assert.match(mkDot, /setAttribute\('aria-label'/);
  assert.match(mkDot, /home\.goToPage/, 'the label must be translated, not hardcoded English');
});

/* The `on` class conveys the current page by appearance alone. */
test('the current page is marked for a screen reader', () => {
  assert.match(mkDot, /setAttribute\('aria-current', 'true'\)/);
});

/* Both call sites had their own copy, and one of them would have been missed. */
test('both places that build dots use the one helper', () => {
  const calls = dashboard.match(/mkDot\(/g) || [];
  assert.ok(calls.length >= 3, `expected the definition and two call sites, found ${calls.length}`);
  assert.doesNotMatch(dashboard, /const d = mk\('div'\); d\.className = 'dot'/, 'a call site still builds its own div');
});

/* Paging updates the dots in place rather than rebuilding them, so the
   attribute has to be updated too, or a screen reader keeps announcing the page
   the dashboard loaded on. */
test('changing page moves aria-current with the class', () => {
  const upd = dashboard.slice(dashboard.indexOf("(dotEls ?? document.querySelectorAll('.dot'))"));
  const block = upd.slice(0, upd.indexOf('\n}'));
  assert.match(block, /classList\.toggle\('on', i === pg\)/);
  assert.match(block, /setAttribute\('aria-current', 'true'\)/);
  assert.match(block, /removeAttribute\('aria-current'\)/);
});

test('the dots are grouped and the group is named', () => {
  const html = read('index.html');
  const dots = /<div id="dots"[^>]*>/.exec(html);
  assert.ok(dots, 'the dots container is missing');
  assert.match(dots[0], /role="group"/, 'otherwise it is a row of buttons with no context');
  assert.match(dots[0], /aria-label="[^"]+"/);
  assert.match(dots[0], /data-i18n-al="home\.pagination"/, 'and the name must be translated');
});

/* A button carries padding, a border and platform styling that a div does not,
   so the appearance would change without these. */
test('the button styling is reset so the dots look unchanged', () => {
  const css = read('css/dashboard.css');
  const block = css.slice(css.indexOf('.dot {'), css.indexOf('}', css.indexOf('.dot {')));
  for (const prop of ['padding:0', 'border:0', 'appearance:none']) {
    assert.ok(block.includes(prop), `.dot does not reset ${prop}`);
  }
});

test('the focus outline still applies to a dot', () => {
  /* Focusable now, so being able to see where focus is matters. */
  assert.match(read('css/dashboard.css'), /\.dot:focus-visible/);
});

test('every locale carries the new strings', () => {
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    assert.ok(cat.home?.goToPage, `${file} is missing home.goToPage`);
    assert.ok(cat.home?.pagination, `${file} is missing home.pagination`);
    assert.match(cat.home.goToPage, /\{page\}/, `${file} drops the {page} placeholder`);
    assert.match(cat.home.goToPage, /\{total\}/, `${file} drops the {total} placeholder`);
  }
});
