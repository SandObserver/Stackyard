/* The list filter hides rows that exist instead of rebuilding them, and says
   how many matched. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { filterActive, itemMatchesFilter } from '../js/admin-logic.js';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const list = read('../js/admin-list.js');
const admin = read('../js/admin.js');

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

test('typing waits 120 ms, then filters unless Reorder began', () => {
  assert.match(
    admin,
    /setTimeout\(\(\) => \{\s*if \(isReordering\(\)\) return;\s*filter\.q = s\.value\.trim\(\);\s*runFilter\(\);\s*\}, 120\)/,
  );
});

test('every filter change is announced with the match count', () => {
  const run = admin.slice(admin.indexOf('function runFilter'), admin.indexOf('async function _evDelete'));
  assert.match(run, /announce\(t\('list\.matchCount', \{ count: filterMatchCount\(\) \}\)\)/);
  assert.match(admin, /filter\.type = c\.dataset\.flt;\s*syncFilterUI\(\);\s*runFilter\(\);/);
});

test('a keyboard press switches sections and pushes the editor without animation', () => {
  assert.match(admin, /const keyboard = ev\?\.detail === 0;/);
  assert.match(admin, /picked && changed && !keyboard\) fadeOpacity/);
  assert.match(admin, /syncGlideSelect\(document, \{ snap: keyboard \}\)/);
  assert.match(admin, /if \(!_keyboardPress\) fadeIn\(el\('dash-list-view'\)\)/);
  assert.match(admin, /if \(!_keyboardPress\) fadeIn\(el\('dash-edit-view'\)\)/);
  const glide = read('../js/glide-select.js');
  assert.match(glide, /pill\.classList\.add\('mp-snap'\)/);
});
