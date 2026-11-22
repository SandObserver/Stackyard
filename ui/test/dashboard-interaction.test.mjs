import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fakeFetch, fire, installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/dashboard.css').replace(/\/\*[\s\S]*?\*\//g, '');

const fetch = fakeFetch({ '/api/config': { items: [], settings: {} }, '/api/badges': {}, '/api/health': {} });
const dom = installDom({ markup: pageBody('index.html'), fetch, location: 'http://nas.local/' });
const doc = dom.document;
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const { createLayout } = await import('../js/dashboard-layout.js');
const { createBadges } = await import('../js/dashboard-badges.js');
const { createPolling } = await import('../js/dashboard-polling.js');
const { wirePageInput } = await import('../js/dashboard-input.js');
const { initUI, buildMobile, mkFolderGlyph, openFolderDesktop, openFolderMobile } = await import('../js/ui.js');
const { createDesktopGrid } = await import('../js/dashboard-grid.js');
const { initSpotlight } = await import('../js/spotlight.js');
const { applyLabelTones } = await import('../js/label-contrast.js');
const { iconChain } = await import('../js/icons.js');

const apps = n =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, type: 'app', label: `P${i}`, href: `http://p${i}.local` }));
/** Build the phone layout for these items on a vw by 852 screen. */
function phone(items, vw = 393) {
  const dash = createDashboardState({ mob: true });
  dash.items = items;
  const badges = createBadges(dash);
  initUI({ items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  const size = [globalThis.innerWidth, globalThis.innerHeight];
  Object.assign(globalThis, { innerWidth: vw, innerHeight: 852 });
  try {
    dash.totalPages = buildMobile();
  } finally {
    [globalThis.innerWidth, globalThis.innerHeight] = size;
  }
  return { dash, badges };
}
const pillEl = () => doc.getElementById('mob-search-pill');

const rule = selector => {
  const at = css.indexOf(selector);
  assert.ok(at > -1, `${selector} is not declared`);
  return css.slice(at, css.indexOf('}', at));
};

test('a page turn moves the Search pill only on the phone layout and when asked', () => {
  const dash = createDashboardState({ mob: true });
  dash.totalPages = 3;
  const bumps = [];
  dash.CB.mobPillBump = n => bumps.push(n);
  const { goTo } = createPager(dash);
  goTo(1);
  goTo(2, true, false);
  dash.mob = false;
  goTo(0);
  assert.deepEqual(bumps, [1]);
});

test('a phone build restores the page without moving the pill, then syncs it', () => {
  const dash = createDashboardState({ mob: true });
  dash.items = Array.from({ length: 60 }, (_, i) => ({
    id: `a${i}`,
    type: 'app',
    label: `A${i}`,
    href: 'http://a.local',
  }));
  const badges = createBadges(dash);
  initUI({ items: dash.items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  dom.storage.set('dash_page', '1');
  const pager = createPager(dash);
  const lay = createLayout({ dash, grid: {}, pager, wallpaper: { retone() {}, resampleBg() {} } });
  const calls = [];
  for (const [key, name] of [
    ['mobPillBump', 'bump'],
    ['mobPillSync', 'sync'],
  ]) {
    let fn = null;
    Object.defineProperty(dash.CB, key, {
      get: () => fn && (n => (calls.push([name, n]), fn(n))),
      set: v => {
        fn = v;
      },
    });
  }
  lay.buildLayout();
  dom.flushFrames();
  dom.flushFrames();
  assert.ok(dash.totalPages >= 2, `the phone build made ${dash.totalPages} page`);
  assert.equal(dash.pg, 1);
  assert.deepEqual(calls, [['sync', 1]]);
});

test('the pill stays on Search on a one-page dashboard', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const one = phone(apps(1));
  assert.equal(one.dash.totalPages, 1);
  one.dash.CB.mobPillBump(0);
  assert.equal(pillEl().classList.contains('paging'), false);
  const many = phone(apps(60));
  assert.ok(many.dash.totalPages > 1, `${many.dash.totalPages} page`);
  many.dash.CB.mobPillBump(1);
  assert.equal(pillEl().classList.contains('paging'), true, 'a page turn does not show the dots');
  t.mock.timers.tick(1500);
  assert.equal(pillEl().classList.contains('paging'), false, 'the dots stay up');
});

test('the desktop build stops the mobile pill sync', () => {
  const { dash, badges } = phone(apps(60));
  assert.equal(typeof dash.CB.mobPillSync, 'function');
  createDesktopGrid({ dash, badges, goTo() {} }).buildDesktop();
  assert.equal(dash.CB.mobPillSync, null);
  assert.equal(dash.CB.mobPillBump, null);
  assert.equal(pillEl().style.cssText, '');
});

test('a config change does not reload over Search, a folder or a swipe', async () => {
  const badges = { pollBadges() {}, pollHealth() {} };
  const polling = createPolling({ badges, differs: () => true });
  const strip = doc.getElementById('pages');
  const spot = doc.getElementById('spot');
  const folder = doc.createElement('dialog');
  folder.className = 'folder-overlay';
  const blocked = [
    [() => spot.setAttribute('open', ''), () => spot.removeAttribute('open')],
    [
      () => {
        folder.setAttribute('open', '');
        doc.body.appendChild(folder);
      },
      () => folder.remove(),
    ],
    [() => strip.classList.add('dragging'), () => strip.classList.remove('dragging')],
  ];
  for (const [on, off] of blocked) {
    on();
    await polling.pollConfig();
    off();
  }
  assert.equal(dom.location.reloads, 0);
  await polling.pollConfig();
  assert.equal(dom.location.reloads, 1);
  dom.location.reloads = 0;
});

test('an unchanged config never reloads', async () => {
  const polling = createPolling({ badges: { pollBadges() {}, pollHealth() {} }, differs: () => false });
  await polling.pollConfig();
  assert.equal(dom.location.reloads, 0);
});

test('a returning tab polls the config at once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const polled = [];
  const badges = { pollBadges: () => polled.push('badges'), pollHealth: () => polled.push('health') };
  const polling = createPolling({ badges, differs: () => false });
  polling.watchVisibility();
  fetch.calls.length = 0;
  doc.hidden = false;
  doc.dispatchEvent({ type: 'visibilitychange' });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(polled, ['badges', 'health']);
  assert.deepEqual(
    fetch.calls.map(c => c.url),
    ['/api/config'],
  );
  doc.hidden = true;
  doc.dispatchEvent({ type: 'visibilitychange' });
  t.mock.timers.tick(120_000);
  assert.deepEqual(polled, ['badges', 'health'], 'a hidden tab keeps polling');
});

test('a mouse drag inside an open overlay turns no page', () => {
  const dash = createDashboardState();
  const turns = [];
  wirePageInput({ dash, goTo: n => turns.push(n) });
  const ov = doc.createElement('dialog');
  ov.className = 'folder-overlay-mobile';
  ov.setAttribute('open', '');
  doc.body.appendChild(ov);
  fire(ov, 'mousedown', { clientX: 300 });
  fire(ov, 'mousemove', { clientX: 100 });
  fire(ov, 'mouseup', { clientX: 100 });
  ov.remove();
  fire(doc.body, 'mouseup', { clientX: 100 });
  assert.deepEqual(turns, []);
});

const spotItems = [{ id: 'nas', type: 'app', label: 'NAS', href: 'https://nas.example.org/' }];
initSpotlight({
  getItems: () => spotItems,
  isMob: () => false,
  typeToOpen: () => true,
  CB: createDashboardState().CB,
  iconChain,
  openFolderDesktop,
  openFolderMobile,
  folderGlyph: mkFolderGlyph,
});
const spot = doc.getElementById('spot');

test('typing inside an open folder does not open Search over it', () => {
  const folder = doc.createElement('dialog');
  folder.className = 'folder-overlay';
  doc.body.appendChild(folder);
  folder.showModal();
  fire(doc.body, 'keydown', { key: 'n' });
  assert.equal(spot.open, false);
  folder.close();
  folder.remove();
  fire(doc.body, 'keydown', { key: 'n' });
  assert.equal(spot.open, true, 'typing on the bare page does not open Search');
});

test('Escape while composing text stays in Search', () => {
  if (!spot.open) fire(doc.body, 'keydown', { key: 'n' });
  const input = doc.getElementById('sin');
  fire(input, 'keydown', { key: 'Escape', isComposing: true, keyCode: 229 });
  assert.equal(spot.open, true, 'the IME cancel closed Search');
  fire(input, 'keydown', { key: 'Escape' });
  assert.equal(spot.open, false);
});

test('the result count is announced once typing pauses', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const live = doc.getElementById('sres-live');
  live.textContent = '';
  const input = doc.getElementById('sin');
  for (const v of ['n', 'na', 'nas']) {
    input.value = v;
    fire(input, 'input');
    t.mock.timers.tick(100);
  }
  assert.equal(live.textContent, '', 'a count was announced mid-word');
  t.mock.timers.tick(400);
  assert.equal(live.textContent, 'home.resultCount');
  assert.ok(doc.querySelector('#sres .sr'), 'the results waited for the announcement');
});

test('the search pill and the folder tiles say they open a dialog', () => {
  assert.equal(pillEl().getAttribute('aria-haspopup'), 'dialog');
  phone([{ id: 'f', type: 'folder', label: 'F', children: [] }]);
  assert.equal(doc.querySelector('.dyn-mob-btn').getAttribute('aria-haspopup'), 'dialog');
  const desktop = read('js/ui.js').slice(read('js/ui.js').indexOf('export function mkFolder('));
  assert.match(desktop.slice(0, desktop.indexOf('\n}\n')), /setAttribute\('aria-haspopup', 'dialog'\)/);
});

test('the Search pill keeps a readable label on a small phone', () => {
  assert.match(css, /#mob-search-pill \.msp-label \{\s*font-size:max\(11px, calc\(12px \* var\(--sc,1\)\)\)/);
  for (const vw of [320, 360, 393, 440]) {
    phone(apps(3), vw);
    const width = Number(/width:(\d+)px/.exec(pillEl().style.cssText)[1]);
    assert.ok(width >= 92, `${vw}: the pill is ${width}px`);
  }
});

test('the Search pill is toned from the wallpaper in both themes', () => {
  for (const tone of ['dark', 'light']) {
    applyLabelTones({ grid: null, tone });
    assert.equal(pillEl().getAttribute('data-tone'), tone);
  }
  assert.match(css, /\n#mob-search-pill\[data-tone="dark"\] \{\s*--pill-ink:var\(--pill-ink-light\);/);
  assert.match(css, /#mob-search-pill \.msp-label \{[^}]*color:var\(--pill-ink,#FFFFFF\)/);
  assert.doesNotMatch(
    css,
    /html\[data-theme="light"\] #mob-search-pill \.msp-label/,
    'a fixed ink is unreadable on clear glass',
  );
});

test('a search address is isolated from a right-to-left page', () => {
  const input = doc.getElementById('sin');
  input.value = 'nas';
  fire(input, 'input');
  const row = doc.querySelector('#sres .sr');
  assert.ok(row, 'no result for the query');
  assert.equal(row.querySelector('.srh').innerHTML, '<bdi>nas.example.org</bdi>');
  assert.doesNotMatch(row.style.cssText || '', /padding/, 'an inline padding hides the phone row size');
  assert.match(css, /\n\s*\.sr \{[^}]*gap:18px; padding:14px 20px/);
});

test('focus adds a ring and leaves the control shape alone', () => {
  const generic = css.slice(css.indexOf('a:focus-visible, button:focus-visible'), css.indexOf('#sin:focus-visible'));
  const first = generic.slice(0, generic.indexOf('}'));
  assert.doesNotMatch(first, /border-radius/);
  assert.match(generic, /\.folder-icon-link\):focus-visible \{ border-radius:8px; \}/);
});

test('the ring carries a dark line that reads on a bright wallpaper', () => {
  assert.match(css, /\.dot, [^{]*\):focus-visible \{\s*outline-offset:2px; box-shadow:0 0 0 2px rgba\(0,0,0,\.72\);/);
});

test('the contrast setting keeps the page dots hollow against filled', () => {
  const block = css.slice(css.indexOf('@media (prefers-contrast: more)'));
  assert.match(block, /\.dot \{ border-width:2px; \}/);
  assert.doesNotMatch(block.slice(0, block.indexOf('forced-colors')), /\.dot \{ background/);
});

test('folder dots are hollow against filled', () => {
  assert.match(rule('.folder-dot {'), /background:transparent; box-shadow:inset 0 0 0 1\.5px/);
  assert.match(css, /\.folder-dot\.on \{[^}]*box-shadow:none/);
});

test('the controls without a press state now have one', () => {
  assert.match(css, /#spot-cancel:active \{ opacity:\.6;/);
  assert.match(
    css,
    /:is\(\.empty-state-btn, \.api-error-btn, \.setup-btn\):not\(:disabled\):active \{ transform: scale\(\.97\)/,
  );
  assert.match(css, /\.dot:active \{ opacity:\.7; transition-duration:\.1s \}/);
});

test('reduced motion drops the press scale', () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*:is\(\.empty-state-btn, \.api-error-btn, \.setup-btn\):not\(:disabled\):active \{ transform: none; opacity: \.7;/,
  );
  assert.match(css, /\.dot\.on \{ transform: none !important; \}/);
});

test('hover effects need a real pointer', () => {
  assert.doesNotMatch(css, /@media \(hover:hover\) \{/);
  for (const sel of ['.sr:hover', '#photo-credit a:hover', '.empty-state-hint:hover', '.setup-reveal:hover']) {
    const at = css.indexOf(sel);
    assert.ok(at > -1, sel);
    assert.ok(css.slice(css.lastIndexOf('@media', at), at).startsWith('@media (hover:hover) and (pointer:fine)'), sel);
  }
  assert.match(css, /\.sr:active, \.sr\.sel \{/, 'a press must not depend on hover');
});

test('a held tile is neither selected nor previewed', () => {
  assert.match(css, /\.dyn-dock-icon\) \{ -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; \}/);
});

test('the setup prompt scrolls and its reveal button is full size', () => {
  assert.match(rule('.setup-prompt {'), /align-items: safe center;[^;]*;\s*overflow-y: auto|overflow-y: auto/);
  assert.match(rule('.setup-reveal {'), /width: 44px; height: 44px/);
  assert.match(css, /\.setup-field \.setup-pw \{ padding-inline-end: 52px; \}/);
});

test('the error pill never shows a link underline', () => {
  assert.match(rule('.api-error-btn   {'), /text-decoration: none/);
});

test('a badge value is clipped inside its pill', () => {
  assert.match(rule('.badge-txt {'), /min-width:0; overflow:hidden; text-overflow:ellipsis/);
});

test('the search arrow mirrors in a right-to-left page', () => {
  assert.match(css, /\.sra:dir\(rtl\) \{ transform:scaleX\(-1\) \}/);
});

test('a translucent card is glass, and solid with increased contrast', () => {
  const contrast = css.slice(css.indexOf('@media (prefers-contrast: more)'));
  assert.match(rule('.widget[data-card="translucent"],'), /background: var\(--glass-card\)/);
  assert.match(
    contrast,
    /\.mob-widget-card\[data-card="translucent"\] \{\s*background:var\(--glass-card-solid\);\s*backdrop-filter:none;/,
  );
});

test('reduced transparency gets solid surfaces after the theme rules', () => {
  const at = css.lastIndexOf('html[data-transparency="reduce"] {');
  assert.ok(
    at > css.indexOf('html[data-theme="light"] #spot { background:rgba(242,242,247,.9)'),
    'the light theme would win',
  );
  const block = css.slice(at);
  assert.match(block, /--glass-clear:rgba\(44,44,46,\.94\)/);
  assert.match(
    block,
    /html\[data-transparency="reduce"\]\[data-theme="light"\] \{ --glass-clear:rgba\(242,242,247,\.94\)/,
  );
});

test('no blur is stacked on a blurred parent, and the phone search blur is halved', () => {
  assert.doesNotMatch(rule('body:not(.is-mob) #sbox {'), /backdrop-filter/);
  assert.doesNotMatch(rule('body:not(.is-mob) #sres {'), /backdrop-filter/);
  assert.match(
    css,
    /:is\(\.folder-overlay, \.folder-overlay-mobile\) \.glass-surface \{\s*background:var\(--glass-folder\);\s*backdrop-filter:none;\s*\}/,
  );
  assert.doesNotMatch(css, /blur\(40px\)/);
});

test('the tap highlight and the double-tap wait are off for the whole shell', () => {
  assert.match(rule('html {'), /-webkit-tap-highlight-color:transparent/);
  assert.match(
    css,
    /:is\(#dock, #dots, #mob-search-pill, #spot, \.folder-overlay, \.folder-overlay-mobile\) \{ touch-action:manipulation; \}/,
  );
});

test('each page is contained, and never skipped from drawing', () => {
  assert.match(rule('.page {'), /contain:layout paint/);
  assert.match(rule('.mob-page {'), /contain:layout paint/);
  assert.doesNotMatch(css, /content-visibility/);
});
