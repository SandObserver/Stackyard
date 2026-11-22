import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

import { fakeFetch, installDom, pageBody } from './fake-dom.mjs';
import { pageWithScripts } from './widget-source.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => pageWithScripts(path.join(root, p));
const css = read('css/dashboard.css');

globalThis.location = { search: '?id=test' };
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { createElement: () => ({}), getElementById: () => null, head: { appendChild() {} } };
const { rollDirection, rollText } = await import('../js/widget-toolbox.js');
const { formatNumber, setNumberLanguage } = await import('../js/format-number.js');

const api = { '/api/badges': {}, '/api/health': {} };
const fetch = fakeFetch({ '/api/badges': () => api['/api/badges'], '/api/health': () => api['/api/health'] });
const dom = installDom({ markup: pageBody('index.html'), fetch, location: 'http://nas.local/?id=test' });
const doc = dom.document;
/* A 2d context that reads #rrggbb, so a plate colour has a measurable tone. */
const createElement = doc.createElement.bind(doc);
doc.createElement = tag => {
  const node = createElement(tag);
  if (tag !== 'canvas') return node;
  let fill = '#000000';
  const ctx = {
    set fillStyle(v) {
      if (/^#[0-9a-f]{6}$/i.test(v)) fill = v;
    },
    get fillStyle() {
      return fill;
    },
    clearRect() {},
    fillRect() {},
    getImageData: () => ({ data: [1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16)) }),
  };
  node.getContext = () => ctx;
  return node;
};
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const { createBadges } = await import('../js/dashboard-badges.js');
const { createWallpaper } = await import('../js/dashboard-wallpaper.js');
const { wireThemeChanges } = await import('../js/dashboard-theme.js');
const { THEME_KEY } = await import('../js/theme.js');
const { mkWrap } = await import('../js/utils.js');
const popover = await import('../js/badge-popover.js');
/* fake-dom reads no :popover-open. The popover tracks its own open state. */
popover.wireBadgePopover(doc.createElement('div'), [{ name: 'x', value: 1, unit: '', color: '' }]);
const pop = doc.getElementById('badge-pop');
const popMatches = pop.matches.bind(pop);
pop.matches = sel => (sel === ':popover-open' ? pop.hasAttribute('data-open') : popMatches(sel));
pop.showPopover = () => pop.setAttribute('data-open', '');
pop.hidePopover = () => pop.removeAttribute('data-open');
const ticks = async (n = 8) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const themeCalls = [];
wireThemeChanges({ refreshBadges: () => themeCalls.push('badges'), applyBg: () => themeCalls.push('wallpaper') });
const themeChange = mode => {
  dom.storage.set(THEME_KEY, mode);
  dom.window.dispatchEvent({ type: 'storage', key: THEME_KEY });
};

test('a theme change repaints in place and never rebuilds the widgets', () => {
  const strip = doc.getElementById('pages');
  strip.innerHTML = '<div class="page"><div class="plate" data-color="auto"></div><iframe></iframe></div>';
  const page = strip.firstElementChild;
  const frame = doc.querySelector('iframe');
  let framed = 0;
  frame.contentWindow = { __applyHostTheme: () => framed++ };
  const views = [];
  doc.startViewTransition = fn => {
    views.push(fn);
    fn();
  };
  themeCalls.length = 0;
  themeChange('light');
  assert.equal(views.length, 1, 'the change does not crossfade');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(doc.querySelector('.plate').style.getPropertyValue('--tc'), '#F2F2F7', 'a tile kept its old colour');
  assert.equal(framed, 1, 'a widget frame kept its old theme');
  assert.deepEqual(themeCalls, ['badges', 'wallpaper']);
  assert.equal(strip.firstElementChild, page, 'the theme change rebuilt the page');
  assert.equal(doc.querySelector('iframe'), frame);
  themeChange('other tab');
  dom.window.dispatchEvent({ type: 'storage', key: 'other' });
  assert.equal(views.length, 2, 'an unrelated storage key ran the theme change');
  delete doc.startViewTransition;
  themeChange('dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark', 'no view transition, no theme change');
});

