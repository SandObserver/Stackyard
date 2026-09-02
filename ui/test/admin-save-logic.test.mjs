import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanId,
  buildAppItem,
  newItemId,
  upsertItem,
  claimFolderChildren,
  randomSuffix,
  snapshotItems,
  saveWithRevert,
} from '../js/admin-save-logic.js';

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
  const { item } = buildAppItem(
    { label: 'My App', href: 'http://x', hcEn: false, actEn: false, scol: 'dark', spaths: [] },
    null,
  );
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
  const { item } = buildAppItem(
    {
      label: 'A',
      href: 'http://x',
      hcEn: true,
      hcCon: 'nginx',
      actEn: true,
      actUrl: 'http://api',
      actInt: 45,
      actParams: [{ key: 'a', value: '1', secret: false }],
      actHeaders: [],
      spaths: ['stats.total'],
    },
    null,
  );
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
  const custom = buildAppItem(
    { label: 'A', href: 'http://x', actColor: '#ff0000', custUnit: 'GB', spaths: [] },
    null,
  ).item;
  assert.deepEqual(custom.monitoring.activity.custom, { color: '#ff0000', unit: 'GB', min: undefined });
  const stat = buildAppItem(
    { label: 'A', href: 'http://x', staticEn: true, staticLabel: 'VeryLongLabelHere', staticColor: 'red', spaths: [] },
    null,
  ).item;
  assert.deepEqual(stat.monitoring.staticBadge, { enabled: true, label: 'VeryLongLa', color: 'red' });
});

/* ── two items must not be created with the same id ──────────────────────────
   Nothing downstream copes with a duplicate. Every lookup is
   find(i => i.id === x), so the second item's badge, widget config, health
   entry and folder membership all resolve to the first. */

test('an id is built from the label', () => {
  assert.match(newItemId('My App', 'app'), /^My_App_/);
  assert.match(newItemId('', 'widget'), /^widget_/, 'the fallback is used when nothing is usable');
  assert.match(newItemId('!!!', 'folder'), /^folder_/);
});

/* Two items created in the same millisecond.

   Written the way every caller uses it, passing the ids already in the config.
   That is what makes uniqueness a guarantee rather than a probability. Omitting
   the taken set and asserting the guarantee anyway fails about one run in
   fifty. */
test('an id is never one already in the config', () => {
  const taken = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newItemId('App', 'app', taken);
    assert.ok(!taken.has(id), `returned an id already in use: ${id}`);
    taken.add(id);
  }
  assert.equal(taken.size, 200);
});

/* Without a taken set there is only randomness, so this asserts that a
   collision is rare enough that the loop above almost never runs.

   The suffix is measured directly, not through whole ids. An id also carries a
   timestamp, which advances during a long loop and supplies entropy the suffix
   did not, so a whole-id test passes with a weak suffix and fails only
   occasionally. */
test('the random suffix does not collide', () => {
  const seen = new Set();
  for (let i = 0; i < 20_000; i++) seen.add(randomSuffix());
  assert.equal(seen.size, 20_000, `${20_000 - seen.size} collisions in 20000 suffixes`);
});

