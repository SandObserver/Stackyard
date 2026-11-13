/* Runs the dashboard's layout build and error screen from source, with the DOM
   and the two builders stubbed. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clampPage, restorePage } from '../js/dashboard-logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = fs.readFileSync(path.join(root, 'js/dashboard.js'), 'utf8');

const between = (from, to) => {
  const at = dashboard.indexOf(from);
  assert.ok(at > -1, `${from} moved`);
  return dashboard.slice(at, dashboard.indexOf(to, at));
};

const fakeBody = () => {
  const classes = new Set();
  const children = [];
  return {
    children,
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
    },
    appendChild: n => children.push(n),
  };
};

/** The error screen and the build guard, with a fake document. */
function errorScreens() {
  const src = between('function showErrorScreen(', '/** @param {HTMLElement} root @param {any} bg');
  const body = fakeBody();
  const document = {
    body,
    documentElement: { style: { removeProperty() {} } },
    createElement: () => ({ className: '', setAttribute() {}, querySelector: () => null }),
  };
  const fns = new Function(
    'document, setHtml, html, t, console, location',
    `${src} return { showApiDown, showBuildFailed, tryBuild };`,
  )(
    document,
    () => {},
    () => '',
    k => k,
    { error() {} },
    {},
  );
  return { ...fns, screens: () => body.children.filter(n => n.className === 'api-error-screen').length };
}

test('a build that fails on every rebuild shows one error screen', () => {
  const { tryBuild, screens } = errorScreens();
  for (let i = 0; i < 3; i++)
    tryBuild(() => {
      throw new Error('build');
    });
  assert.equal(screens(), 1);
});

test('the build error does not stack on the API-down screen', () => {
  const { showApiDown, showBuildFailed, screens } = errorScreens();
  showApiDown();
  showBuildFailed();
  assert.equal(screens(), 1);
});

test('every layout build goes through the failure guard', () => {
  const builds = dashboard.match(/totalPages = build(Mobile|Desktop)\(\);/g) || [];
  assert.equal(builds.length, 3, 'the phone build, the desktop build and the desktop resize');
  for (const at of [...dashboard.matchAll(/totalPages = build(Mobile|Desktop)\(\);/g)].map(m => m.index)) {
    assert.match(dashboard.slice(at - 40, at), /tryBuild\(\(\) => \{\s*$/);
  }
  assert.doesNotMatch(dashboard.replace(/totalPages = build(Mobile|Desktop)\(\);/g, ''), /totalPages = (?!0,)/);
});

/** buildLayout, with stubbed builders and a frame queue. */
function layout({ phonePages, desktopPages = 1, stored = null }) {
  const src = between('  let buildCall = 0;', '\n  buildLayout();');
  const frames = [];
  const calls = { mobile: 0, desktop: 0, goTo: [] };
  const page = { stored };
  const api = new Function(
    'frames, calls, page, phonePages, desktopPages, restorePage, clampPage',
    `
    let MOB = true, totalPages = 0, pg = 0;
    const innerWidth = 393;
    let _mw = 0, _saAt = '';
    const saSize = () => '';
    const document = { body: { classList: { add() {}, remove() {} } } };
    const requestAnimationFrame = fn => frames.push(fn);
    const tryBuild = fn => fn();
    const buildMobile = () => (calls.mobile++, phonePages.shift());
    const buildDesktop = () => (calls.desktop++, desktopPages);
    const storeGet = () => page.stored;
    const PAGE_STORE = 'dash_page';
    const CB = {};
    const loadVisibleIcons = () => {};
    const retone = () => {};
    const firstBuilt = () => {};
    const goTo = n => {
      pg = clampPage(n, totalPages);
      page.stored = String(pg);
      calls.goTo.push({ n, total: totalPages });
    };
    ${src}
    return {
      build: buildLayout,
      phone: on => { MOB = on; },
      state: () => ({ totalPages, pg }),
    };
    `,
  )(frames, calls, page, phonePages, desktopPages, restorePage, clampPage);
  const flush = () => {
    while (frames.length) frames.shift()();
  };
  return { ...api, calls, flush };
}

test('a phone rebuild with fewer pages lowers the page count and leaves no blank page', () => {
  const { state, calls, build, flush } = layout({ phonePages: [3, 2], stored: '2' });
  build();
  flush();
  assert.deepEqual(state(), { totalPages: 3, pg: 2 });
  build();
  flush();
  assert.equal(state().totalPages, 2, 'the pager and the arrow keys still count the old pages');
  assert.equal(state().pg, 1, 'the strip slid past its last page');
  assert.deepEqual(calls.goTo.at(-1), { n: 1, total: 2 });
});

test('a queued phone build does not run after the layout went back to desktop', () => {
  const { state, phone, calls, build, flush } = layout({ phonePages: [3], desktopPages: 2 });
  build();
  phone(false);
  build();
  flush();
  assert.equal(calls.mobile, 0, 'phone pages were built on the desktop layout');
  assert.equal(calls.desktop, 1);
  assert.equal(state().totalPages, 2);
});

test('the page is clamped to the pages that exist', () => {
  assert.equal(clampPage(2, 3), 2);
  assert.equal(clampPage(2, 2), 1);
  assert.equal(clampPage(-1, 3), 0);
  assert.equal(clampPage(5, 0), 0);
});

test('the state handed to ui.js holds only what ui.js reads', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const passed = /initUI\(\{ ([^}]+) \}\)/.exec(dashboard)?.[1].split(', ');
  assert.ok(passed, 'initUI call moved');
  const read = new Set([...ui.matchAll(/_state(?:\?)?\.(\w+)/g)].map(m => m[1]));
  assert.deepEqual([...passed].sort(), [...read].sort());
});
