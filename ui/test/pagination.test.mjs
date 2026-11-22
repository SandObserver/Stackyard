/* The page dots must be real buttons. A div with a click handler leaves a
   keyboard user stuck on page one, and role="button" with a tabindex means
   reimplementing the key handling by hand. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDocument, fire, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ui = read('js/ui.js');

const dom = installDom({ markup: pageBody('index.html'), location: 'http://nas.local/' });
const doc = dom.document;
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const { createDesktopGrid } = await import('../js/dashboard-grid.js');
const { createBadges } = await import('../js/dashboard-badges.js');
const { wirePageInput } = await import('../js/dashboard-input.js');
const { initUI } = await import('../js/ui.js');
const { pageDir } = await import('../js/utils.js');
const { setScripted } = await import('../js/frame-motion.js');
const { mountScaledWidget } = await import('../js/widget-frame.js');
const popover = await import('../js/badge-popover.js');

const dash = createDashboardState();
dash.items = Array.from({ length: 40 }, (_, i) => ({
  id: `a${i}`,
  type: 'app',
  label: `A${i}`,
  href: 'http://a.local',
}));
const badges = createBadges(dash);
initUI({ items: dash.items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
const pager = createPager(dash);
const turns = [];
const goTo = (n, ...rest) => {
  turns.push([n, ...rest]);
  pager.goTo(n, ...rest);
};
const grid = createDesktopGrid({ dash, badges, goTo });
dash.totalPages = grid.buildDesktop();
wirePageInput({ dash, goTo });
const dotButtons = () => doc.querySelectorAll('#dots .dot');
const strip = doc.getElementById('pages');
const turned = fn => {
  turns.length = 0;
  fn();
  return turns.map(t => t[0]);
};
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
/** Move the clock past the window a touch blocks the mouse for. */
const later = () => {
  skew += 1000;
};
const rtl = on => {
  globalThis.getComputedStyle = () => ({
    direction: on ? 'rtl' : 'ltr',
    transform: 'none',
    getPropertyValue: () => '',
  });
};

test('the desktop build has more than one page to page through', () => {
  assert.ok(dash.totalPages >= 2, `only ${dash.totalPages} page`);
  assert.equal(strip.children.length, dash.totalPages);
});

test('a dot is a button that declares its type', () => {
  assert.equal(dotButtons().length, dash.totalPages);
  for (const d of dotButtons()) {
    assert.ok(d instanceof HTMLButtonElement, 'a div cannot be reached by Tab or operated by Enter');
    assert.equal(d.type, 'button');
  }
});

test('each dot says which page it goes to, in the catalog wording', () => {
  assert.deepEqual(
    dotButtons().map(d => d.getAttribute('aria-label')),
    dotButtons().map(() => 'home.goToPage'),
  );
  assert.equal(doc.getElementById('dots').hidden, false);
});

test('the current page is marked for a screen reader, and moves with the class', () => {
  assert.deepEqual(
    dotButtons().map(d => [d.classList.contains('on'), d.getAttribute('aria-current')]),
    dotButtons().map((_, i) => (i === 0 ? [true, 'true'] : [false, null])),
  );
  assert.deepEqual(
    turned(() => dotButtons()[1].click()),
    [1],
  );
  assert.deepEqual(
    dotButtons().map(d => [d.classList.contains('on'), d.getAttribute('aria-current')]),
    dotButtons().map((_, i) => (i === 1 ? [true, 'true'] : [false, null])),
  );
  pager.goTo(0, false);
});