test('a widget frame is told when reduced transparency changes', async () => {
  const frame = doc.querySelector('iframe');
  let framed = 0;
  frame.contentWindow = { __applyHostTheme: () => framed++ };
  doc.documentElement.setAttribute('data-transparency', 'reduce');
  await ticks();
  assert.equal(framed, 1);
  doc.documentElement.setAttribute('data-other', 'x');
  await ticks();
  assert.equal(framed, 1);
});

/* The tile outlives a theme change now, so a colour read when it was built is stale. */
test('a letter drawn after an icon fails reads the plate colour of the current theme', () => {
  for (const item of [
    { id: 'a', label: 'Alpha', color: 'auto', iconUrl: 'http://icons.local/a.png' },
    { id: 's', label: 'Settings', system: 'settings' },
  ]) {
    doc.documentElement.setAttribute('data-theme', 'dark');
    const plate = mkWrap(item, 72, 19, 50, 'iwrap');
    const img = plate.querySelector('img');
    doc.documentElement.setAttribute('data-theme', 'light');
    while (plate.querySelector('img')) plate.querySelector('img').onerror();
    const letter = plate.querySelector('.fb');
    assert.ok(letter, `${item.id} drew no letter`);
    assert.ok(letter.classList.contains('fb-on-light'), `${item.id} took the dark plate it was built on`);
    assert.ok(img);
  }
  doc.documentElement.setAttribute('data-theme', 'dark');
});

test('a widget frame can take a new theme without reloading', () => {
  const src = read('js/widget-theme.js');
  assert.match(src, /\(window\)\.__applyHostTheme = apply;/);
  assert.match(src, /if \(painted\) root\.style\.backgroundColor = '';/, 'a stale card colour would stay');
  assert.match(
    src,
    /if \(fixedDark === null\) fixedDark = /,
    'a card the widget marked dark itself would keep the dark theme',
  );
});

test('a running poll draws its last data again when the theme changes', () => {
  const src = read('js/widget-toolbox.js');
  assert.match(src, /attributeFilter: \['data-theme'\]/);
  assert.match(src, /_themed\.add\(onTheme\)/);
  assert.match(src, /_themed\.delete\(onTheme\)/, 'a stopped poll would keep drawing');
});

test('a badge scales in only on a live change, scales out and crossfades its colour', async () => {
  assert.doesNotMatch(css, /animation:badge-in/, 'every rebuild would pop every badge');
  assert.match(css, /\.badge \{[^}]*transition:background-color \.2s ease;/);
  const dash = createDashboardState();
  dash.items = [{ id: 'a', type: 'app', label: 'A', monitoring: { activity: { enabled: true } } }];
  const badges = createBadges(dash);
  const tile = doc.createElement('a');
  tile.dataset.tileName = 'A';
  const badge = doc.createElement('div');
  tile.appendChild(badge);
  doc.body.appendChild(tile);
  const anims = [];
  badge.animate = (frames, opts) => {
    const a = { frames, opts, cancelled: false, onfinish: null };
    a.cancel = () => {
      a.cancelled = true;
    };
    anims.push(a);
    return a;
  };
  const poll = async value => {
    api['/api/badges'] = { a: { value } };
    await badges.pollBadges();
  };
  badges.breg('a', badge);
  await poll(3);
  await poll(4);
  assert.ok(badge.classList.contains('on'));
  assert.equal(anims.length, 0, 'a badge the first polls find popped in');
  await poll(0);
  const exit = anims.at(-1);
  assert.deepEqual(exit.frames.at(-1), { opacity: 0, transform: 'translateZ(0) scale(.6)' });
  assert.ok(badge.classList.contains('on'), 'the badge vanished before it scaled out');
  await poll(5);
  assert.equal(exit.cancelled, true, 'a late exit would paint over a newer value');
  assert.equal(badge.textContent, '5');
  await poll(0);
  anims.at(-1).onfinish();
  assert.ok(!badge.classList.contains('on'));
  await poll(7);
  assert.deepEqual(
    anims.at(-1).frames[0],
    { opacity: 0, transform: 'translateZ(0) scale(.8)' },
    'a live change does not scale in',
  );
  tile.remove();
});

/** An Image whose decode the test settles. */
const decodes = [];
globalThis.Image = class {
  constructor() {
    this.naturalWidth = 0;
    this.complete = false;
  }
  decode() {
    return new Promise((resolve, reject) => decodes.push({ src: this.src, resolve, reject }));
  }
};
const settleDecode = async src => {
  decodes.find(d => d.src.endsWith(src)).resolve();
  await ticks(20);
};

