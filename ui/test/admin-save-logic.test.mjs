import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanId, buildAppItem, newItemId, upsertItem, claimFolderChildren } from '../js/admin-save-logic.js';

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

/* ── P10-1: the edit target was an array position ────────────────────────────
   Saving did `state.items[state.eid] = item`, where eid was an index captured
   when the modal opened. A stale index wrote past the end, growing the array
   with holes; JSON turns those into nulls, and the server rejected the whole
   save with a message about missing ids, so the user lost the edit and the
   message did not describe what happened. */

test('an existing item is replaced in place', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const r = upsertItem(items, 'b', { id: 'b', label: 'edited' });
  assert.equal(r.replaced, true);
  assert.deepEqual(items.map(i => i.id), ['a', 'b', 'c'], 'order is preserved');
  assert.equal(items[1].label, 'edited');
});

test('an item that has moved is still found', () => {
  const items = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  upsertItem(items, 'a', { id: 'a', label: 'edited' });
  assert.equal(items[2].label, 'edited', 'position must not matter');
  assert.equal(items.length, 3);
});

/* The failure the index caused: holes that serialise as null. */
test('no holes are ever created', () => {
  const items = [{ id: 'a' }];
  upsertItem(items, 'gone', { id: 'new' });
  assert.equal(items.length, 2);
  assert.ok(items.every(i => i != null), `holes present: ${JSON.stringify(items)}`);
  assert.ok(!JSON.stringify({ items }).includes('null'));
});

test('an id that no longer exists appends rather than losing the edit', () => {
  const items = [{ id: 'a' }];
  const r = upsertItem(items, 'deleted-elsewhere', { id: 'new', label: 'my work' });
  assert.equal(r.replaced, false, 'so the toast says Added, not Updated');
  assert.deepEqual(items.map(i => i.id), ['a', 'new']);
});

test('adding a new item appends', () => {
  const items = [{ id: 'a' }];
  assert.equal(upsertItem(items, null, { id: 'b' }).replaced, false);
  assert.deepEqual(items.map(i => i.id), ['a', 'b']);
});

test('upsertItem tolerates a missing list', () => {
  assert.doesNotThrow(() => upsertItem(null, 'a', { id: 'a' }));
  assert.doesNotThrow(() => upsertItem(undefined, null, { id: 'a' }));
});

/* ── P10-2: an app could sit in two folders ──────────────────────────────────
   The "remove it from any existing folder first" step ran only when creating a
   folder, so editing an existing one and ticking an app already filed elsewhere
   left it in both, and the dashboard rendered it twice. */

test('claiming an app removes it from the folder it was in', () => {
  const items = [
    { id: 'f1', type: 'folder', children: ['app1', 'app2'] },
    { id: 'f2', type: 'folder', children: [] },
  ];
  claimFolderChildren(items, 'f2', ['app1']);
  assert.deepEqual(items[0].children, ['app2'], 'the old folder loses it');
});

/* The finding: this is the editing case, where the guard used to skip. */
test('editing a folder still clears the app from the others', () => {
  const items = [
    { id: 'f1', type: 'folder', children: ['app1'] },
    { id: 'f2', type: 'folder', children: ['app1'] },
  ];
  claimFolderChildren(items, 'f2', ['app1']);
  const holders = items.filter(f => f.children.includes('app1')).map(f => f.id);
  assert.deepEqual(holders, ['f2'], 'exactly one folder may hold it');
});

test('the folder doing the claiming is left alone', () => {
  const items = [{ id: 'f1', type: 'folder', children: ['app1'] }];
  claimFolderChildren(items, 'f1', ['app1']);
  assert.deepEqual(items[0].children, ['app1'], 'it must not remove its own children');
});

test('apps are not touched, only folders', () => {
  const items = [{ id: 'a1', type: 'app', children: ['app1'] }, { id: 'f1', type: 'folder', children: ['app1'] }];
  claimFolderChildren(items, 'f2', ['app1']);
  assert.deepEqual(items[0].children, ['app1'], 'an app is not a folder');
  assert.deepEqual(items[1].children, []);
});

test('claiming several apps at once works', () => {
  const items = [
    { id: 'f1', type: 'folder', children: ['a', 'b', 'c'] },
    { id: 'f2', type: 'folder', children: [] },
  ];
  claimFolderChildren(items, 'f2', ['a', 'c']);
  assert.deepEqual(items[0].children, ['b']);
});

test('claiming nothing changes nothing', () => {
  const items = [{ id: 'f1', type: 'folder', children: ['a'] }];
  claimFolderChildren(items, 'f2', []);
  assert.deepEqual(items[0].children, ['a']);
});

test('claimFolderChildren tolerates junk', () => {
  assert.doesNotThrow(() => claimFolderChildren(null, 'f', ['a']));
  assert.doesNotThrow(() => claimFolderChildren([null, 'x', { id: 'f', type: 'folder' }], 'g', ['a']));
});