test('the pager is hidden when there is one page', () => {
  const one = createDashboardState();
  one.items = [dash.items[0]];
  initUI({ items: one.items, S: one.S, CB: one.CB, ...badges, widgetReg: one.widgetReg });
  createDesktopGrid({ dash: one, badges, goTo() {} }).buildDesktop();
  assert.equal(doc.getElementById('dots').hidden, true);
  initUI({ items: dash.items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  dash.totalPages = grid.buildDesktop();
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
  assert.match(read('js/label-contrast.js'), /LABEL_SELECTOR =\s+'[^']*#dots/, 'the indicator is not sampled');
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
const drag = (from, to) => {
  fire(doc.body, 'mousedown', { clientX: from });
  fire(doc.body, 'mousemove', { clientX: to });
  fire(doc.body, 'mouseup', { clientX: to });
};

test('arrow keys page on both layouts', () => {
  for (const mob of [false, true]) {
    dash.mob = mob;
    pager.goTo(0, false);
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowRight' })),
      [1],
    );
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowLeft' })),
      [0],
    );
  }
  dash.mob = false;
});

test('an arrow key on the phone page control turns one page, not two', () => {
  assert.deepEqual(
    turned(() => fire(doc.getElementById('mob-pager'), 'keydown', { key: 'ArrowRight' })),
    [],
  );
  const input = doc.getElementById('mob-pager');
  input.value = '2';
  assert.deepEqual(
    turned(() => fire(input, 'input')),
    [1],
  );
  pager.goTo(0, false);
});

test('a mouse drag pages on both layouts', () => {
  for (const mob of [false, true]) {
    dash.mob = mob;
    pager.goTo(0, false);
    assert.deepEqual(
      turned(() => drag(300, 200)),
      [1],
    );
    assert.deepEqual(
      turned(() => drag(200, 300)),
      [0],
    );
    assert.deepEqual(
      turned(() => drag(200, 250)),
      [],
      'a short drag is a click',
    );
  }
  dash.mob = false;
});

/* One swipe must not advance two pages. */
test('the mouse pager ignores the compatibility event a touch produces', () => {
  const t = { identifier: 9, clientX: 10, clientY: 10 };
  for (const type of ['touchstart', 'touchend']) {
    later();
    fire(doc.body, type, { touches: type === 'touchstart' ? [t] : [], changedTouches: [t] });
    assert.deepEqual(
      turned(() => drag(300, 200)),
      [],
      `${type} does not record the touch`,
    );
  }
  later();
  assert.deepEqual(
    turned(() => drag(300, 200)),
    [1],
    'the mouse stays blocked long after the touch',
  );
  pager.goTo(0, false);
});

/* The mobile folder overlay covers the whole page, and the key handler is on
   the document. */
test('an open folder or search stops the keyboard and the mouse pager', () => {
  for (const markup of [
    '<dialog class="folder-overlay" open></dialog>',
    '<dialog class="folder-overlay-mobile" open></dialog>',
  ]) {
    const holder = doc.createElement('div');
    holder.innerHTML = markup;
    doc.body.appendChild(holder);
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowRight' })),
      [],
    );
    assert.deepEqual(
      turned(() => drag(300, 200)),
      [],
    );
    holder.remove();
    fire(doc.body, 'mousedown', { clientX: 300 });
    fire(doc.body, 'mousemove', { clientX: 200 });
    doc.body.appendChild(holder);
    fire(doc.body, 'mouseup', { clientX: 200 });
    holder.remove();
    assert.deepEqual(
      turned(() => fire(doc.body, 'mouseup', { clientX: 200 })),
      [],
      'a drag that ended over the overlay pages once it closes',
    );
  }
  doc.getElementById('spot').setAttribute('open', '');
  assert.deepEqual(
    turned(() => fire(doc.body, 'keydown', { key: 'ArrowRight' })),
    [],
  );
  doc.getElementById('spot').removeAttribute('open');
});

test('the arrow keys leave a field, a modified key and an open dialog alone', () => {
  pager.goTo(0, false);
  const field = doc.createElement('input');
  doc.body.appendChild(field);
  assert.deepEqual(
    turned(() => fire(field, 'keydown', { key: 'ArrowRight' })),
    [],
    'moving the caret turned the page',
  );
  field.remove();
  for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowLeft', [mod]: true })),
      [],
      mod,
    );
  for (const [tag, cls] of [
    ['dialog', 'setup-prompt'],
    ['div', 'cfg-recovery'],
  ]) {
    const node = doc.createElement(tag);
    node.className = cls;
    if (tag === 'dialog') node.setAttribute('open', '');
    doc.body.appendChild(node);
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowRight' })),
      [],
      cls,
    );
    node.remove();
  }
});

/* The page left behind turns inert, and focus inside it falls to the body. */
test('a page turn takes focus along to the page it shows', () => {
  pager.goTo(0, false);
  const leaving = strip.children[0].querySelector('a[href]');
  leaving.focus();
  fire(leaving, 'keydown', { key: 'ArrowRight' });
  assert.ok(strip.children[1].contains(doc.activeElement), 'focus stayed on the inert page');
  const dot = dotButtons()[0];
  dot.focus();
  dot.click();
  assert.equal(doc.activeElement, dot, 'focus outside the pages was moved');
});

const swipe = (from, to, on = doc.body) => {
  const t = (x, id = 1) => ({ identifier: id, clientX: x, clientY: 100 });
  fire(on, 'touchstart', { touches: [t(from)], changedTouches: [t(from)], timeStamp: 0 });
  fire(on, 'touchmove', { touches: [t(from - 20)], changedTouches: [t(from - 20)], timeStamp: 25 });
  fire(on, 'touchmove', { touches: [t(to)], changedTouches: [t(to)], timeStamp: 50 });
  fire(on, 'touchend', { touches: [], changedTouches: [t(to)], timeStamp: 100 });
  later();
};

