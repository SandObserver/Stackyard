import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderItems, isDockBlocked, nextActiveIndex, groupBounds, visibleFieldKeys, clearsStoredSecret, authEnableBlocked, widgetConfigMode } from '../js/admin-logic.js';

test('reorderItems swaps top-level rows and reports whether it moved', () => {
  const items = [{ id: 'a', type: 'app' }, { id: 'b', type: 'app' }, { id: 'c', type: 'app' }];
  assert.equal(reorderItems(items, items[1], -1), true);
  assert.deepEqual(items.map(i => i.id), ['b', 'a', 'c']);
  assert.equal(reorderItems(items, items[0], -1), false); // already at the top
  assert.deepEqual(items.map(i => i.id), ['b', 'a', 'c']);
});

test('reorderItems skips items nested inside folders when ordering the top level', () => {
  const folder = { id: 'f', type: 'folder', children: ['x'] };
  const items = [folder, { id: 'x', type: 'app' }, { id: 'b', type: 'app' }];
  assert.equal(reorderItems(items, folder, 1), true); // folder moves past nested x to b's slot
  assert.deepEqual(items.map(i => i.id), ['b', 'x', 'f']);
});

test('reorderItems reorders a child within its folder', () => {
  const items = [{ id: 'f', type: 'folder', children: ['x', 'y', 'z'] }];
  assert.equal(reorderItems(items, null, 1, { folderId: 'f', childIdx: 0 }), true);
  assert.deepEqual(items[0].children, ['y', 'x', 'z']);
  assert.equal(reorderItems(items, null, -1, { folderId: 'f', childIdx: 0 }), false); // out of bounds
  assert.equal(reorderItems(items, null, 1, { folderId: 'missing', childIdx: 0 }), false);
});

test('isDockBlocked blocks a new app once the dock is full', () => {
  const items = [1, 2, 3, 4].map(n => ({ id: `a${n}`, type: 'app', dock: true }));
  assert.equal(isDockBlocked(items, { id: 'new', type: 'app' }), true);
  assert.equal(isDockBlocked(items.slice(0, 3), { id: 'new', type: 'app' }), false);
});

test('isDockBlocked never blocks an app already in the dock', () => {
  const items = [1, 2, 3, 4].map(n => ({ id: `a${n}`, type: 'app', dock: true }));
  assert.equal(isDockBlocked(items, items[0]), false);
});

test('isDockBlocked excludes the edited app from the count', () => {
  // four docked, one of them is the app being edited and is being un-docked
  const items = [1, 2, 3, 4].map(n => ({ id: `a${n}`, type: 'app', dock: true }));
  assert.equal(isDockBlocked(items, { id: 'a1', type: 'app', dock: false }), false);
});

test('isDockBlocked only counts docked apps, not widgets or folders', () => {
  const items = [
    ...[1, 2, 3].map(n => ({ id: `a${n}`, type: 'app', dock: true })),
    { id: 'w1', type: 'widget', dock: true },
    { id: 'f1', type: 'folder', dock: true },
    { id: 'a9', type: 'app', dock: false },
  ];
  assert.equal(isDockBlocked(items, { id: 'new', type: 'app' }), false);
});

test('isDockBlocked tolerates junk input', () => {
  assert.equal(isDockBlocked(null, null), false);
  assert.equal(isDockBlocked([null, undefined, {}], { id: 'new' }), false);
});

test('nextActiveIndex moves the active option and clamps at both ends', () => {
  assert.equal(nextActiveIndex('ArrowDown', 0, 3), 1);
  assert.equal(nextActiveIndex('ArrowUp', 2, 3), 1);
  assert.equal(nextActiveIndex('ArrowDown', 2, 3), 2, 'clamps, does not wrap');
  assert.equal(nextActiveIndex('ArrowUp', 0, 3), 0, 'clamps, does not wrap');
  assert.equal(nextActiveIndex('Home', 2, 3), 0);
  assert.equal(nextActiveIndex('End', 0, 3), 2);
});

