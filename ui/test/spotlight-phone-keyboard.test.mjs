import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { FakeElement, catalogRoutes, fakeFetch, fire, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const dom = installDom({
  markup: pageBody('index.html'),
  fetch: fakeFetch(catalogRoutes()),
  location: 'http://nas.local/',
});
const doc = dom.document;
FakeElement.prototype.scrollIntoView = () => {};
const vvListeners = {};
globalThis.visualViewport = {
  offsetTop: 0,
  height: 500,
  addEventListener: (name, fn) => {
    vvListeners[name] = fn;
  },
  removeEventListener: name => {
    delete vvListeners[name];
  },
};
const { initI18n } = await import('../js/i18n.js');
await initI18n('en');
const { createDashboardState } = await import('../js/dashboard-state.js');
const { initSpotlight } = await import('../js/spotlight.js');

const app = (id, label) => ({ id, type: 'app', label, href: `https://${id}.example.org/` });
const items = [
  'Sonarr',
  'Sabnzbd',
  'Syncthing',
  'Scrutiny',
  'Speedtest',
  'Stirling',
  'Shlink',
  'Semaphore',
  'Seerr',
  'Settings',
  'Home Server',
  'Plex',
  'سلام دنیا',
].map((label, i) => app('a' + i, label));
let mob = true;
const { CB } = createDashboardState();
initSpotlight({ getItems: () => items, isMob: () => mob, typeToOpen: () => true, CB, iconChain: () => [] });

const input = doc.getElementById('sin');
const res = doc.getElementById('sres');
const live = doc.getElementById('sres-live');
const spot = doc.getElementById('spot');
const ghost = doc.querySelector('.spot-ghost');
Object.defineProperty(input, 'selectionStart', { get: () => input.value.length, configurable: true });
input.scrollWidth = 100;
input.clientWidth = 100;

const type = value => {
  input.value = value;
  fire(input, 'input');
};
const key = k => fire(input, 'keydown', { key: k });
const selected = () => doc.getElementById(input.getAttribute('aria-activedescendant'));
const completion = () => (ghost.hidden ? null : doc.querySelector('.sg-rest').textContent);
const more = () => doc.querySelector('#sres .sr-more');

test('the completion names the option that Return opens', () => {
  CB.spotOpen('');
  type('se');
  assert.equal(selected().getAttribute('aria-label'), 'Semaphore');
  assert.equal(completion(), 'maphore');
  key('ArrowDown');
  assert.equal(selected().getAttribute('aria-label'), 'Seerr');
  assert.equal(completion(), 'err', 'the completion still names the first result');
  key('ArrowDown');
  key('ArrowDown');
  assert.equal(selected().getAttribute('aria-label'), 'Home Server');
  assert.equal(completion(), null, 'a name that does not start with the query was completed');
});

test('a right-to-left name gets no completion', () => {
  type('pl');
  assert.equal(completion(), 'ex');
  type('سل');
  assert.equal(selected().getAttribute('aria-label'), 'سلام دنیا');
  assert.equal(completion(), null);
});

test('Show More is an option of its group, and the group is named by its title only', () => {
  type('s');
  const b = more();
  assert.ok(b, 'no Show More for six more apps');
  assert.equal(b.tagName, 'DIV');
  assert.equal(b.getAttribute('role'), 'option');
  const group = b.closest('[role="group"]');
  assert.ok(group);
  assert.equal(doc.getElementById(group.getAttribute('aria-labelledby')).textContent, 'Apps');
  assert.equal(res.querySelectorAll('button').length, 0, 'a button sits inside the listbox');
});

test('Show More expands in place and keeps the cursor on itself', () => {
  type('s');
  const b = more();
  const firstRow = b.closest('[role="group"]').querySelector('.sr');
  const before = res.querySelectorAll('.sr').length;
  for (let i = 0; i < 20 && selected() !== b; i++) key('ArrowDown');
  assert.equal(selected()?.id, b.id, 'the arrow keys never reach Show More');
  key('Enter');
  assert.equal(spot.open, true, 'Return on Show More closed search');
  assert.ok(b.isConnected, 'the toggle was rebuilt');
  assert.ok(firstRow.isConnected, 'the rows were rebuilt');
  assert.equal(selected()?.id, b.id, 'the cursor left the toggle');
  assert.equal(b.textContent, 'Show Less');
  assert.equal(res.querySelectorAll('.sr').length, before + 3);
  key('Enter');
  assert.equal(b.textContent, 'Show More');
  assert.equal(res.querySelectorAll('.sr').length, before);
  assert.equal(selected()?.id, b.id);
});

test('a scroll that lifts on Show More does not toggle it', () => {
  type('s');
  const b = more();
  fire(b, 'touchstart', { changedTouches: [{ clientX: 0, clientY: 0 }], touches: [{}] });
  fire(b, 'touchmove', { changedTouches: [{ clientX: 0, clientY: 30 }] });
  fire(b, 'touchend', { changedTouches: [{ clientX: 0, clientY: 30 }] });
  assert.equal(b.textContent, 'Show More');
  fire(b, 'touchstart', { changedTouches: [{ clientX: 0, clientY: 0 }], touches: [{}] });
  fire(b, 'touchend', { changedTouches: [{ clientX: 0, clientY: 0 }] });
  assert.equal(b.textContent, 'Show Less');
});

test('the selection shows on touch screens only once the arrow keys move it', () => {
  type('s');
  assert.ok(!res.classList.contains('kbnav'));
  key('ArrowDown');
  assert.ok(res.classList.contains('kbnav'));
  type('se');
  assert.ok(!res.classList.contains('kbnav'), 'typing kept the keyboard highlight');
  const css = readFileSync(new URL('../css/dashboard.css', import.meta.url), 'utf8');
  assert.match(css, /body\.is-mob #sres:not\(\.kbnav\) \.sr-tile\.sel:not\(:active\) \{ background:transparent \}/);
});

test('the count names every match, not only the rows shown', async () => {
  type('s');
  await settle(450);
  assert.equal(live.textContent, '11 results');
});

test('emptying the field drops a pending count and resets the Return key', async () => {
  type('se');
  assert.equal(input.getAttribute('enterkeyhint'), 'go');
  type('');
  await settle(450);
  assert.equal(live.textContent, '');
  assert.equal(input.getAttribute('enterkeyhint'), 'search');
});

test('crossing to the desktop layout puts the edges back', () => {
  CB.spotClose();
  CB.spotOpen('');
  assert.equal(spot.style.bottom, '300px');
  mob = false;
  vvListeners.resize();
  dom.flushFrames();
  assert.equal(spot.style.top, '');
  assert.equal(spot.style.bottom, '');
  mob = true;
  CB.spotClose();
});
