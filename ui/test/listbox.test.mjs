/* One picker serves every list in the admin. These assertions are about that
   being true, and about the keyboard contract the old hand-wired dropdowns did
   not honour: they opened, and then nothing a keyboard user pressed did
   anything. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { fire, installDom } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('admin/index.html');
const css = read('css/admin.css');
const jsFiles = fs
  .readdirSync(path.join(root, 'js'))
  .filter(f => f.endsWith('.js') && f !== 'listbox.js')
  .map(f => [f, read(path.join('js', f))]);

const dom = installDom({
  markup: '<button id="before">Before</button><div id="host"></div><button id="after">After</button>',
});
const { document } = dom;
globalThis.visualViewport = undefined;
for (const id of ['before', 'after']) document.getElementById(id).tabIndex = 0;

/* A browser element has classList.replace. */
const createElement = document.createElement.bind(document);
document.createElement = tag => {
  const node = createElement(tag);
  node.classList.replace = (from, to) => {
    if (!node.classList.contains(from)) return false;
    node.classList.remove(from);
    node.classList.add(to);
    return true;
  };
  return node;
};

/* A browser removes a listener whose signal aborts. */
const addListener = document.addEventListener.bind(document);
document.addEventListener = (type, fn, opts) => {
  addListener(type, fn, opts);
  opts?.signal?.addEventListener('abort', () => document.removeEventListener(type, fn, opts));
};

const { createListbox } = await import('../js/listbox.js');

const OPTIONS = [
  { value: 'en', label: 'English', lang: 'en' },
  { group: 'More' },
  { value: 'fa', label: 'فارسی', lang: 'fa' },
  { value: 'de', label: 'Deutsch', lang: 'de' },
];

/** A picker attached to the page. @param {Record<string, any>} [opts] */
function picker(opts = {}) {
  const changes = [];
  const box = createListbox({
    options: OPTIONS,
    value: 'en',
    label: 'Language',
    onChange: v => changes.push(v),
    ...opts,
  });
  document.getElementById('host').replaceChildren(box.el);
  return Object.assign(box, { changes });
}

/** Give the button and the list a laid-out size. */
function placeBox(box, { button, list }) {
  const r = { ...button, right: button.left + button.width, bottom: button.top + button.height };
  box.button.getBoundingClientRect = () => r;
  Object.defineProperties(box.list, { offsetWidth: { value: list.width }, offsetHeight: { value: list.height } });
}

const key = (target, k, more = {}) => fire(target, 'keydown', { key: k, ...more });
const options = box => box.list.querySelectorAll('li[role="option"]');

test('the keyboard opens the list on the chosen option and moves through it', () => {
  const box = picker({ value: 'fa' });
  key(box.button, 'ArrowDown');
  assert.equal(box.button.getAttribute('aria-expanded'), 'true');
  assert.equal(box.list.hidden, false);
  assert.equal(document.activeElement, options(box)[1], 'the chosen option takes focus');
  assert.deepEqual(
    options(box).map(li => li.tabIndex),
    [-1, 0, -1],
    'the focus does not rove',
  );
  key(box.list, 'ArrowDown');
  assert.equal(document.activeElement.textContent, 'Deutsch');
  key(box.list, 'Home');
  assert.equal(document.activeElement.textContent, 'English', 'the heading is skipped');
  key(box.list, 'End');
  assert.equal(document.activeElement.textContent, 'Deutsch');
  key(box.list, 'e');
  assert.equal(document.activeElement.textContent, 'English', 'type-ahead finds nothing');
  key(box.list, 'Enter');
  assert.deepEqual(box.changes, ['en']);
  assert.equal(box.button.getAttribute('aria-expanded'), 'false');
  assert.equal(box.list.hidden, true, 'a keyboard pick animates the close');
  assert.equal(document.activeElement, box.button);
});

test('Escape closes at once and returns focus to the trigger', () => {
  const box = picker();
  key(box.button, 'Enter');
  key(box.list, 'Escape');
  assert.equal(box.list.hidden, true);
  assert.equal(box.button.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, box.button);
  assert.deepEqual(box.changes, []);
});

/* The list is last on <body>. The browser's Tab from there leaves the form. */
test('Tab moves on from the trigger, not from the list', () => {
  const box = picker();
  key(box.button, 'ArrowDown');
  key(box.list, 'Tab');
  assert.equal(box.list.hidden, true);
  assert.equal(document.activeElement.id, 'after');
  key(box.button, 'ArrowDown');
  key(box.list, 'Tab', { shiftKey: true });
  assert.equal(document.activeElement.id, 'before');
});

test('a group heading is drawn but not selectable', () => {
  const box = picker();
  const heading = box.list.querySelector('.row-dd-group');
  assert.equal(heading.getAttribute('role'), 'presentation');
  assert.equal(heading.textContent, 'More');
  heading.click();
  assert.deepEqual(box.changes, []);
  assert.equal(picker({ multiple: true, value: ['en', 'de'] }).getValue().length, 2);
});