const ROWS = [{ name: 'Queue', value: 3, unit: '', color: '' }];
/** The shared popover, with the open state fake-dom cannot read. */
function badgePop() {
  popover.wireBadgePopover(doc.createElement('div'), ROWS);
  const pop = doc.getElementById('badge-pop');
  const own = pop.matches.bind(pop);
  pop.matches = sel => (sel === ':popover-open' ? pop.hasAttribute('data-open') : own(sel));
  pop.showPopover = () => pop.setAttribute('data-open', '');
  pop.hidePopover = () => pop.removeAttribute('data-open');
  pop.animate = undefined;
  return pop;
}

/* The home pager listens on the document. A swipe it never sees end leaves the
   strip between two pages. */
test('a swipe that starts on the badge popover turns the page', () => {
  pager.goTo(0, false);
  const pop = badgePop();
  assert.deepEqual(
    turned(() => swipe(1200, 100, pop)),
    [1],
  );
  pager.goTo(0, false);
});

test('after a keyboard page turn the badge popover opens once the page has landed', async () => {
  pager.goTo(0, false);
  const pop = badgePop();
  const shown = () => pop.hasAttribute('data-open');
  const leaving = strip.children[0].querySelector('a[href]');
  const arrived = strip.children[1].querySelector('a[href]');
  const badge = doc.createElement('div');
  badge.className = 'badge';
  arrived.appendChild(badge);
  popover.wireBadgePopover(badge, ROWS);
  const own = arrived.matches.bind(arrived);
  arrived.matches = sel => sel === ':focus-visible' || own(sel);
  arrived.focus = () => {
    doc.activeElement = arrived;
    fire(arrived, 'focusin');
  };
  let land = () => {};
  strip.getAnimations = () => [
    {
      finished: new Promise(r => {
        land = r;
      }),
    },
  ];
  try {
    leaving.focus();
    fire(leaving, 'keydown', { key: 'ArrowRight' });
    assert.equal(doc.activeElement, arrived);
    assert.equal(shown(), false, 'the popover was placed before the page slid in');
    land();
    await settle();
    assert.equal(shown(), true, 'the popover did not open on the page it landed on');
    popover.closeBadgePopover();
    pager.goTo(0, false);
    land();
    await settle();
    /* Reduced motion: the strip has no transition and lands at once. */
    strip.getAnimations = () => [];
    leaving.focus();
    fire(leaving, 'keydown', { key: 'ArrowRight' });
    assert.equal(shown(), true, 'an instant turn did not open the popover');
  } finally {
    popover.closeBadgePopover();
    delete strip.getAnimations;
    delete arrived.matches;
    delete arrived.focus;
    popover.wireBadgePopover(badge, null);
    badge.remove();
    pager.goTo(0, false);
  }
});

/* Two touch pagers would advance two pages for one gesture. */
test('one swipe on the page turns one page', () => {
  pager.goTo(0, false);
  assert.deepEqual(
    turned(() => swipe(1200, 100)),
    [1],
  );
  pager.goTo(0, false);
  assert.ok(dash.CB.homeSwipe, 'the phone widgets have no pager to feed');
});

test('an open folder or search keeps the home pager still', () => {
  for (const open of [
    () => doc.getElementById('spot').setAttribute('open', ''),
    () => {
      const ov = doc.createElement('dialog');
      ov.className = 'folder-overlay-mobile';
      ov.setAttribute('open', '');
      doc.body.appendChild(ov);
    },
  ]) {
    open();
    assert.deepEqual(
      turned(() => swipe(1200, 100)),
      [],
    );
    doc.getElementById('spot').removeAttribute('open');
    for (const ov of doc.querySelectorAll('.folder-overlay-mobile')) ov.remove();
  }
});

test('the home pager hands its settle to the frame clock when scripted', () => {
  setScripted(false);
  swipe(1200, 100);
  assert.match(strip.style.transition, /^transform \d+ms var\(--page-ease\)$/);
  pager.goTo(0, false);
  setScripted(true);
  try {
    swipe(1200, 100);
    assert.equal(strip.style.transition, '');
  } finally {
    setScripted(false);
    pager.goTo(0, false);
  }
});

/* A strip is laid out in the page's direction, so the next page is on the left
   in one direction and on the right in the other. translateX has no logical
   form. A fixed sign moves page two further off a Persian dashboard instead of
   onto it, leaving every page after the first unreachable. */