test('a whole id carries that suffix', () => {
  const id = newItemId('App', 'app');
  assert.match(id, /^App_[a-z0-9]+$/);
  assert.ok(id.length > 'App_'.length + 12, `too little entropy in ${id}`);
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

/* ── the edit target is an id, not an array position ─────────────────────────
   An index captured when the modal opened goes stale and writes past the end,
   growing the array with holes. JSON turns those into nulls and the server
   rejects the whole save, so the user loses the edit to a message about missing
   ids. */

test('an existing item is replaced in place', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const r = upsertItem(items, 'b', { id: 'b', label: 'edited' });
  assert.equal(r.replaced, true);
  assert.deepEqual(
    items.map(i => i.id),
    ['a', 'b', 'c'],
    'order is preserved',
  );
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
  assert.ok(
    items.every(i => i != null),
    `holes present: ${JSON.stringify(items)}`,
  );
  assert.ok(!JSON.stringify({ items }).includes('null'));
});

test('an id that no longer exists appends rather than losing the edit', () => {
  const items = [{ id: 'a' }];
  const r = upsertItem(items, 'deleted-elsewhere', { id: 'new', label: 'my work' });
  assert.equal(r.replaced, false, 'so the toast says Added, not Updated');
  assert.deepEqual(
    items.map(i => i.id),
    ['a', 'new'],
  );
});

test('adding a new item appends', () => {
  const items = [{ id: 'a' }];
  assert.equal(upsertItem(items, null, { id: 'b' }).replaced, false);
  assert.deepEqual(
    items.map(i => i.id),
    ['a', 'b'],
  );
});

test('upsertItem tolerates a missing list', () => {
  assert.doesNotThrow(() => upsertItem(null, 'a', { id: 'a' }));
  assert.doesNotThrow(() => upsertItem(undefined, null, { id: 'a' }));
});

/* ── an app must not sit in two folders ──────────────────────────────────────
   The "remove it from any existing folder first" step runs when editing a
   folder as well as creating one, or the dashboard renders the app twice. */

test('claiming an app removes it from the folder it was in', () => {
  const items = [
    { id: 'f1', type: 'folder', children: ['app1', 'app2'] },
    { id: 'f2', type: 'folder', children: [] },
  ];
  claimFolderChildren(items, 'f2', ['app1']);
  assert.deepEqual(items[0].children, ['app2'], 'the old folder loses it');
});

/* The editing case, which is where the guard is easiest to miss. */
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
  const items = [
    { id: 'a1', type: 'app', children: ['app1'] },
    { id: 'f1', type: 'folder', children: ['app1'] },
  ];
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

test('snapshotItems detaches nested folder children', () => {
  const items = [{ id: 'f1', type: 'folder', children: ['a'] }];
  const copy = snapshotItems(items);
  items[0].children.push('b');
  items[0].label = 'renamed';
  assert.deepEqual(copy, [{ id: 'f1', type: 'folder', children: ['a'] }]);
});

test('snapshotItems tolerates junk', () => {
  assert.deepEqual(snapshotItems(null), []);
  assert.deepEqual(snapshotItems(undefined), []);
});

test('saveWithRevert keeps the change when the write lands', async () => {
  let restored = null;
  const ok = await saveWithRevert({
    write: async () => true,
    snapshot: ['before'],
    restore: s => {
      restored = s;
    },
  });
  assert.equal(ok, true);
  assert.equal(restored, null);
});

test('saveWithRevert puts the list back when the write reports failure', async () => {
  let restored = null;
  const ok = await saveWithRevert({
    write: async () => false,
    snapshot: ['before'],
    restore: s => {
      restored = s;
    },
  });
  assert.equal(ok, false);
  assert.deepEqual(restored, ['before']);
});

test('saveWithRevert restores and re-raises when the write throws', async () => {
  let restored = null;
  await assert.rejects(
    saveWithRevert({
      write: async () => {
        throw new Error('offline');
      },
      snapshot: ['before'],
      restore: s => {
        restored = s;
      },
    }),
    /offline/,
  );
  assert.deepEqual(restored, ['before']);
});

test('saveWithRevert treats a write that returns nothing as success', () => {
  /* `save` is the only caller and returns a boolean, but a void write must not
     be read as a failure and silently undone. */
  return saveWithRevert({
    write: async () => {},
    snapshot: ['before'],
    restore: () => assert.fail('should not revert'),
  }).then(ok => assert.equal(ok, true));
});

test('buildAppItem stores a badge minimum only above one', () => {
  const build = custMin =>
    buildAppItem({ label: 'A', href: 'http://x', actColor: '#0289ff', custUnit: '', custMin, spaths: [] }, null).item
      .monitoring.activity.custom;
  assert.equal(build(Number.NaN), undefined, 'an empty field stores nothing');
  assert.equal(build(1), undefined, 'one is the default and is not stored');
  assert.equal(build(0), undefined);
  assert.deepEqual(build(5), { color: undefined, unit: undefined, min: 5 });
});