/* The list is not a descendant of its button, so nothing associates the two
   without this. */
test('the button names the list it controls', () => {
  const box = picker({ id: 'lang' });
  assert.equal(box.button.getAttribute('aria-controls'), 'lang-list');
  assert.equal(box.list.id, 'lang-list');
  const plain = picker();
  assert.ok(plain.list.id);
  assert.equal(plain.button.getAttribute('aria-controls'), plain.list.id);
});

/* WCAG 2.2 SC 3.1.2: each language is named in its own script. */
test('the language picker marks each language name with its language', () => {
  const box = picker({ value: 'fa' });
  assert.deepEqual(
    options(box).map(li => li.lang),
    ['en', 'fa', 'de'],
    'the option does not carry its language',
  );
  const text = box.button.querySelector('.row-dd-text');
  assert.equal(text.lang, 'fa', 'the button does not carry it');
  box.setValue(['en', 'de']);
  box.setValue('');
  assert.equal(text.hasAttribute('lang'), false);
});

test('an empty value picks the empty option only where one exists', () => {
  const withEmpty = [{ value: '', label: 'None' }, ...OPTIONS];
  assert.equal(picker({ value: '' }).getValue(), undefined);
  assert.equal(picker({ options: withEmpty, value: '' }).getValue(), '');
  const box = picker();
  box.setValue('');
  assert.equal(box.getValue(), undefined, 'setValue');
  box.setOptions(withEmpty, '');
  assert.equal(box.getValue(), '', 'setOptions');
  box.setOptions(OPTIONS, '');
  assert.equal(box.getValue(), undefined, 'setOptions');
});

