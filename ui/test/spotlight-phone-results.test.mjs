import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fakeFetch, fire, installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const fetch = fakeFetch({ '/api/config': { items: [], settings: {} } });
const dom = installDom({ markup: pageBody('index.html'), fetch, location: 'http://nas.local/' });
const doc = dom.document;
const { createDashboardState } = await import('../js/dashboard-state.js');
const { initSpotlight } = await import('../js/spotlight.js');

const app = (id, label) => ({ id, type: 'app', label, href: `https://${id}.example.org/` });
const items = [
  app('seerr', 'Seerr'),
  app('settings', 'Settings'),
  app('files', 'Filebrowser'),
  app('ha', 'Home Assistant'),
  { id: 'media', type: 'folder', label: 'Media Library', items: [] },
];
const { CB } = createDashboardState();
initSpotlight({ getItems: () => items, isMob: () => true, typeToOpen: () => true, CB, iconChain: () => [] });

const input = doc.getElementById('sin');
const clear = doc.getElementById('spot-clear');
const spot = doc.getElementById('spot');
const type = value => {
  input.value = value;
  fire(input, 'input');
};
const labels = sel => [...doc.querySelectorAll(sel)].map(a => a.getAttribute('aria-label'));

test('an empty phone search shows no results', () => {
  CB.spotOpen('');
  assert.deepEqual(labels('#sres .sr'), []);
});

test('names that start with the query are the only results when there are any', () => {
  type('se');
  assert.deepEqual(labels('#sres .sr-tile'), ['Seerr', 'Settings']);
  assert.ok(!labels('#sres .sr').includes('Filebrowser'), 'a mid-word match was shown beside word starts');
});

test('a word inside a name counts as a start', () => {
  type('assist');
  assert.deepEqual(labels('#sres .sr'), ['Home Assistant']);
  type('lib');
  assert.deepEqual(labels('#sres .sr'), ['Media Library']);
});

test('a mid-word match is the fallback when no name starts with the query', () => {
  type('browser');
  assert.deepEqual(labels('#sres .sr'), ['Filebrowser']);
});

test('a single top match is a row, not a card', () => {
  type('file');
  assert.equal(doc.querySelectorAll('#sres .sr-tile').length, 0);
  assert.deepEqual(labels('#sres .sr'), ['Filebrowser']);
});

test('the x clears a query, then closes an empty search', () => {
  type('se');
  assert.equal(clear.hidden, false);
  assert.equal(clear.getAttribute('aria-label'), 'home.searchClear');
  fire(clear, 'click');
  assert.equal(input.value, '');
  assert.equal(spot.open, true, 'clearing closed search');
  assert.equal(clear.getAttribute('aria-label'), 'common.close');
  fire(clear, 'click');
  assert.equal(spot.open, false);
});
