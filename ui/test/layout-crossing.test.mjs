import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

const dom = installDom({ markup: pageBody('index.html'), location: 'http://nas.local/' });
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const { createLayout } = await import('../js/dashboard-layout.js');
const { createDesktopGrid } = await import('../js/dashboard-grid.js');
const { createBadges } = await import('../js/dashboard-badges.js');
const { initUI } = await import('../js/ui.js');

test('the phone layout rebuilds when the width changes, not the height', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dash = createDashboardState({ mob: true });
  const grid = { buildDesktop: () => 0, measure() {}, slots: () => 0 };
  const lay = createLayout({ dash, grid, pager: createPager(dash), wallpaper: { retone() {}, resampleBg() {} } });
  let queued = 0;
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {
    queued++;
    return raf(() => {});
  };
  try {
    globalThis.innerWidth = 393;
    lay.buildLayout();
    lay.watchResize();
    assert.equal(queued, 1);
    globalThis.innerHeight = 400;
    dom.window.dispatchEvent({ type: 'resize' });
    t.mock.timers.tick(200);
    assert.equal(queued, 1, 'a keyboard opening must not rebuild');
    globalThis.innerWidth = 430;
    dom.window.dispatchEvent({ type: 'resize' });
    t.mock.timers.tick(200);
    assert.equal(queued, 2);
    dom.window.dispatchEvent({ type: 'resize' });
    t.mock.timers.tick(200);
    assert.equal(queued, 2, 'the width must be recorded at every build');
  } finally {
    globalThis.requestAnimationFrame = raf;
    dom.flushFrames();
  }
});

test('the desktop build clears what the phone build left on the dock and pill', () => {
  const dash = createDashboardState();
  dash.items = [{ id: 'a', type: 'app', label: 'A', href: 'http://a.local', dock: true }];
  const badges = createBadges(dash);
  initUI({ items: dash.items, S: dash.S, CB: dash.CB, ...badges, widgetReg: dash.widgetReg });
  const dock = dom.document.getElementById('dock');
  const pill = dom.document.getElementById('mob-search-pill');
  dock.className = 'dyn-dock';
  dock.style.cssText = 'bottom:20px';
  pill.style.cssText = 'left:4px';
  pill.classList.add('paging');
  dash.CB.mobPillBump = () => {};
  dash.CB.mobPillSync = () => {};
  createDesktopGrid({ dash, badges, goTo() {} }).buildDesktop();
  assert.equal(dock.className, '');
  assert.equal(dock.style.cssText, '');
  assert.equal(pill.style.cssText, '');
  assert.ok(!pill.classList.contains('paging'));
  assert.equal(dash.CB.mobPillBump, null);
  assert.equal(dash.CB.mobPillSync, null);
  assert.equal(dock.children.length, 1, 'the dock was not rebuilt');
});

test('the phone swipe listener is taken off when the desktop chrome is reset', () => {
  const reset = ui.slice(ui.indexOf('export function resetMobileChrome()'));
  assert.match(reset, /removeEventListener\('touchend', clearOnTouch\)/, 'the phone swipe would page twice');
});
