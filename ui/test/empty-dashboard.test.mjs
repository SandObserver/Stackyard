import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

import { installDom, pageBody } from './fake-dom.mjs';
import { inlineTokens } from './css-source.mjs';

register('./js-root-hooks.mjs', import.meta.url);
const dom = installDom({ markup: pageBody('index.html') });
const doc = dom.document;
const { isDashboardEmpty } = await import('../js/utils.js');
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createBadges } = await import('../js/dashboard-badges.js');
const { createDesktopGrid } = await import('../js/dashboard-grid.js');
const { initUI, buildMobile } = await import('../js/ui.js');
const { mobileMetrics } = await import('../js/mobile-metrics.js');

const SETTINGS = { id: 'settings', type: 'app', label: 'Settings', system: 'settings' };
const app = (id, more = {}) => ({ id, type: 'app', label: id, href: `http://${id}.local`, ...more });
/** Build the desktop layout for these items. @param {any[]} items @returns {number} pages */
function build(items) {
  const dash = createDashboardState();
  dash.items = items;
  const badges = createBadges(dash);
  initUI({ items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  return createDesktopGrid({ dash, badges, goTo() {} }).buildDesktop();
}
/** Build the phone layout for these items on a 393 by 852 screen. @param {any[]} items @returns {number} pages */
function phone(items) {
  const dash = createDashboardState({ mob: true });
  const badges = createBadges(dash);
  initUI({ items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  const size = [globalThis.innerWidth, globalThis.innerHeight];
  Object.assign(globalThis, { innerWidth: 393, innerHeight: 852 });
  try {
    return buildMobile();
  } finally {
    [globalThis.innerWidth, globalThis.innerHeight] = size;
  }
}
const pill = () => doc.getElementById('mob-search-pill');
const { relativeLuminance, contrastRatio, toneForLuminances } = await import('../js/label-contrast.js');

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => {
  const src = fs.readFileSync(path.join(uiDir, p), 'utf8');
  return p.endsWith('.css') ? inlineTokens(src) : src;
};

test('a config holding only the system settings item is empty', () => {
  assert.equal(isDashboardEmpty([{ id: 'settings', type: 'app', system: 'settings' }]), true);
});

test('a hidden app does not fill the dashboard', () => {
  assert.equal(
    isDashboardEmpty([
      { id: 'settings', system: 'settings' },
      { id: 'a', type: 'app', hidden: true },
    ]),
    true,
  );
});

test('one visible app fills the dashboard', () => {
  assert.equal(
    isDashboardEmpty([
      { id: 'settings', system: 'settings' },
      { id: 'a', type: 'app' },
    ]),
    false,
  );
});

test('a docked app fills the dashboard', () => {
  assert.equal(isDashboardEmpty([{ id: 'a', type: 'app', dock: true }]), false);
});

test('an absent or empty item list is empty', () => {
  assert.equal(isDashboardEmpty([]), true);
  assert.equal(isDashboardEmpty(undefined), true);
});

test('the desktop layout shows the placard only while the dashboard is empty', () => {
  build([SETTINGS]);
  assert.equal(doc.querySelectorAll('.empty-state').length, 1);
  assert.equal(doc.querySelector('.empty-state').parentElement, doc.body, 'a child of the page strip counts as a page');
  build([SETTINGS]);
  assert.equal(doc.querySelectorAll('.empty-state').length, 1, 'a rebuild stacked a second placard');
  build([SETTINGS, app('a')]);
  assert.equal(doc.querySelector('.empty-state'), null);
  phone([SETTINGS]);
  assert.equal(doc.querySelectorAll('.empty-state').length, 1, 'the phone layout has no placard');
  phone([SETTINGS, app('a')]);
  assert.equal(doc.querySelector('.empty-state'), null);
});

test('the desktop layout hides the dock and marks the body when nothing is docked', () => {
  build([app('a'), app('h', { dock: true, hidden: true })]);
  assert.equal(doc.getElementById('dock').hidden, true);
  assert.ok(doc.body.classList.contains('no-dock'));
  build([app('a'), app('d', { dock: true })]);
  assert.equal(doc.getElementById('dock').hidden, false);
  assert.ok(!doc.body.classList.contains('no-dock'));
  phone([app('a'), app('h', { dock: true, hidden: true })]);
  assert.equal(doc.getElementById('dock').hidden, true, 'the phone layout shows an empty dock');
  assert.ok(doc.body.classList.contains('no-dock'));
  phone([app('a'), app('d', { dock: true })]);
  assert.equal(doc.getElementById('dock').hidden, false);
  assert.ok(!doc.body.classList.contains('no-dock'));
});

test('the hidden dock is not painted', () => {
  assert.match(read('css/dashboard.css'), /#dock\[hidden\]\s*\{\s*display:\s*none\s*\}/);
});

test('the placard strings exist in every catalog', () => {
  for (const f of fs.readdirSync(path.join(uiDir, 'i18n'))) {
    const home = JSON.parse(read(path.join('i18n', f))).home;
    for (const k of ['emptyTitle', 'emptyBody', 'emptyAction']) assert.ok(home[k], `${f} is missing home.${k}`);
  }
});

test('the placard draws the logo from the icon set in the label colour', () => {
  build([]);
  const mark = doc.querySelector('.empty-state > svg');
  assert.equal(mark.getAttribute('class'), 'sy-icon empty-state-mark');
  assert.equal(mark.getAttribute('aria-hidden'), 'true');
  assert.equal(mark.querySelector('use').getAttribute('href'), '#sy-solid-logo');
  assert.match(read('css/dashboard.css'), /\.empty-state-mark\s*\{[^}]*color:\s*var\(--label-color\)/);
});

/* The placard sits on the wallpaper. A theme ink is black in a light system
   theme, which cannot be read on a dark photo. */
test('the placard text takes the tone measured on the wallpaper, not the theme', () => {
  const css = read('css/dashboard.css');
  const selector = /const LABEL_SELECTOR =\s*'([^']+)'/.exec(read('js/label-contrast.js'))[1];
  assert.ok(selector.split(/,\s*/).includes('.empty-state > *'), 'the placard is not toned');
  for (const part of ['mark', 'title', 'sub', 'btn', 'hint']) {
    const cls = `.empty-state-${part}`;
    assert.match(css, new RegExp(`\\${cls}\\[data-tone="dark"\\]\\s*\\{[^}]*color:`), `${cls} has no dark tone`);
    assert.doesNotMatch(css, new RegExp(`html\\[data-theme="light"\\][^{]*\\${cls}\\b`), `${cls} follows the theme`);
    const base = new RegExp(`(?:^|\\n)\\${cls} \\{([^}]*)\\}`).exec(css);
    assert.ok(base, `${cls} rule is gone`);
    assert.doesNotMatch(base[1], /--label-(?:primary|secondary)/, `${cls} takes a theme ink`);
  }
});

test('the placard title and explanation keep 4.5:1 on any single-colour wallpaper', () => {
  const css = read('css/dashboard.css');
  const token = name => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6});`).exec(css)?.[1];
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const ink = { light: token('--label-text'), dark: token('--label-text-dark') };
  assert.ok(ink.light && ink.dark, 'the placard text tones must be opaque');
  for (const part of ['title', 'sub']) {
    assert.match(css, new RegExp(`\\.empty-state-${part} \\{[^}]*color: var\\(--label-text\\);`));
    assert.match(
      css,
      new RegExp(`\\.empty-state-${part}\\[data-tone="dark"\\] \\{ color: var\\(--label-text-dark\\);`),
    );
  }
  for (let g = 0; g <= 255; g++) {
    const wall = relativeLuminance(g, g, g);
    const tone = toneForLuminances([wall]);
    const ratio = contrastRatio(relativeLuminance(...hex(ink[tone])), wall);
    assert.ok(ratio >= 4.5, `grey ${g}: ${ratio.toFixed(2)}:1`);
  }
});

test('both layouts drop the settings tile while the dashboard is empty', () => {
  build([SETTINGS]);
  assert.equal(doc.querySelector('#pages a[href="/admin/"]'), null);
  build([SETTINGS, app('a')]);
  assert.ok(doc.querySelector('#pages a[href="/admin/"]'), 'the settings tile is gone from a dashboard in use');
  phone([SETTINGS]);
  assert.equal(doc.querySelector('#pages a[href="/admin/"]'), null, 'the phone layout keeps it');
  phone([SETTINGS, app('a')]);
  assert.ok(doc.querySelector('#pages a[href="/admin/"]'));
});

test('the mobile search pill is hidden while the dashboard is empty', () => {
  phone([SETTINGS]);
  assert.match(pill().style.cssText, /display:none;/);
  phone([SETTINGS, app('a')]);
  assert.match(pill().style.cssText, /display:flex;/);
});

test('an undocked mobile layout reserves no dock height', () => {
  assert.equal(mobileMetrics(393, false).dh, 0);
  assert.ok(mobileMetrics(393, true).dh > 0);
  assert.equal(mobileMetrics(393).dh, mobileMetrics(393, true).dh, 'the default stays docked');
});

test('the dock reservation follows what is actually docked', () => {
  phone([app('a'), app('h', { dock: true, hidden: true })]);
  assert.equal(doc.body.style.getPropertyValue('--dh'), `${mobileMetrics(393, false, 852).dh}px`);
  phone([app('a'), app('d', { dock: true })]);
  assert.equal(doc.body.style.getPropertyValue('--dh'), `${mobileMetrics(393, true, 852).dh}px`);
  assert.notEqual(mobileMetrics(393, true, 852).dh, mobileMetrics(393, false, 852).dh);
});

/* Three rows need 3 tiles of 152 and 2 gaps of 30, plus the top reserve of 44
   and the bottom reserve: 204 with a dock, 68 without. */
test('the desktop slot maths uses the page padding reserves', () => {
  const css = read('css/dashboard.css');
  assert.match(css, /padding-block:clamp\(44px,4vh,70px\) 204px/);
  assert.match(css, /body\.no-dock \.page \{ padding-block-end:68px \}/);
  const tiles = Array.from({ length: 18 }, (_, i) => app(`a${i}`));
  const pages = (height, dock) => {
    globalThis.innerHeight = height;
    return build(dock ? [...tiles, app('d', { dock: true })] : tiles);
  };
  const fits = 3 * 152 + 2 * 30 + 44;
  assert.equal(pages(fits + 204, true), 1);
  assert.equal(pages(fits + 203, true), 2, 'the dock reserve is smaller than the page padding');
  assert.equal(pages(fits + 68, false), 1, 'an undocked page reserves the dock height');
  assert.equal(pages(fits + 67, false), 2);
  globalThis.innerHeight = 800;
});

test('the bottom reserve clears the page dots', () => {
  const css = read('css/dashboard.css');
  const dots = css.match(/#dots \{([^}]*)\}/)[1];
  const bottom = Number(dots.match(/bottom:(\d+)px/)[1]);
  const pad = Number(dots.match(/padding:(\d+)px/)[1]);
  const dotsTop = bottom + pad * 2 + 8 + 2;
  assert.ok(204 > dotsTop, `dots reach ${dotsTop}px from the bottom`);
  const noDock = Number(css.match(/body\.no-dock:not\(\.is-mob\) #dots \{ bottom:(\d+)px \}/)[1]);
  assert.ok(68 > noDock + pad * 2 + 8 + 2);
});

test('the import link opens the settings section that holds import', () => {
  build([]);
  assert.equal(
    doc.querySelector('.empty-state-hint').getAttribute('href'),
    '/admin/#general',
    'it lands wherever settings was left',
  );
  assert.equal(doc.querySelector('.empty-state-btn').getAttribute('href'), '/admin/');
  /* The section switch itself is checked in admin-nav.test.mjs. */
});

test('the welcome screen titles itself with a heading', () => {
  build([]);
  assert.equal(doc.querySelector('.empty-state-title').tagName, 'H2', 'the title is not a heading');
});