test('nextActiveIndex ignores keys that do not move the active option', () => {
  for (const k of ['Enter', ' ', 'Escape', 'Tab', 'a']) {
    assert.equal(nextActiveIndex(k, 1, 3), null, k);
  }
});

test('nextActiveIndex handles an empty list', () => {
  assert.equal(nextActiveIndex('ArrowDown', -1, 0), null);
  assert.equal(nextActiveIndex('Home', -1, 0), null);
});

test('nextActiveIndex recovers from an out-of-range active index', () => {
  assert.equal(nextActiveIndex('ArrowDown', 99, 3), 2);
  assert.equal(nextActiveIndex('ArrowUp', -5, 3), 0);
});

test('groupBounds defaults to an open-ended list', () => {
  assert.deepEqual(groupBounds({}, 'medium'), { min: 0, max: 99 });
  assert.deepEqual(groupBounds({ min: 1, max: 5 }, 'medium'), { min: 1, max: 5 });
});

test('groupBounds applies maxBySize and falls back to max for unlisted sizes', () => {
  const f = { min: 1, max: 5, maxBySize: { small: 2 } };
  assert.deepEqual(groupBounds(f, 'small'), { min: 1, max: 2 });
  assert.deepEqual(groupBounds(f, 'medium'), { min: 1, max: 5 });
});

test('groupBounds pins both bounds from countBySize and outranks min/max', () => {
  const f = { min: 1, max: 9, maxBySize: { medium: 7 }, countBySize: { small: 1, medium: 3 } };
  assert.deepEqual(groupBounds(f, 'small'), { min: 1, max: 1 });
  assert.deepEqual(groupBounds(f, 'medium'), { min: 3, max: 3 });
});

test('groupBounds ignores countBySize for a size it does not name', () => {
  assert.deepEqual(groupBounds({ min: 1, max: 4, countBySize: { small: 1 } }, 'large'), { min: 1, max: 4 });
});

test('visibleFieldKeys hides a field whose controlling field is hidden', () => {
  /* network toggle off: mode is hidden, so provider and url (keyed on mode)
     must also be hidden even though mode still holds its default. */
  const fields = [
    { key: 'enabled' },
    { key: 'mode', showIf: { field: 'enabled', equals: true } },
    { key: 'provider', showIf: { field: 'mode', equals: 'speed' } },
    { key: 'url', showIf: { field: 'mode', equals: 'speed' } },
  ];
  const vals = { enabled: false, mode: 'speed', provider: 'myspeed', url: 'x' };
  const shown = visibleFieldKeys(fields, k => vals[k]);
  assert.deepEqual([...shown], ['enabled']);
});

test('visibleFieldKeys shows the chain once the toggle is on', () => {
  const fields = [
    { key: 'enabled' },
    { key: 'mode', showIf: { field: 'enabled', equals: true } },
    { key: 'provider', showIf: { field: 'mode', equals: 'speed' } },
  ];
  const vals = { enabled: true, mode: 'speed', provider: 'myspeed' };
  const shown = visibleFieldKeys(fields, k => vals[k]);
  assert.deepEqual([...shown].sort(), ['enabled', 'mode', 'provider']);
});

test('visibleFieldKeys does not leak a field across a hidden branch default', () => {
  /* diskProvider defaults to scrutiny but is hidden under the system-summary
     view, so scrutinyUrl (keyed on diskProvider) must stay hidden. */
  const fields = [
    { key: 'widgetSubType' },
    { key: 'diskProvider', default: 'scrutiny', showIf: { field: 'widgetSubType', equals: 'disk-health' } },
    { key: 'scrutinyUrl', showIf: { field: 'diskProvider', equals: 'scrutiny' } },
  ];
  const vals = { widgetSubType: 'system-summary', diskProvider: 'scrutiny', scrutinyUrl: '' };
  const shown = visibleFieldKeys(fields, k => vals[k]);
  assert.deepEqual([...shown], ['widgetSubType']);
});

