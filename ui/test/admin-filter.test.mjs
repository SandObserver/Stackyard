/* The list filter hides rows that exist instead of rebuilding them, and says
   how many matched. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, fire, installDom, pageBody } from './fake-dom.mjs';

import { filterActive, itemMatchesFilter } from '../js/admin-logic.js';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const list = read('../js/admin-list.js');

test('the filter matches name, address and widget type, in any case', () => {
  const app = { type: 'app', label: 'Plex', href: 'http://media.local' };
  const widget = { type: 'widget', label: 'Clock', widgetType: 'analog' };
  assert.equal(itemMatchesFilter(app, { q: 'PLEX', type: 'all' }), true);
  assert.equal(itemMatchesFilter(app, { q: 'media', type: 'all' }), true);
  assert.equal(itemMatchesFilter(widget, { q: 'analog', type: 'all' }), true);
  assert.equal(itemMatchesFilter(app, { q: 'sonarr', type: 'all' }), false);
});

test('the type chip narrows the match', () => {
  const app = { type: 'app', label: 'Plex' };
  assert.equal(itemMatchesFilter(app, { q: '', type: 'all' }), true);
  assert.equal(itemMatchesFilter(app, { q: '', type: 'widget' }), false);
  assert.equal(itemMatchesFilter(app, { q: 'plex', type: 'widget' }), false);
});

test('only a query or a chip counts as filtering', () => {
  assert.equal(filterActive({ q: '', type: 'all' }), false);
  assert.equal(filterActive({ q: 'x', type: 'all' }), true);
  assert.equal(filterActive({ q: '', type: 'widget' }), true);
});

test('a filter change hides rows and does not rebuild them', () => {
  const apply = list.slice(
    list.indexOf('export function applyFilter'),
    list.indexOf('export function filterMatchCount'),
  );
  assert.match(apply, /showMatches\(g, empty\)/);
  assert.match(list, /r\.classList\.toggle\('d-none', !on\)/);
});

/* The page modules, on the real Settings markup. */
register('./js-root-hooks.mjs', import.meta.url);
const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { filter, state } = await import('../js/admin-state.js');
const listMod = await import('../js/admin-list.js');
const { initEditor, openEditor } = await import('../js/admin-editor.js');
const { initNav } = await import('../js/admin-nav.js');
listMod.initList({ openModal: () => {}, openFolderPicker: () => {}, save: async () => true });
listMod.wireFilter();
initEditor({ saveOrRevert: async () => true });
initNav();

const byId = id => dom.document.getElementById(id);
const search = byId('al-search');
const chip = flt => dom.document.querySelector(`#al-filter .chip[data-flt="${flt}"]`);
/* Six items: the filter bar only shows, and only keeps a query, from six. */
state.items = [
  ...['plex', 'sonarr', 'radarr', 'lidarr', 'bazarr'].map(id => ({
    id,
    type: 'app',
    label: id,
    href: `http://${id}.local`,
  })),
  { id: 'clock', type: 'widget', label: 'Clock', widgetType: 'analog' },
];
listMod.render();

/* Records each animate() call on one element. */
function animations(node) {
  const runs = [];
  node.animate = (...args) => {
    runs.push(args);
    return { cancel() {}, onfinish: null, oncancel: null };
  };
  return runs;
}

test('typing waits 120 ms, then filters unless Reorder began', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout'] });
  filter.q = '';
  search.value = ' plex ';
  fire(search, 'input');
  t2.mock.timers.tick(119);
  assert.equal(filter.q, '', 'the filter ran before the pause');
  t2.mock.timers.tick(1);
  assert.equal(filter.q, 'plex');

  listMod.setReordering(true);
  search.value = 'sonarr';
  fire(search, 'input');
  t2.mock.timers.tick(120);
  listMod.setReordering(false);
  assert.equal(filter.q, '', 'a query typed during Reorder was applied');
});

test('every filter change is announced with the match count', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout'] });
  const region = byId('sr-announce');
  search.value = 'plex';
  fire(search, 'input');
  t2.mock.timers.tick(120);
  t2.mock.timers.tick(100);
  assert.equal(region.textContent, t('list.matchCount', { count: 1 }));

  search.value = '';
  fire(search, 'input');
  t2.mock.timers.tick(120);
  t2.mock.timers.tick(100);
  chip('widget').click();
  assert.equal(filter.type, 'widget');
  assert.equal(chip('widget').getAttribute('aria-pressed'), 'true');
  assert.equal(chip('all').getAttribute('aria-pressed'), 'false');
  t2.mock.timers.tick(100);
  assert.equal(region.textContent, t('list.matchCount', { count: 1 }));
  chip('all').click();
  filter.q = '';
});

test('a keyboard press switches sections and pushes the editor without animation', () => {
  const link = dom.document.querySelector('.nl[data-sec="about"]');
  const about = animations(byId('sec-about'));
  link.dispatchEvent({ type: 'click', bubbles: true, detail: 0 });
  assert.equal(byId('sec-about').hidden, false);
  assert.equal(about.length, 0, 'a keyboard switch faded the section in');

  const general = animations(byId('sec-general'));
  dom.document.querySelector('.nl[data-sec="general"]').dispatchEvent({ type: 'click', bubbles: true, detail: 1 });
  assert.equal(general.length, 1, 'a pointer switch did not fade the section in');

  const edit = animations(byId('dash-edit-view'));
  dom.document.dispatchEvent({ type: 'click', detail: 0 });
  openEditor(null);
  assert.equal(edit.length, 0, 'a keyboard press animated the editor in');
  dom.document.dispatchEvent({ type: 'click', detail: 1 });
  openEditor(null);
  assert.equal(edit.length, 1, 'a pointer press did not animate the editor in');

  const glide = read('../js/glide-select.js');
  assert.match(glide, /pill\.classList\.add\('mp-snap'\)/);
});
