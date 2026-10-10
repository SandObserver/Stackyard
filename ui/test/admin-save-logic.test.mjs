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
  afterImport,
  restoreBody,
  restoresSettings,
  revertingSaves,
  serialWrites,
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
  assert.equal(buildAppItem({ href: 'http://x' }, null).errorKey, 'toast.nameRequired');
  assert.equal(buildAppItem({ label: 'A' }, null).errorKey, 'toast.urlRequired');
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

/* Every attempt yields the same id, so only the taken set keeps them apart. */
function fixedRandomness(t) {
  t.mock.method(Date, 'now', () => 0);
  t.mock.method(globalThis.crypto, 'getRandomValues', a => a.fill(0));
}

test('an id already taken is never returned, even when every attempt repeats it', t => {
  fixedRandomness(t);
  const generated = newItemId('App', 'app');
  assert.equal(newItemId('App', 'app', [generated]), 'App_2');
  assert.equal(newItemId('App', 'app', [generated, 'App_2', 'App_3']), 'App_4');
});

test('a retry is used when the first attempt is taken', t => {
  t.mock.method(Date, 'now', () => 0);
  let call = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', a => a.fill(call++));
  const first = newItemId('App', 'app');
  call = 0;
  const id = newItemId('App', 'app', [first]);
  assert.notEqual(id, first);
  assert.match(id, /^App_0/, 'a fresh random id, not the numbered fallback');
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

test('a new item skips an id the config already holds', t => {
  fixedRandomness(t);
  const generated = newItemId('App', 'app');
  const built = buildAppItem({ label: 'App', href: 'https://x.example' }, null, [generated]);
  assert.equal(built.item.id, 'App_2');
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

const saver = (write, restore = () => assert.fail('should not revert')) => revertingSaves({ write, restore });

test('a save keeps the change when the write lands', async () => {
  assert.equal(await saver(async () => true)(['before']), true);
});

test('a save puts the list back when the write reports failure', async () => {
  let restored = null;
  const ok = await saver(
    async () => false,
    s => {
      restored = s;
    },
  )(['before']);
  assert.equal(ok, false);
  assert.deepEqual(restored, ['before']);
});

test('a save restores and re-raises when the write throws', async () => {
  let restored = null;
  const save = saver(
    async () => {
      throw new Error('offline');
    },
    s => {
      restored = s;
    },
  );
  await assert.rejects(save(['before']), /offline/);
  assert.deepEqual(restored, ['before']);
});

test('a save treats a write that returns nothing as success', async () => {
  /* `save` is the only caller and returns a boolean, but a void write must not
     be read as a failure and silently undone. */
  assert.equal(await saver(async () => {})(['before']), true);
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

test('serialWrites runs a write asked for during another after it, not alongside or instead', async () => {
  const writes = serialWrites();
  const log = [];
  let release;
  const first = writes.run(async () => {
    log.push('first start');
    await new Promise(r => {
      release = r;
    });
    log.push('first end');
    return 1;
  });
  const second = writes.run(async () => {
    log.push('second');
    return 2;
  });
  await Promise.resolve();
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(log, ['first start', 'first end', 'second']);
});

test('serialWrites keeps going after a write fails', async () => {
  const writes = serialWrites();
  const failed = writes.run(async () => {
    throw new Error('offline');
  });
  const next = writes.run(async () => 'ran');
  await assert.rejects(failed, /offline/);
  assert.equal(await next, 'ran');
});

/* Each change edits the list, then saves it. Outcomes are answered in order. */
function listEditor(outcomes) {
  const writes = serialWrites();
  const editor = { list: ['a'], results: [] };
  const save = revertingSaves({
    write: () => writes.run(async () => outcomes.shift()),
    restore: s => {
      editor.list = s;
    },
  });
  editor.change = item => {
    const before = [...editor.list];
    editor.list = [...editor.list, item];
    return save(before).then(r => editor.results.push(r));
  };
  return editor;
}

test('a failed save with a later change waiting does not undo that change', async () => {
  const editor = listEditor([false, true]);
  await Promise.all([editor.change('b'), editor.change('c')]);
  assert.deepEqual(editor.results, [false, true]);
  assert.deepEqual(editor.list, ['a', 'b', 'c']);
});

test('two quick changes that both fail to save put back the list from before both', async () => {
  const editor = listEditor([false, false]);
  await Promise.all([editor.change('b'), editor.change('c')]);
  assert.deepEqual(editor.results, [false, false]);
  assert.deepEqual(editor.list, ['a']);
});

test('a failure handed on is dropped once a later save lands', async () => {
  const editor = listEditor([false, true, false]);
  await Promise.all([editor.change('b'), editor.change('c')]);
  await editor.change('d');
  assert.deepEqual(editor.list, ['a', 'b', 'c']);
});

/* Each write reads the server, then sends the list as it is at that moment.
   An import lands only when its post is answered. */
function serverEditor(outcomes) {
  const writes = serialWrites();
  const editor = { list: ['a'], server: ['a'], seen: '["a"]', results: [], reads: [], posts: [] };
  const gate = queue => new Promise(r => queue.push(r));
  const land = sent => {
    editor.server = sent;
    editor.seen = JSON.stringify(sent);
    save.landed([...sent]);
  };
  const save = revertingSaves({
    write: () =>
      writes.run(async () => {
        await gate(editor.reads);
        if (!outcomes.shift()) return false;
        land([...editor.list]);
        return true;
      }),
    restore: s => {
      editor.list = s;
    },
  });
  editor.change = item => {
    const before = [...editor.list];
    editor.list = [...editor.list, item];
    return save(before).then(r => editor.results.push(r));
  };
  editor.importItem = (item, { post = false } = {}) =>
    writes.run(async () => {
      await gate(editor.reads);
      const current = [...editor.server];
      if (post) await gate(editor.posts);
      editor.list = afterImport({
        local: editor.list,
        saved: JSON.parse(editor.seen),
        current,
        serverItems: editor.seen,
        newItems: [item],
      }).items;
      land([...current, item]);
    });
  const answer = async queue => {
    while (!queue.length) await new Promise(r => setTimeout(r));
    queue.shift()();
  };
  editor.answerRead = () => answer(editor.reads);
  editor.answerPost = () => answer(editor.posts);
  return editor;
}

test('a failed save keeps a change an earlier save already carried to the server', async () => {
  const editor = serverEditor([true, false]);
  const first = editor.change('b');
  const second = editor.change('c');
  await editor.answerRead();
  await editor.answerRead();
  await Promise.all([first, second]);
  assert.deepEqual(editor.results, [true, false]);
  assert.deepEqual(editor.server, ['a', 'b', 'c']);
  assert.deepEqual(editor.list, ['a', 'b', 'c']);
});

test('a failure handed on restores the list the server last took', async () => {
  const editor = serverEditor([true, false, false]);
  const first = editor.change('b');
  const second = editor.change('c');
  await editor.answerRead();
  await first;
  const third = editor.change('d');
  await editor.answerRead();
  await editor.answerRead();
  await Promise.all([second, third]);
  assert.deepEqual(editor.results, [true, false, false]);
  assert.deepEqual(editor.list, ['a', 'b', 'c']);
});

test('a failed save that no landed write carried still puts back its snapshot', async () => {
  const editor = serverEditor([true, false]);
  const first = editor.change('b');
  await editor.answerRead();
  await first;
  const second = editor.change('c');
  await editor.answerRead();
  await second;
  assert.deepEqual(editor.list, ['a', 'b']);
});

test('a failed save after an import lands keeps the imported items', async () => {
  const editor = serverEditor([true, false]);
  const first = editor.change('b');
  const imported = editor.importItem('X');
  const second = editor.change('c');
  await editor.answerRead();
  await first;
  await editor.answerRead();
  await imported;
  await editor.answerRead();
  await second;
  assert.deepEqual(editor.results, [true, false]);
  assert.deepEqual(editor.server, ['a', 'b', 'c', 'X']);
  assert.deepEqual(editor.list, ['a', 'b', 'c', 'X']);
});

test('a list change made while an import saves reaches the server', async () => {
  const editor = serverEditor([true]);
  const imported = editor.importItem('X', { post: true });
  await editor.answerRead();
  const change = editor.change('b');
  await editor.answerPost();
  await imported;
  assert.deepEqual(editor.list, ['a', 'b', 'X']);
  await editor.answerRead();
  await change;
  assert.deepEqual(editor.results, [true]);
  assert.deepEqual(editor.server, ['a', 'b', 'X']);
});

test('a failed save after an import that read before the change keeps the imported items', async () => {
  const editor = serverEditor([false, true]);
  const imported = editor.importItem('X', { post: true });
  await editor.answerRead();
  const change = editor.change('b');
  await editor.answerPost();
  await imported;
  await editor.answerRead();
  await change;
  assert.deepEqual(editor.results, [false]);
  assert.deepEqual(editor.server, ['a', 'X']);
  assert.deepEqual(editor.list, ['a', 'X']);
  const next = editor.change('c');
  await editor.answerRead();
  await next;
  assert.deepEqual(editor.server, ['a', 'X', 'c']);
});

test('an import on a stale page shows the server list and marks it stale', () => {
  const lists = { local: ['a'], saved: ['a'], current: ['a', 'z'], serverItems: '["a"]', newItems: ['X'] };
  assert.deepEqual(afterImport(lists), { items: ['a', 'z', 'X'], saved: ['a', 'z', 'X'], stale: true });
});

test('an import keeps a pending change on screen and records only what was saved', () => {
  const lists = { local: ['a', 'b'], saved: ['a'], current: ['a'], serverItems: '["a"]', newItems: ['X'] };
  assert.deepEqual(afterImport(lists), { items: ['a', 'b', 'X'], saved: ['a', 'X'], stale: false });
});

/* The server reshapes some fields, so the list it returns differs from the one this page sent. */
test('an import compares against the list this page sent, not the server copy', () => {
  const sent = [{ id: 'a', headers: [{ key: 'k', secret: false, value: 'v' }] }];
  const current = [{ id: 'a', headers: [{ key: 'k', value: 'v', secret: false }] }];
  const next = afterImport({
    local: sent,
    saved: sent,
    current,
    serverItems: JSON.stringify(current),
    newItems: [{ id: 'X' }],
  });
  assert.equal(JSON.stringify(next.saved), JSON.stringify(next.items));
});

test('a backup restores its own settings, schema version and items', () => {
  const live = { _rev: 4, _schemaVersion: 8, items: [{ id: 'a' }], settings: { theme: 'light' } };
  const file = { _schemaVersion: 6, items: [{ id: 'b' }], settings: { theme: 'dark', auth: { enabled: false } } };
  assert.deepEqual(restoreBody(file, live), {
    _rev: 4,
    _schemaVersion: 6,
    items: [{ id: 'b' }],
    settings: { theme: 'dark' },
  });
});

test('a backup without settings keeps the live ones', () => {
  const live = { _rev: 1, settings: { theme: 'light' } };
  assert.deepEqual(restoreBody({ items: [] }, live).settings, { theme: 'light' });
  assert.equal(restoresSettings({ items: [] }, live), false);
});

test('settings count as changed only when their data differs, ignoring key order and auth', () => {
  const live = { settings: { theme: 'dark', layout: { cols: 6, rows: 4 }, auth: { enabled: true } } };
  assert.equal(restoresSettings({ settings: { layout: { rows: 4, cols: 6 }, theme: 'dark' } }, live), false);
  assert.equal(restoresSettings({ settings: { theme: 'dark', layout: { cols: 6, rows: 4 }, auth: {} } }, live), false);
  assert.equal(restoresSettings({ settings: { theme: 'light', layout: { cols: 6, rows: 4 } } }, live), true);
  assert.equal(restoresSettings({ settings: { theme: 'dark' } }, live), true);
});

test('a backup that leaves out the host list does not count as a settings change', () => {
  const live = { settings: { theme: 'dark', server: { allowedHosts: ['home.lan'] } } };
  assert.equal(restoresSettings({ settings: { theme: 'dark' } }, live), false);
  assert.equal(restoresSettings({ settings: { theme: 'dark', server: {} } }, live), false);
  assert.equal(restoresSettings({ settings: { theme: 'dark', server: { allowedHosts: [] } } }, live), true);
});