test('visibleFieldKeys evaluates a condition on a field outside the sibling set directly', () => {
  /* dep is not among the siblings (e.g. a parent-level key): fall back to the
     raw condition rather than treating it as hidden. */
  const fields = [{ key: 'a', showIf: { field: 'outside', equals: 'yes' } }];
  assert.deepEqual([...visibleFieldKeys(fields, () => 'yes')], ['a']);
  assert.deepEqual([...visibleFieldKeys(fields, () => 'no')], []);
});

test('visibleFieldKeys shows unconditional fields and tolerates a cycle', () => {
  assert.deepEqual([...visibleFieldKeys([{ key: 'x' }, { key: 'y' }], () => undefined)], ['x', 'y']);
  const cyc = [
    { key: 'a', showIf: { field: 'b', equals: 1 } },
    { key: 'b', showIf: { field: 'a', equals: 1 } },
  ];
  assert.doesNotThrow(() => visibleFieldKeys(cyc, () => 1));
});

/* ── clearsStoredSecret (P11-1) ───────────────────────────────────────────── */

/* Unticking Secret used to leave valueSet:true on the row, so the form kept
   sending "keep the stored value" for a row the server now treats as public.
   Paired with the server refusing to refill a non-secret row, this is what makes
   unticking mean "clear it" on both sides instead of "reveal it". */

test('unticking Secret on a stored credential clears it', () => {
  assert.equal(clearsStoredSecret({ value: '', valueSet: true, secret: true }, false), true);
});

test('ticking Secret on never clears anything', () => {
  assert.equal(clearsStoredSecret({ value: '', valueSet: true, secret: false }, true), false);
});

test('unticking a row the user has typed into leaves the typed value alone', () => {
  assert.equal(clearsStoredSecret({ value: 'typed', valueSet: false, secret: true }, false), false);
});

test('unticking an empty row with nothing stored is a no-op', () => {
  assert.equal(clearsStoredSecret({ value: '', valueSet: false, secret: true }, false), false);
});

test('clearsStoredSecret tolerates a missing row', () => {
  assert.equal(clearsStoredSecret(null, false), false);
  assert.equal(clearsStoredSecret(undefined, false), false);
});

/* ── authEnableBlocked (P2-2) ─────────────────────────────────────────────── */

/* Mirrors the server's refusal so the user is told before the save runs. Auth
   switched on with no password locks the install: every login is refused
   because there is nothing to check against, while everything else is gated. */

test('enabling auth with no password and none typed is blocked', () => {
  assert.equal(authEnableBlocked({ enabled: true, passwordSet: false, newPassword: '' }), true);
});

test('enabling auth is allowed when a password is already set', () => {
  assert.equal(authEnableBlocked({ enabled: true, passwordSet: true, newPassword: '' }), false);
});

test('enabling auth is allowed when a password is being set in the same save', () => {
  assert.equal(authEnableBlocked({ enabled: true, passwordSet: false, newPassword: 'correct-horse' }), false);
});

test('disabling auth is never blocked', () => {
  assert.equal(authEnableBlocked({ enabled: false, passwordSet: false, newPassword: '' }), false);
});

test('authEnableBlocked tolerates a missing password field', () => {
  assert.equal(authEnableBlocked({ enabled: true, passwordSet: false }), true);
});

/* ── widgetConfigMode (P6-1) ──────────────────────────────────────────────── */

/* A registry widget whose manifest is not loaded used to fall through to the
   custom iframe editor, which is misleading: it is not a custom widget. The
   server also withholds its stored config in that state, so there is nothing to
   edit and empty fields would look like lost settings. */

test('a widget with a loaded manifest gets the registry form', () => {
  assert.equal(widgetConfigMode('books', { books: {} }), 'registry');
});

test('a custom iframe widget gets the custom form', () => {
  assert.equal(widgetConfigMode('custom', { books: {} }), 'custom');
});

test('a widget whose manifest is missing is unavailable, not custom', () => {
  assert.equal(widgetConfigMode('books', {}), 'unavailable');
  assert.equal(widgetConfigMode('no-such-widget', { books: {} }), 'unavailable');
});

test('widgetConfigMode tolerates a missing registry', () => {
  assert.equal(widgetConfigMode('books', null), 'unavailable');
  assert.equal(widgetConfigMode('custom', null), 'custom');
});