test('the wallpaper paints once decoded, and fades in only when it arrives late', async () => {
  const tokens = fs.readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /html\.wall-in::before \{ animation:wall-in \.4s ease-out \}/);
  assert.match(css, /html\.wall-swap::after \{[^}]*background-image:var\(--bg-prev-image,none\)/);
  const html = doc.documentElement;
  const dash = createDashboardState();
  const wall = createWallpaper(dash);
  dash.S = { background: { type: 'url', url: '/wall/one.jpg' } };
  doc.body.classList.remove('ready');
  const first = wall.applyBg();
  await ticks();
  assert.equal(html.style.getPropertyValue('--bg-image'), '', 'the wallpaper painted before it decoded');
  await settleDecode('/wall/one.jpg');
  await first;
  assert.match(html.style.getPropertyValue('--bg-image'), /one\.jpg/);
  assert.ok(!html.classList.contains('wall-in'), 'a fade under the veil is never seen');
  doc.body.classList.add('ready');
  dash.S = { background: { type: 'url', url: '/wall/two.jpg' } };
  const second = wall.applyBg();
  await ticks();
  await settleDecode('/wall/two.jpg');
  await second;
  assert.match(html.style.getPropertyValue('--bg-prev-image'), /one\.jpg/);
  assert.match(html.style.getPropertyValue('--bg-image'), /two\.jpg/);
  assert.ok(html.classList.contains('wall-swap'));
  html.classList.remove('wall-swap');
});

test('a newer wallpaper wins over one still decoding', async () => {
  const html = doc.documentElement;
  const dash = createDashboardState();
  const wall = createWallpaper(dash);
  dash.S = { background: { type: 'url', url: '/wall/slow.jpg' } };
  const slow = wall.applyBg();
  await ticks();
  dash.S = { background: { type: 'color', color: '#203040' } };
  await wall.applyBg();
  await settleDecode('/wall/slow.jpg');
  await slow;
  assert.doesNotMatch(html.style.getPropertyValue('--bg-image'), /slow/);
});

