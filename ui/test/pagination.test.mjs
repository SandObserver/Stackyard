/* The page dots must be real buttons. A div with a click handler leaves a
   keyboard user stuck on page one, and role="button" with a tabindex means
   reimplementing the key handling by hand.

   The dots are built in JavaScript, so these read the source. */

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

/* One helper for both call sites. Two copies leave one of them missed. */
test('both places that build dots use the one helper', () => {
  const calls = dashboard.match(/mkDot\(/g) || [];
  assert.ok(calls.length >= 3, `expected the definition and two call sites, found ${calls.length}`);
  assert.doesNotMatch(dashboard, /const d = mk\('div'\); d\.className = 'dot'/, 'a call site still builds its own div');
});

/* Paging updates the dots in place, so the attribute has to be updated too, or
   a screen reader keeps announcing the page the dashboard loaded on. */
test('changing page moves aria-current with the class', () => {
  const upd = dashboard.slice(dashboard.indexOf("(dotEls ?? document.querySelectorAll('.dot'))"));
  const block = upd.slice(0, upd.indexOf('\n}'));
  assert.match(block, /classList\.toggle\('on', i === pg\)/);
  assert.match(block, /setAttribute\('aria-current', 'true'\)/);
  assert.match(block, /removeAttribute\('aria-current'\)/);
});

test('the dots are a named landmark', () => {
  const html = read('index.html');
  const dots = /<nav id="dots"[^>]*>/.exec(html);
  assert.ok(dots, 'the dots container is missing, or is no longer a landmark');
  assert.match(dots[0], /aria-label="[^"]+"/, 'otherwise it is a row of buttons with no context');
  assert.match(dots[0], /data-i18n-al="home\.pagination"/, 'and the name must be translated');
});

/* A button carries padding and platform styling a div does not, so the
   appearance would change without these. The border is not reset: an outline is
   how an inactive dot is told from the current one. */
test('the button styling is reset so the dots look unchanged', () => {
  const css = read('css/dashboard.css');
  const block = css.slice(css.indexOf('.dot {'), css.indexOf('}', css.indexOf('.dot {')));
  for (const prop of ['padding:0', 'appearance:none', 'box-sizing:border-box']) {
    assert.ok(block.includes(prop), `.dot does not reset ${prop}`);
  }
});

/* Colour alone cannot carry the state: the tint sits over a wallpaper the
   project does not control, and under forced colors both dots are painted the
   same. */
test('the current page differs from the others by shape, not only by fill', () => {
  const css = read('css/dashboard.css');
  const dot = css.slice(css.indexOf('.dot {'), css.indexOf('}', css.indexOf('.dot {')));
  assert.match(dot, /background:transparent/, 'an inactive dot is filled, so only its colour differs');
  assert.match(dot, /border:[\d.]+px solid/, 'an inactive dot has no outline');
  const on = css.slice(css.indexOf('.dot.on {'), css.indexOf('}', css.indexOf('.dot.on {')));
  assert.match(on, /background:var\(--dots-ink/, 'the current dot is not filled');
});

/* The bar and the dots are tinted over the wallpaper, so they need the reading
   the icon labels already get. */
test('the indicator is enrolled in the wallpaper sampling', () => {
  assert.match(read('js/label-contrast.js'), /LABEL_SELECTOR = '[^']*#dots/, 'the indicator is not sampled');
  assert.match(read('css/dashboard.css'), /#dots\[data-tone="dark"\]/, 'nothing responds to the sampled tone');
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

/* ── The pager reaches every input on both layouts ────────────────────────── */

/* The phone layout is what a narrow window gets. Without the key and mouse
   handlers a second page is visible in the dots and unreachable without a
   touchscreen. */

const keydown = dashboard.slice(
  dashboard.indexOf("document.addEventListener('keydown'"),
  dashboard.indexOf('let _dMx'),
);
const mouseup = dashboard.slice(
  dashboard.indexOf("document.addEventListener('mouseup'"),
  dashboard.indexOf('let _dTx'),
);

test('arrow keys page on the phone layout too', () => {
  assert.match(keydown, /ArrowRight/);
  assert.doesNotMatch(keydown, /if \(MOB\) return/, 'the phone layout has no keyboard pager of its own');
});

test('a mouse drag pages on the phone layout too', () => {
  assert.match(mouseup, /goTo\(/);
  assert.doesNotMatch(mouseup, /if \(MOB\b/, 'a narrow window is driven by a mouse');
});

/* One swipe must not advance two pages. */
test('the mouse pager ignores the compatibility event a touch produces', () => {
  assert.match(mouseup, /_lastTouch/);
  assert.match(dashboard, /const COMPAT_POINTER_MS = \d+/);
  for (const handler of ['touchstart', 'touchend']) {
    const block = dashboard.slice(
      dashboard.indexOf(`'${handler}'`),
      dashboard.indexOf('{ passive: true }', dashboard.indexOf(`'${handler}'`)),
    );
    assert.match(block, /_lastTouch = Date\.now\(\)/, `${handler} does not record the touch`);
  }
});

/* The mobile folder overlay covers the whole page, and the key handler is on
   the document. */
test('an open folder overlay stops the keyboard pager', () => {
  assert.match(keydown, /folder-overlay/);
});

test('the touch pager still belongs to one layout only', () => {
  const at = dashboard.indexOf("'touchend'");
  const touchend = dashboard.slice(at, dashboard.indexOf('{ passive: true }', at));
  assert.match(touchend, /if \(MOB\) return/, 'both swipe handlers would advance two pages for one gesture');
});

/* A strip is laid out in the page's direction, so the next page is on the left
   in one direction and on the right in the other. translateX has no logical
   form. A fixed sign moves page two further off a Persian dashboard instead of
   onto it, leaving every page after the first unreachable. */
test('both page strips move by the direction of the page', () => {
  assert.match(
    dashboard,
    /translateX\(\$\{-pageDir\(\) \* pg \* 100\}vw\)/,
    'the dashboard strip is fixed to one direction',
  );
  assert.match(
    read('js/ui.js'),
    /translateX\(\$\{-pageDir\(\) \* curPage \* pageW\}px\)/,
    'the folder strip is fixed to one direction',
  );
});

/* The arrows and a drag name a side of the screen, not a page number, so they
   mirror with the layout. */
test('the arrow keys and every drag mirror too', () => {
  assert.match(dashboard, /ArrowRight'\) goTo\(pg \+ pageDir\(\)\)/);
  assert.match(dashboard, /ArrowLeft'\) goTo\(pg - pageDir\(\)\)/);
  for (const src of [dashboard, read('js/ui.js')]) {
    for (const m of src.matchAll(/\(dx < 0 \? 1 : -1\)(.{0,12})/g)) {
      assert.match(m[1], /^ \* pageDir\(\)/, 'a drag still assumes one direction');
    }
  }
});

/* One reading of the document, so a right-to-left page cannot take a
   left-to-right number from a stale copy. */
test('the direction is read from the document, not stored', () => {
  const utils = read('js/utils.js');
  assert.match(
    utils,
    /export const pageDir = \(\) => \(?getComputedStyle\(document\.documentElement\)\.direction === 'rtl' \? -1 : 1\)?;/,
  );
});