/* The menu is fixed and the settings pane scrolls by itself. */
test('a scroll that moves the button closes the menu, and one that does not leaves it', () => {
  const box = picker();
  placeBox(box, { button: { top: 100, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
  key(box.button, 'ArrowDown');
  fire(document.body, 'scroll', { bubbles: false });
  assert.equal(box.list.hidden, false, 'a scroll that did not move the button closed it');
  placeBox(box, { button: { top: 60, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
  fire(document.body, 'scroll', { bubbles: false });
  assert.notEqual(box.button.getAttribute('aria-expanded'), 'true');
});

test('the outside-press and scroll listeners last only while the menu is open', () => {
  const before = ['click', 'scroll'].map(t => document.listenersOf(t).length);
  const box = picker();
  key(box.button, 'ArrowDown');
  assert.ok(document.listenersOf('click').length > before[0]);
  key(box.list, 'Escape');
  assert.deepEqual(
    ['click', 'scroll'].map(t => document.listenersOf(t).length),
    before,
  );
});

test('the anchored list flips up and stays inside the viewport, aligned to the trailing edge', () => {
  const below = picker();
  placeBox(below, { button: { top: 100, left: 20, width: 120, height: 36 }, list: { width: 200, height: 120 } });
  key(below.button, 'ArrowDown');
  assert.deepEqual([below.list.style.top, below.list.style.left], ['140px', '8px'], 'it runs off the side');
  key(below.list, 'Escape');
  const above = picker();
  placeBox(above, { button: { top: 700, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
  key(above.button, 'ArrowDown');
  assert.equal(above.list.style.top, '576px', 'it must flip up when there is no room below');
  key(above.list, 'Escape');
  document.documentElement.setAttribute('dir', 'rtl');
  try {
    const rtl = picker();
    placeBox(rtl, { button: { top: 100, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
    key(rtl.button, 'ArrowDown');
    assert.equal(rtl.list.style.left, '600px', 'it does not flip in a right-to-left language');
    key(rtl.list, 'Escape');
  } finally {
    document.documentElement.removeAttribute('dir');
  }
});

/* The toolbar collapse resizes the visual viewport a frame after the menu
   opens, leaving it measured against the old one. */
test('the menu is measured against the visible area and re-placed when it changes', () => {
  const vv = new (class {
    height = 500;
    width = 1280;
    fns = [];
    addEventListener(type, fn, opts) {
      if (type === 'resize') this.fns.push(fn);
      opts?.signal?.addEventListener('abort', () => (this.fns = this.fns.filter(f => f !== fn)));
    }
  })();
  globalThis.visualViewport = vv;
  try {
    const box = picker();
    placeBox(box, { button: { top: 400, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
    key(box.button, 'ArrowDown');
    assert.equal(box.list.style.top, '276px', 'measured against the layout viewport');
    vv.height = 800;
    for (const fn of vv.fns) fn();
    assert.equal(box.list.style.top, '440px', 'not re-placed when the visible area grows');
    key(box.list, 'Escape');
    assert.equal(vv.fns.length, 0);
  } finally {
    globalThis.visualViewport = undefined;
  }
});

/* iOS repaints neither the strip of canvas its collapsing toolbar exposes nor a
   frame drawn before placement. */
test('the menu does not use the top layer', () => {
  const box = picker();
  key(box.button, 'ArrowDown');
  assert.equal(box.list.hasAttribute('popover'), false);
  key(box.list, 'Escape');
});

/* The admin rebuilds a form by replacing its children. */
test('a rebuilt form does not strand its old menus', async () => {
  const old = picker();
  await Promise.resolve();
  document.getElementById('host').replaceChildren();
  assert.equal(old.list.parentElement, document.body);
  picker();
  assert.equal(old.list.parentElement, null, 'the old list is left on the page');
  const fresh = createListbox({ options: OPTIONS, label: 'New' });
  createListbox({ options: OPTIONS, label: 'Next' });
  assert.equal(fresh.list.parentElement, document.body, 'a list not yet attached by its caller was swept');
});

/* Settings load after the pickers are built. A label written from outside the
   picker is lost, and the saved value reads as the default. */
test('saved settings reach the pickers through the picker', () => {
  const settings = read('js/admin-settings.js');
  assert.doesNotMatch(settings, /-btn'\)|childNodes\[0\]/, 'loadSettings writes a picker button directly again');
});

/* The settings panel scrolls and clips, and the phone tab bar outranks anything
   the panel can draw. A list positioned inside that panel is cut off at its edge
   and covered by the bar. The top layer is outside both. */
test('the list is mounted on the page, above the tab bar', () => {
  const box = picker();
  assert.equal(box.list.parentElement, document.body, 'left in the row it is clipped by the scrolling panel');
  assert.ok(!box.el.contains(box.list));
  assert.match(css, /\.row-dd-list\{position:fixed;[^}]*z-index:9000/, 'the phone tab bar sits at 8000');
});

/* Twelve entries are taller than a phone screen. Every list scrolls, not just
   the multi-select one that happened to have a cap. */
test('every list has a height cap it can scroll', () => {
  assert.match(css, /\.row-dd-list\{[^}]*max-height:min\(360px,60dvh\)/);
  assert.match(css, /\.row-dd-list\{[^}]*overflow-y:auto/);
});

/* The hover effect keys off this markup. A second shape would need a second
   entry in the effect's list, which is how the old split started. */
test('it renders the markup the hover effect already targets', () => {
  const box = picker();
  assert.ok(box.list.classList.contains('row-dd-list'));
  assert.equal(box.list.querySelectorAll('li[role="option"]').length, 3);
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
  const media = globalThis.matchMedia;
  globalThis.matchMedia = q => ({ ...media(q), matches: true });
  try {
    const box = picker();
    placeBox(box, { button: { top: 100, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
    box.button.click();
    assert.equal(box.list.style.top, '140px', 'a phone gets something other than the anchored menu');
    for (const gone of ['dd-sheet', 'dd-title', 'dd-grab']) {
      assert.equal(document.querySelector(`.${gone}`), null, `${gone} is back`);
    }
    box.close();
  } finally {
    globalThis.matchMedia = media;
  }
  for (const gone of ['dd-sheet', 'dd-title', 'dd-grab', 'isSheet']) {
    assert.doesNotMatch(css, new RegExp(gone), `${gone} is back in the stylesheet`);
  }
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
  assert.match(css, /html\{background:var\(--bg-color,var\(--bg-base\)\)[;}]/);
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

/* A menu opened from the keyboard shows at once. A pointer open grows out of
   the trigger button and shrinks back into it. */
test('only a pointer open animates, out of the trigger', () => {
  const keyed = picker();
  fire(keyed.button, 'click', { detail: 0 });
  assert.ok(!keyed.list.classList.contains('dd-grow'), 'a keyboard open animates');
  keyed.close();
  const pointed = picker();
  placeBox(pointed, { button: { top: 100, left: 600, width: 120, height: 36 }, list: { width: 200, height: 120 } });
  fire(pointed.button, 'click', { detail: 1 });
  assert.ok(pointed.list.classList.contains('dd-grow'), 'a pointer open does not grow out of the button');
  assert.equal(
    pointed.list.style['--dd-from'],
    'inset(-40px 0px 124px 80px round 18px)',
    'the closed shape is not taken where the list lands',
  );
  fire(pointed.button, 'click', { detail: 1 });
  assert.ok(pointed.list.classList.contains('dd-out'), 'a pointer close does not shrink back');
  assert.equal(pointed.list.hidden, false);
  assert.match(css, /\.row-dd-list\.dd-pre\{clip-path:var\(--dd-from,inset\(0 round 34px\)\);transition:none\}/);
  assert.doesNotMatch(css, /dd-out\{animation/, 'a keyframe cannot be caught mid-way');
  assert.match(
    css,
    /\.row-dd-list\.dd-out\{clip-path:var\(--dd-from,inset\(0 round 34px\)\);[^}]*transition-duration:\.14s/,
  );
});

test('drop-down width limit does not use a percentage of its own wrapper', () => {
  const rule = read('css/admin.css').match(/\.row-dd\{[^}]*\}/)[0];
  assert.doesNotMatch(rule, /max-width:[\d.]+%/);
});