test('the theme crossfade lasts 300 ms and waits for a hidden page', async () => {
  assert.match(css, /::view-transition-old\(root\), ::view-transition-new\(root\) \{ animation-duration:\.3s/);
  doc.hidden = true;
  themeCalls.length = 0;
  themeChange('light');
  themeChange('dark');
  assert.deepEqual(themeCalls, [], 'a theme set from another tab would switch unseen');
  doc.hidden = false;
  doc.dispatchEvent({ type: 'visibilitychange' });
  assert.deepEqual(themeCalls, ['badges', 'wallpaper'], 'the waiting change ran more than once');
  doc.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(themeCalls.length, 2);
});

test('the phone page control is an input a screen reader can adjust', () => {
  const page = read('index.html');
  assert.match(page, /<input id="mob-pager" class="visually-hidden" type="range"[^>]*data-i18n-al="home\.pageControl"/);
  assert.match(page, /<input id="mob-pager"[^>]*tabindex="-1"/, 'Tab would land on a control no one can see');
  const dash = createDashboardState({ mob: true });
  dash.totalPages = 3;
  const strip = doc.getElementById('pages');
  strip.innerHTML = '<div></div><div></div><div></div>';
  createPager(dash).goTo(1);
  const pager = doc.getElementById('mob-pager');
  assert.equal(pager.hidden, false);
  assert.equal(pager.max, '3');
  assert.equal(pager.value, '2');
  assert.equal(pager.getAttribute('aria-valuetext'), 'home.pageAnnounce');
  dash.mob = false;
  createPager(dash).goTo(1);
  assert.equal(pager.hidden, true, 'the desktop layout shows the phone control');
});

test('search shows the real Settings icon', () => {
  const spot = read('js/spotlight.js');
  assert.match(spot, /app\.system === 'settings'[\s\S]{0,200}SETTINGS_ICON_LIGHT : SETTINGS_ICON/);
});

test('the analog clock redraws its face when the theme changes', () => {
  assert.match(
    read('widgets/clock/analog.html'),
    /new MutationObserver\([\s\S]{0,400}attributeFilter:\['data-theme'\]/,
  );
});

test('widgets with a large live figure roll it', () => {
  assert.match(read('widgets/system-summary/index.html'), /rollText\(r\.val, r\.latest, /);
  assert.match(read('widgets/dns/index.html'), /rollText\(pctEl,/);
  assert.match(read('widgets/weather/index.html'), /rollText\(tempEl,/);
});

/* Enough of a DOM for rollText's first write. */

test('a figure that grows rolls up, one that shrinks rolls down', () => {
  assert.equal(rollDirection('11%', '14%'), true);
  assert.equal(rollDirection('14%', '4%'), false);
  assert.equal(rollDirection('—', '4%'), true, 'an unreadable value rolls up');
});

test('a Persian figure rolls in the direction its digits moved', () => {
  assert.equal(rollDirection('۴۱٪', '۴۲٪'), true);
  assert.equal(rollDirection('۴۲٪', '۴۱٪'), false);
  assert.equal(rollDirection('٤٢٪', '٤١٪'), false, 'Arabic-Indic digits read the same');
  assert.equal(rollDirection('۴۲٫۵', '۴۲٫۱'), false, 'the Persian decimal separator keeps the fraction');
});

/** @param {string} tag the reader's locale @param {string} language the interface language */
function inLocale(tag, language, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  setNumberLanguage(language);
  try {
    fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
    setNumberLanguage('en');
  }
}

test('a Persian negative figure keeps its sign', () => {
  inLocale('fa', 'fa', () => {
    const [cold, milder] = [formatNumber(-5), formatNumber(-3)];
    assert.match(cold, /\u2212/, 'this locale no longer writes U+2212');
    assert.equal(rollDirection(cold + '°', milder + '°'), true, '-5 to -3 rose');
    assert.equal(rollDirection(milder + '°', cold + '°'), false, '-3 to -5 fell');
  });
});

test('a grouped figure reads by the separators it was written with', () => {
  inLocale('de-DE', 'de', () => {
    assert.equal(formatNumber(1000), '1.000');
    assert.equal(rollDirection('999', '1.000'), true, '999 to 1.000 rose');
    assert.equal(rollDirection('1.000', '999'), false);
    assert.equal(rollDirection('1,5', '1,25'), false, 'the comma is the decimal point');
  });
  inLocale('fr-FR', 'fr', () => {
    const written = formatNumber(1000.5);
    assert.equal(rollDirection(written, formatNumber(1000.4)), false, '1 000,5 read as 1000.5');
    assert.equal(rollDirection(written, formatNumber(1000.6)), true);
    assert.equal(rollDirection(written, '999'), false);
    assert.equal(rollDirection('1 000,5', '1 000,4'), false, 'a plain space groups too');
  });
  inLocale('en-US', 'en', () => {
    assert.equal(rollDirection('999', '1,000'), true);
    assert.equal(rollDirection('1.5', '1.25'), false);
    assert.equal(rollDirection('-5', '-3'), true);
    assert.equal(rollDirection('n/a', '3'), true, 'an unreadable value rolls up');
    assert.equal(rollDirection('3', 'n/a'), true);
  });
});

test('an instant write leaves the next large change able to roll', () => {
  const el = { textContent: '', firstElementChild: null, childNodes: [], animate() {} };
  rollText(el, '41%', { instant: true });
  rollText(el, '42%', { instant: true });
  assert.equal(el.textContent, '42%');
  let rolled = 0;
  const replaceChildren = () => {
    rolled++;
  };
  Object.assign(el, { replaceChildren, querySelectorAll: () => [] });
  try {
    rollText(el, '60%');
  } catch {
    /* The fake has no rolled glyphs to animate. */
  }
  assert.equal(rolled, 1, 'the value already shown was recorded');
});

test('the first value is written at once, with nothing to roll from', () => {
  const el = { textContent: 'old', firstElementChild: null, animate() {} };
  rollText(el, '12%');
  assert.equal(el.textContent, '12%');
});

test('a rolled figure keeps its digit order in a right-to-left widget', () => {
  const node = tag => ({
    tagName: tag,
    className: '',
    textContent: '',
    children: [],
    childNodes: [],
    get firstElementChild() {
      return this.children[0] ?? null;
    },
    get firstChild() {
      return this.childNodes[0] ?? null;
    },
    classList: {
      contains(c) {
        return false;
      },
    },
    appendChild(c) {
      this.children.push(c);
      this.childNodes.push(c);
      return c;
    },
    replaceChildren(...c) {
      this.children = [...c];
      this.childNodes = [...c];
    },
    setAttribute() {},
    animate: () => ({ finished: new Promise(() => {}) }),
  });
  const saved = globalThis.document;
  globalThis.document = { createElement: node, getElementById: () => ({}), head: { appendChild() {} } };
  try {
    const el = node('div');
    rollText(el, '۲۱°');
    rollText(el, '۲۲°');
    assert.equal(el.children.length, 1, 'one run holds every character');
    const run = el.children[0];
    assert.equal(run.className, 'wt-run');
    assert.deepEqual(
      run.children.map(c => c.className),
      ['wt-roll', 'wt-roll', 'wt-roll'],
    );
  } finally {
    globalThis.document = saved;
  }
  assert.match(read('js/widget-toolbox.js'), /\.wt-run\{direction:ltr;unicode-bidi:isolate\}/);
});

test('a changed digit rolls its full height inside a clipped slot', () => {
  const src = read('js/widget-toolbox.js');
  assert.match(src, /\.wt-roll\{[^']*clip-path:inset\(0 -1em\)/);
  assert.match(src, /const enter = up \? '100%' : '-100%';/);
  assert.match(src, /const leave = up \? '-100%' : '100%';/);
  assert.match(src, /filter: 'blur\(2px\)'/);
});

test('the shared curve, the page curve and the release slope agree', async () => {
  const { EASE_IOS } = await import('../js/motion-curve.js');
  const { PAGE_EASE_SLOPE } = await import('../js/dashboard-logic.js');
  const [x1, y1, x2, y2] = EASE_IOS.match(/[\d.]+/g).map(Number);
  assert.deepEqual([x2, y2], [0, 1]);
  assert.equal(PAGE_EASE_SLOPE, y1 / x1, 'a flick would no longer leave at finger speed');
  assert.ok(css.includes(`--page-ease:        ${EASE_IOS}`));
});

test('a tile settles without overshoot', () => {
  assert.doesNotMatch(css, /bounce-spring|1\.56/);
});

test('the home strip keeps vertical pan and pinch zoom', () => {
  assert.match(css, /#pages \{[^}]*touch-action:pan-y pinch-zoom/);
});

test('the phone search pill answers a press without touching its inline transform', () => {
  assert.match(css, /#mob-search-pill:active \{ scale:\.96;/);
});

test('folder pages are reachable without touch', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const d = mk\('button'\);\s*d\.type = 'button';\s*d\.className = 'folder-dot dyn-dot';/);
  assert.match(ui, /e\.key !== 'ArrowRight' && e\.key !== 'ArrowLeft'/);
  assert.match(ui, /focus\(\{ preventScroll: true \}\)/, 'a focus scroll knocks the clipped strip off its page');
});

test('a page turn closes the badge popover', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { wireBadgePopover } = popover;
  const tile = doc.createElement('a');
  const badge = doc.createElement('div');
  badge.className = 'badge';
  tile.appendChild(badge);
  doc.getElementById('pages').firstElementChild.appendChild(tile);
  wireBadgePopover(badge, [{ name: 'Queue', value: 3, unit: '', color: '' }]);
  const dash = createDashboardState();
  dash.totalPages = 3;
  const { goTo } = createPager(dash);
  const hover = () => {
    badge.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
    t.mock.timers.tick(400);
  };
  pop.animate = undefined;
  const shown = () => pop.hasAttribute('data-open');
  hover();
  assert.equal(shown(), true);
  goTo(0, false);
  assert.equal(shown(), true, 'staying on the page closed it');
  goTo(1, false);
  assert.equal(shown(), false);
  badge.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
  goTo(2, false);
  t.mock.timers.tick(400);
  assert.equal(shown(), false, 'a hover from the old page opened it on the new one');
  delete pop.animate;
  tile.remove();
});

/* Without a source, the second tap light-dismisses it and the tap's click opens it again. */
test('the popover is shown from the badge, and again from the next badge', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sources = [];
  const show = pop.showPopover;
  pop.showPopover = opts => {
    sources.push(opts?.source);
    show();
  };
  const tiles = [0, 1].map(() => {
    const tile = doc.createElement('a');
    const badge = doc.createElement('div');
    badge.className = 'badge';
    tile.appendChild(badge);
    doc.body.appendChild(tile);
    popover.wireBadgePopover(badge, [{ name: 'Queue', value: 3, unit: '', color: '' }]);
    return { tile, badge };
  });
  for (const { badge } of tiles) {
    badge.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
    t.mock.timers.tick(400);
  }
  assert.deepEqual(
    sources,
    tiles.map(x => x.badge),
  );
  popover.closeBadgePopover();
  pop.showPopover = show;
  for (const { tile } of tiles) tile.remove();
});

/* The browser light-dismisses an auto popover on a pointerdown outside it and
   outside its source. */
test('a second tap on a badge closes its popover and does not open it again', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 60_000 });
  pop.animate = undefined;
  const show = pop.showPopover;
  const hide = pop.hidePopover;
  const shows = [];
  let source = null;
  pop.showPopover = opts => {
    source = opts?.source ?? null;
    shows.push(source);
    show();
  };
  const shown = () => pop.hasAttribute('data-open');
  const tap = node => {
    if (shown() && !pop.contains(node) && !source?.contains(node)) {
      hide();
      pop.dispatchEvent({ type: 'toggle', newState: 'closed' });
    }
    node.dispatchEvent({ type: 'click', bubbles: true, detail: 1 });
    t.mock.timers.tick(1000);
  };
  const tile = doc.createElement('a');
  const badge = doc.createElement('div');
  badge.className = 'badge';
  tile.appendChild(badge);
  doc.body.appendChild(tile);
  popover.wireBadgePopover(badge, [{ name: 'Queue', value: 3, unit: '', color: '' }]);
  try {
    tap(badge);
    assert.equal(shown(), true, 'the first tap did not open it');
    tap(badge);
    assert.equal(shows.length, 1, 'the second tap closed the popover and opened it again');
    assert.equal(shown(), false, 'the second tap left it open');
  } finally {
    popover.closeBadgePopover();
    pop.showPopover = show;
    delete pop.animate;
    tile.remove();
  }
});

/* A modal folder makes everything outside it inert, the top layer included. */
test('the popover opens inside the folder that holds the badge, and leaves with it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  pop.animate = undefined;
  const folder = doc.createElement('dialog');
  const tile = doc.createElement('a');
  const badge = doc.createElement('div');
  badge.className = 'badge';
  tile.appendChild(badge);
  folder.appendChild(tile);
  doc.body.appendChild(folder);
  folder.showModal();
  popover.wireBadgePopover(badge, [{ name: 'Queue', value: 3, unit: '', color: '' }]);
  badge.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
  t.mock.timers.tick(400);
  assert.equal(pop.parentElement, folder);
  folder.close();
  assert.equal(pop.parentElement, doc.body, 'the folder took the popover with it');
  assert.equal(pop.hasAttribute('data-open'), false);
  folder.remove();
  delete pop.animate;
});

test('a widget frame takes reduced transparency from the dashboard and glass from its card', async () => {
  const { runInNewContext } = await import('node:vm');
  const src = read('js/widget-theme.js');
  /** @param {{ parentAttr?: string|null, queries?: string[], fill?: string, cardStyle?: string, theme?: string, fixedDark?: boolean }} o */
  const run = ({
    parentAttr = null,
    queries = [],
    fill = 'rgb(28, 28, 30)',
    cardStyle = 'translucent',
    theme = 'dark',
    fixedDark = false,
  } = {}) => {
    const attrs = new Map();
    const props = new Map();
    const style = {
      backgroundColor: '',
      setProperty: (k, v) => props.set(k, v),
      removeProperty: k => props.delete(k),
    };
    const frameRoot = {
      style,
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: k => attrs.delete(k),
      getAttribute: k => attrs.get(k) ?? null,
      toggleAttribute: (k, on) => (on ? attrs.set(k, '') : attrs.delete(k)),
    };
    const parentRoot = { getAttribute: k => (k === 'data-transparency' ? parentAttr : theme) };
    const card = { matches: sel => sel === `[data-card="${cardStyle}"]` };
    const frameElement = {
      style: { colorScheme: '' },
      closest: sel =>
        sel === '.widget, .mob-widget-card' || (fixedDark && sel === '[data-appearance="dark"]') ? card : null,
      getAttribute: () => null,
    };
    const window = {
      frameElement,
      parent: {
        document: { documentElement: parentRoot },
        getComputedStyle: el => ({ backgroundColor: el === card ? fill : '' }),
      },
      matchMedia: q => ({ matches: queries.some(x => q.includes(x)), addEventListener() {} }),
    };
    runInNewContext(src, {
      window,
      document: { documentElement: frameRoot },
      location: { search: '' },
      URLSearchParams,
      getComputedStyle: () => ({ backgroundColor: style.backgroundColor || 'rgba(0, 0, 0, 0)' }),
    });
    return {
      reduce: attrs.get('data-transparency') ?? null,
      glass: attrs.has('data-glass'),
      bg: style.backgroundColor,
      ink: props.get('--glass-ink-2') ?? null,
      scheme: style.colorScheme,
      frameScheme: frameElement.style.colorScheme,
    };
  };
  assert.equal(run({ parentAttr: 'reduce' }).reduce, 'reduce', 'the dashboard attribute');
  assert.equal(run().reduce, null);

  const pickState = ({ reduce, glass, bg, ink }) => ({ reduce, glass, bg, ink });
  assert.deepEqual(
    pickState(run({ fill: 'rgba(28, 28, 30, 0.85)' })),
    { reduce: null, glass: true, bg: '', ink: '#AEAEB2' },
    'a dark glass card shows through the page',
  );
  assert.equal(run({ fill: 'rgba(255, 255, 255, 0.85)' }).ink, '#48484A', 'a light glass card takes the dark ink');
  assert.deepEqual(
    pickState(run()),
    { reduce: null, glass: false, bg: '#1C1C1E', ink: null },
    'a solid card is painted under the page',
  );
  assert.deepEqual(
    pickState(run({ fill: 'rgba(0, 0, 0, 0.62)', cardStyle: 'default' })),
    { reduce: null, glass: false, bg: '#1C1C1E', ink: null },
    'a see-through default card under increased contrast keeps the solid page',
  );
  const backup = run({ fill: 'rgba(28, 28, 30, 0.85)', theme: 'light', fixedDark: true });
  assert.equal(backup.scheme, 'dark', 'a dark-appearance widget on the light dashboard');
  assert.equal(backup.frameScheme, 'dark', 'the frame element must match, or the browser paints it opaque');
  assert.equal(run({ theme: 'light' }).frameScheme, 'light');
  const forced = run({ fill: 'rgba(28, 28, 30, 0.85)', queries: ['forced-colors'] });
  assert.equal(forced.glass, false);
  assert.equal(forced.bg, '#1C1C1E');
});

test('widget styles key reduced transparency on the attribute the frame copies', () => {
  const dir = path.join(root, 'widgets');
  for (const name of fs.readdirSync(dir)) {
    for (const file of fs.readdirSync(path.join(dir, name)).filter(f => f.endsWith('.html'))) {
      const html = pageWithScripts(path.join(dir, name, file));
      assert.doesNotMatch(html, /prefers-reduced-transparency/, `${name}/${file}`);
      if (/data-transparency/.test(html)) assert.match(html, /widget-theme\.js/, `${name}/${file}`);
    }
  }
});

test('the veil lifts once the first view and its wallpaper are both in', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { bootDashboard } = await import('./dashboard-page.mjs');
  globalThis.__wallpaperHint = { src: 'http://nas.local/other.jpg' };
  const page = await bootDashboard({
    config: {
      items: [{ id: 'a', type: 'app', label: 'A' }],
      settings: { background: { type: 'url', url: '/wall/boot.jpg' } },
    },
  });
  try {
    const body = page.dom.document.body;
    assert.ok(page.dom.document.querySelector('#pages .page'), 'the first view was not built');
    assert.ok(!body.classList.contains('ready'), 'the veil lifted before the wallpaper decoded');
    await settleDecode('/wall/boot.jpg');
    await page.booted;
    assert.ok(body.classList.contains('ready'));
  } finally {
    delete globalThis.__wallpaperHint;
    page.stop();
  }
});
