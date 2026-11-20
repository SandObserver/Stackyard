import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { installDom, pageBody } from './fake-dom.mjs';
import { clampPage } from '../js/dashboard-logic.js';

register('./js-root-hooks.mjs', import.meta.url);
const dom = installDom({ markup: pageBody('index.html'), location: 'http://nas.local/' });
const { showApiDown, showBuildFailed, tryBuild } = await import('../js/dashboard-screens.js');
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const { createLayout } = await import('../js/dashboard-layout.js');

const quiet = fn => {
  const error = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = error;
  }
};
const screens = () => dom.document.querySelectorAll('.api-error-screen').length;
const flushAll = () => {
  for (let i = 0; i < 4; i++) dom.flushFrames();
};
const reset = () => {
  quiet(flushAll);
  for (const s of dom.document.querySelectorAll('.api-error-screen')) s.remove();
  dom.document.body.classList.remove('api-down');
};

/** The layout with a stub desktop grid that builds the given page counts. */
function layout({ pages = [1], stored = null, mob = false } = {}) {
  reset();
  dom.storage.clear();
  if (stored !== null) dom.storage.set('dash_page', stored);
  const strip = dom.document.getElementById('pages');
  const dash = createDashboardState({ mob });
  const builds = { desktop: 0, slots: 24 };
  const grid = {
    buildDesktop() {
      builds.desktop++;
      const n = pages.shift();
      if (n instanceof Error) throw n;
      strip.innerHTML = '<div class="page"></div>'.repeat(n);
      return n;
    },
    measure() {},
    slots: () => builds.slots,
  };
  const wallpaper = { retone() {}, resampleBg() {}, applyBg() {} };
  const lay = createLayout({ dash, grid, pager: createPager(dash), wallpaper });
  return { dash, builds, lay };
}

test('a build that fails on every rebuild shows one error screen', () => {
  reset();
  quiet(() => {
    for (let i = 0; i < 3; i++)
      tryBuild(() => {
        throw new Error('build');
      });
  });
  assert.equal(screens(), 1);
  assert.equal(dom.document.querySelector('.api-error-screen').getAttribute('role'), 'alert');
});

test('the build error does not stack on the API-down screen', () => {
  reset();
  showApiDown();
  showBuildFailed();
  assert.equal(screens(), 1);
  assert.ok(dom.document.querySelector('.api-error-btn'));
});

test('a failing desktop build shows the error screen instead of throwing', () => {
  const { lay } = layout({ pages: [new Error('build')] });
  quiet(() => lay.buildLayout());
  assert.equal(screens(), 1);
});

test('a failing phone build shows the error screen instead of throwing', () => {
  const { lay } = layout({ mob: true });
  lay.buildLayout();
  quiet(flushAll);
  assert.equal(screens(), 1, 'the phone build ran without its guard');
});

test('a failing rebuild on resize shows the error screen instead of throwing', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { builds, lay } = layout({ pages: [1, new Error('build')] });
  lay.buildLayout();
  lay.watchResize();
  builds.slots = 18;
  quiet(() => {
    dom.window.dispatchEvent({ type: 'resize' });
    t.mock.timers.tick(200);
  });
  assert.equal(builds.desktop, 2, 'the resize did not rebuild');
  assert.equal(screens(), 1);
});

test('a resize that keeps the slot count does not rebuild', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { builds, lay } = layout({ pages: [1, 1] });
  lay.buildLayout();
  lay.watchResize();
  dom.window.dispatchEvent({ type: 'resize' });
  t.mock.timers.tick(200);
  assert.equal(builds.desktop, 1);
});

test('a rebuild with fewer pages lowers the page count and leaves no blank page', () => {
  const { dash, lay } = layout({ pages: [3, 2], stored: '2' });
  lay.buildLayout();
  assert.deepEqual([dash.totalPages, dash.pg], [3, 2]);
  lay.buildLayout();
  assert.equal(dash.totalPages, 2, 'the pager and the arrow keys still count the old pages');
  assert.equal(dash.pg, 1, 'the strip slid past its last page');
  assert.equal(dom.storage.get('dash_page'), '1');
});

test('a queued phone build does not run after the layout went back to desktop', () => {
  const { dash, builds, lay } = layout({ pages: [2], mob: true });
  lay.buildLayout();
  dash.mob = false;
  lay.buildLayout();
  quiet(flushAll);
  assert.equal(screens(), 0, 'phone pages were built on the desktop layout');
  assert.equal(builds.desktop, 1);
  assert.equal(dash.totalPages, 2);
  assert.ok(!dom.document.body.classList.contains('is-mob'));
});

test('the first build settles the first-build promise', async () => {
  const { lay } = layout({ pages: [1] });
  let settled = false;
  lay.firstBuild.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  lay.buildLayout();
  await Promise.resolve();
  assert.equal(settled, true);
});

test('the page is clamped to the pages that exist', () => {
  assert.equal(clampPage(2, 3), 2);
  assert.equal(clampPage(2, 2), 1);
  assert.equal(clampPage(-1, 3), 0);
  assert.equal(clampPage(5, 0), 0);
});