test('the home strip moves by the direction of the page', () => {
  pager.goTo(1, false);
  assert.equal(strip.style.transform, 'translateX(-100%)');
  rtl(true);
  try {
    pager.goTo(1, false);
    assert.equal(strip.style.transform, 'translateX(100%)', 'the dashboard strip is fixed to one direction');
  } finally {
    rtl(false);
    pager.goTo(0, false);
  }
});

/* The arrows and a drag name a side of the screen, not a page number, so they
   mirror with the layout. */
test('the arrow keys and the mouse drag mirror in a right-to-left page', () => {
  rtl(true);
  try {
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowLeft' })),
      [1],
    );
    assert.deepEqual(
      turned(() => fire(doc.body, 'keydown', { key: 'ArrowRight' })),
      [0],
    );
    assert.deepEqual(
      turned(() => drag(200, 300)),
      [1],
    );
  } finally {
    rtl(false);
    pager.goTo(0, false);
  }
});

/* One reading of the document, so a right-to-left page cannot take a
   left-to-right number from a stale copy. */
test('the direction is read from the document at every call', () => {
  assert.equal(pageDir(), 1);
  rtl(true);
  assert.equal(pageDir(), -1);
  rtl(false);
  assert.equal(pageDir(), 1);
});

/* A widget frame swallows touches, so it hands them to the same pager. Its
   points are in the frame's own pixels, and the frame moves with the strip. */
test('a swipe on a phone widget drives the home pager', () => {
  const fed = [];
  const feed = {
    down: (id, x, y) => fed.push(['down', id, x, y]),
    move: (id, x, y) => fed.push(['move', id, x, y]),
    up: (id, _t, fling) => fed.push(['up', id, fling]),
    cancel: () => fed.push(['cancel']),
  };
  const opened = [];
  globalThis.open = (...a) => opened.push(a);
  const card = doc.createElement('div');
  doc.body.appendChild(card);
  mountScaledWidget(card, {
    src: '/widgets/clock/index.html',
    title: 'Clock',
    design: [170, 170],
    mobile: true,
    swipe: () => feed,
    overlayHref: 'http://clock.local',
  });
  const ifr = card.querySelector('iframe');
  const inner = createDocument('<p id="p"></p><div id="scrub"></div>');
  inner.defaultView = {
    listeners: Object.create(null),
    performance,
    getComputedStyle: n => ({ touchAction: n.id === 'scrub' ? 'none' : 'auto', overflowX: 'visible' }),
  };
  ifr.contentDocument = inner;
  let left = 100;
  ifr.getBoundingClientRect = () => ({ left, top: 50, width: 200, height: 200 });
  Object.defineProperty(ifr, 'offsetWidth', { value: 100 });
  ifr.dispatchEvent({ type: 'load' });
  const p = inner.getElementById('p');
  const touch = (x, y) => ({ identifier: 3, clientX: x, clientY: y });
  fire(p, 'touchstart', { touches: [touch(10, 10)], changedTouches: [touch(10, 10)], timeStamp: 0 });
  left = 40;
  fire(p, 'touchmove', { touches: [touch(30, 10)], changedTouches: [touch(30, 10)], timeStamp: 10 });
  fire(p, 'touchend', { touches: [], changedTouches: [touch(30, 10)], timeStamp: 20 });
  assert.deepEqual(fed, [
    ['down', 'f3', 120, 70],
    ['move', 'f3', 100, 70],
    ['up', 'f3', true],
  ]);
  assert.deepEqual(opened, [], 'a swipe opened the link');
  fed.length = 0;
  fire(p, 'touchstart', { touches: [touch(10, 10)], changedTouches: [touch(10, 10)], timeStamp: 30 });
  fire(p, 'touchend', { touches: [], changedTouches: [touch(10, 10)], timeStamp: 40 });
  assert.deepEqual(opened, [['http://clock.local', '_blank', 'noopener,noreferrer']], 'a tap must still open the link');
  fed.length = 0;
  const scrub = inner.getElementById('scrub');
  fire(scrub, 'touchstart', { touches: [touch(10, 10)], changedTouches: [touch(10, 10)], timeStamp: 50 });
  fire(scrub, 'touchmove', { touches: [touch(60, 10)], changedTouches: [touch(60, 10)], timeStamp: 60 });
  assert.deepEqual(fed, [], 'a widget scrubber would page');
});

