import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mock, test } from 'node:test';
import { installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const dom = installDom({ markup: pageBody('index.html') });
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const { createLayout } = await import('../js/dashboard-layout.js');

const dash = createDashboardState({ mob: true });
const count = { resample: 0, phoneBuilds: 0, desktopBuilds: 0 };
const grid = /** @type {any} */ ({ buildDesktop: () => (count.desktopBuilds++, 1), measure() {}, slots: () => 1 });
const wallpaper = /** @type {any} */ ({ retone() {}, resampleBg: () => count.resample++ });
const layout = createLayout({ dash, grid, pager: createPager(dash), wallpaper });
globalThis.requestAnimationFrame = () => count.phoneBuilds++;
layout.buildLayout();
layout.watchOrientation();
const rotate = () => globalThis.screen.orientation.dispatchEvent({ type: 'change' });
const reset = () => Object.assign(count, { resample: 0, phoneBuilds: 0, desktopBuilds: 0 });

test('one rotation re-samples the wallpaper once, after the events settle', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    rotate();
    mock.timers.tick(100);
    rotate();
    rotate();
    mock.timers.tick(149);
    assert.equal(count.resample, 0, 'the rotation is not debounced');
    mock.timers.tick(1);
    assert.equal(count.resample, 1);
    assert.equal(count.phoneBuilds, 0, 'the space did not move, and the phone layout was rebuilt');
  } finally {
    mock.timers.reset();
  }
});

test('a rotation that moves the space rebuilds the phone layout', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    globalThis.innerWidth = 852;
    rotate();
    mock.timers.tick(150);
    assert.equal(count.phoneBuilds, 1);
    assert.equal(count.resample, 1);
    rotate();
    mock.timers.tick(150);
    assert.equal(count.phoneBuilds, 1, 'a second event for the same rotation rebuilt again');
  } finally {
    mock.timers.reset();
  }
});

test('a rotation on the desktop layout re-samples and rebuilds nothing', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    dash.mob = false;
    globalThis.innerWidth = 1280;
    rotate();
    mock.timers.tick(150);
    assert.deepEqual(count, { resample: 1, phoneBuilds: 0, desktopBuilds: 0 });
  } finally {
    dash.mob = true;
    mock.timers.reset();
  }
});

test.after(() => dom.restore());
