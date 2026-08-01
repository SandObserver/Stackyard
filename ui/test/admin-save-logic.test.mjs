import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanId, buildAppItem, newItemId } from '../js/admin-save-logic.js';

test('cleanId keeps alphanumerics, collapses the rest, and trims', () => {
  assert.equal(cleanId('My App!'), 'My_App');
  assert.equal(cleanId('  a--b  '), 'a_b');
  assert.equal(cleanId('abc123'), 'abc123');
});

test('cleanId falls back when nothing usable remains', () => {
  assert.equal(cleanId(''), 'item');
  assert.equal(cleanId('', 'widget'), 'widget');
  assert.equal(cleanId('!!!', 'folder'), 'folder');
});

test('buildAppItem validates name and url', () => {
  assert.match(buildAppItem({ href: 'http://x' }, null).error, /Name required/);
  assert.match(buildAppItem({ label: 'A' }, null).error, /URL required/);
});

test('buildAppItem builds a minimal app with disabled monitoring', () => {
  const { item } = buildAppItem({ label: 'My App', href: 'http://x', hcEn: false, actEn: false, scol: 'dark', spaths: [] }, null);
  assert.equal(item.type, 'app');
  assert.equal(item.label, 'My App');
  assert.equal(item.color, 'dark');
  assert.equal(item.monitoring.healthcheck.enabled, false);
  assert.equal(item.monitoring.activity.enabled, false);
  assert.equal(item.monitoring.staticBadge, undefined);
  assert.equal(item.skipTlsVerify, undefined);
  assert.match(item.id, /^My_App_/);
});

test('buildAppItem preserves an existing id and defaults color to dark', () => {
  const { item } = buildAppItem({ label: 'X', href: 'http://x', scol: '', spaths: [] }, { id: 'keep_me' });
  assert.equal(item.id, 'keep_me');
  assert.equal(item.color, 'dark');
});

test('buildAppItem enables healthcheck and activity from their fields', () => {
  const { item } = buildAppItem({
    label: 'A', href: 'http://x', hcEn: true, hcCon: 'nginx',
    actEn: true, actUrl: 'http://api', actInt: 45,
    actParams: [{ key: 'a', value: '1', secret: false }], actHeaders: [], spaths: ['stats.total'],
  }, null);
  assert.equal(item.monitoring.healthcheck.enabled, true);
  assert.equal(item.monitoring.healthcheck.container, 'nginx');
  assert.equal(item.monitoring.activity.enabled, true);
  assert.equal(item.monitoring.activity.interval, 45);
  assert.deepEqual(item.monitoring.activity.params, [{ key: 'a', value: '1', secret: false }]);
  assert.equal(item.monitoring.activity.headers, undefined); // empty -> omitted
  assert.equal(item.monitoring.activity.extract, 'stats.total');
});

test('buildAppItem maps multiple extract paths to objects', () => {
  const { item } = buildAppItem({ label: 'A', href: 'http://x', spaths: ['a', 'b'] }, null);
  assert.deepEqual(item.monitoring.activity.extract, [{ path: 'a' }, { path: 'b' }]);
});

test('buildAppItem builds custom and static badge objects only when meaningful', () => {
  const none = buildAppItem({ label: 'A', href: 'http://x', actColor: '#0289ff', custUnit: '', spaths: [] }, null).item;
  assert.equal(none.monitoring.activity.custom, undefined);
  const custom = buildAppItem({ label: 'A', href: 'http://x', actColor: '#ff0000', custUnit: 'GB', spaths: [] }, null).item;
  assert.deepEqual(custom.monitoring.activity.custom, { color: '#ff0000', unit: 'GB' });
  const stat = buildAppItem({ label: 'A', href: 'http://x', staticEn: true, staticLabel: 'VeryLongLabelHere', staticColor: 'red', spaths: [] }, null).item;
  assert.deepEqual(stat.monitoring.staticBadge, { enabled: true, label: 'VeryLongLa', color: 'red' });
});

/* ── P10-8: two items could be created with the same id ──────────────────────
   Ids were `cleanId(label) + '_' + Date.now()`, so two items created in the same
   millisecond took the same one. The odds understate it, because nothing
   downstream copes: every lookup is find(i => i.id === x), which returns the
   first match, so the second item's badge, widget config, health entry and
   folder membership all resolve to the first. */

test('an id is built from the label', () => {
  assert.match(newItemId('My App', 'app'), /^My_App_/);
  assert.match(newItemId('', 'widget'), /^widget_/, 'the fallback is used when nothing is usable');
  assert.match(newItemId('!!!', 'folder'), /^folder_/);
});

test('two ids made in the same millisecond differ', () => {
  /* The exact case the old scheme could not handle. */
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(newItemId('App', 'app'));
  assert.equal(ids.size, 200, 'every generated id should be distinct');
});

test('an id already in use is never returned', () => {
  const taken = new Set();
  for (let i = 0; i < 50; i++) {
    const id = newItemId('App', 'app', taken);
    assert.ok(!taken.has(id), `returned an id already taken: ${id}`);
    taken.add(id);
  }
});

test('taken ids may be given as an array or a set', () => {
  assert.doesNotThrow(() => newItemId('App', 'app', ['App_1', 'App_2']));
  assert.doesNotThrow(() => newItemId('App', 'app', new Set(['App_1'])));
  assert.doesNotThrow(() => newItemId('App', 'app'));
});

test('an id contains nothing that needs escaping in a URL or a filename', () => {
  for (const label of ['My App!', 'a/b', '../etc', '<script>', 'ünïcode']) {
    assert.match(newItemId(label, 'app'), /^[A-Za-z0-9_]+$/, `for ${label}`);
  }
});

test('editing an existing item keeps its id', () => {
  const built = buildAppItem({ label: 'X', href: 'https://x.example' }, { id: 'original_id' }, ['original_id']);
  assert.equal(built.item.id, 'original_id', 'an edit must not renumber the item');
});

test('a new item gets an id not already in the config', () => {
  const existing = ['App_aaa', 'App_bbb'];
  const built = buildAppItem({ label: 'App', href: 'https://x.example' }, null, existing);
  assert.ok(!existing.includes(built.item.id));
  assert.match(built.item.id, /^App_/);
});