/* Two touch pagers would advance two pages for one gesture. */
test('the phone build pages through the shared touch pager only', () => {
  const build = ui.slice(ui.indexOf('export function buildMobile('), ui.indexOf('export function resetMobileChrome('));
  assert.doesNotMatch(build, /swipePager\(document|goTo\(st\(\)\.pg \+ \(dx/, 'the phone build pages on its own');
});

/* The swipe follows the finger and settles from where the finger left it. */
const swipeSrc = ui.slice(ui.indexOf('export function swipePager('), ui.indexOf('function folderMotion('));

test('the strip follows the finger while it is down', () => {
  assert.match(swipeSrc, /move\(pid, px, py, ts\) \{[\s\S]*strip\.style\.transform = [^;]*translateX\(\$\{x\}px\)/);
  assert.match(swipeSrc, /strip\.style\.transition = 'none'/);
});

test('the release settles from the finger, at the finger speed', () => {
  assert.match(swipeSrc, /swipeSettle\(\{/);
  assert.match(swipeSrc, /settleMs\(/);
  assert.match(swipeSrc, /strip\.style\.transition = `transform \$\{ms\}ms var\(--page-ease\)`;\s*o\.turn\(n, ms\)/);
  assert.match(swipeSrc, /if \(o\.scripted\?\.\(\)\) \{\s*strip\.style\.transition = '';\s*o\.turn\(n, ms\);/);
});

test('only the first finger drags, and a vertical drag is left alone', () => {
  assert.match(swipeSrc, /if \(id !== null \|\| /);
  assert.match(swipeSrc, /p\.identifier === id/);
  assert.match(swipeSrc, /axis = Math\.abs\(dx\) > Math\.abs\(dy\) \? 'x' : 'y'/);
});

test('a finger whose touchend never arrived does not lock the pager', () => {
  assert.match(
    swipeSrc,
    /'touchstart',[\s\S]{0,200}if \(id !== null && e\.touches\.length === e\.changedTouches\.length\) feed\.up\(id, e\.timeStamp, false\);/,
  );
});

test('the page strip has no touch listener that blocks scrolling', () => {
  assert.doesNotMatch(swipeSrc, /passive: false/);
  assert.doesNotMatch(swipeSrc, /preventDefault/);
});

test('the folder pager settles on its own clock and mirrors with the page', () => {
  const folderCall = ui.slice(ui.indexOf('swipePager(box, strip,'));
  assert.doesNotMatch(folderCall.slice(0, folderCall.indexOf(');')), /scripted/);
  assert.match(
    ui,
    /translateX\(\$\{-pageDir\(\) \* curPage \* pageW\}px\)/,
    'the folder strip is fixed to one direction',
  );
  for (const m of ui.matchAll(/\(dx < 0 \? 1 : -1\)(.{0,12})/g)) {
    assert.match(m[1], /^ \* pageDir\(\)/, 'a folder drag still assumes one direction');
  }
});

test('a page turns in 280ms on an ease-out curve', () => {
  const css = read('css/dashboard.css');
  assert.match(css, /--page-ease:\s+cubic-bezier\(\.32,\.72,0,1\);/);
  assert.match(css, /#pages \{[^}]*transition:transform \.28s var\(--page-ease\);/);
  assert.match(css, /\.dyn-strip\s+\{[^}]*transition:transform \.28s var\(--page-ease\);/);
});

/* Each motion has a CSS form and a frame-clock form. Their durations must match. */
test('the scripted page turn and search pill take the CSS durations', () => {
  const css = read('css/dashboard.css');
  const ms = re => Math.round(Number(re.exec(css)?.[1]) * 1000);
  const turn = Number(/export const PAGE_TURN_MS = (\d+);/.exec(read('js/dashboard-logic.js'))?.[1]);
  assert.equal(turn, ms(/#pages \{[^}]*transition:transform ([\d.]+)s/));
  const pill = Number(/const PILL_MS = (\d+);/.exec(read('js/ui.js'))?.[1]);
  const pillCss = [...css.matchAll(/transition:--pill-inset ([\d.]+)s/g)].map(m => Math.round(Number(m[1]) * 1000));
  assert.ok(pillCss.length >= 2, 'the pill transitions moved');
  for (const v of pillCss) assert.equal(pill, v);
});

test('the hidden pager is not painted', () => {
  const css = read('css/dashboard.css');
  assert.match(css, /#dots\[hidden\] \{ display:none \}/, 'display:flex on #dots beats the hidden attribute');
  assert.match(
    read('index.html'),
    /<nav id="dots"[^>]*\shidden>/,
    'the bar must start hidden, or the error screen shows it empty',
  );
});
