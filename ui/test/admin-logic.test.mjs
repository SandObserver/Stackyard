import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reorderItems,
  isDockBlocked,
  nextActiveIndex,
  groupBounds,
  visibleFieldKeys,
  carriesTypedValues,
  visibleFieldFlags,
  collectFieldValues,
  clearsStoredSecret,
  authEnableBlocked,
  shouldWritePassword,
  widgetConfigMode,
  resolveAdminSection,
  rejectionLines,
  settingsSaveBlocker,
  clearsStoredPassword,
  recoversSession,
  toastMs,
  toastHoldMs,
  BLOCK,
} from '../js/admin-logic.js';
/* The real strength check, so these assert the rule the save actually applies. */
import { pwStrength } from '../js/password-strength.js';

test('reorderItems swaps top-level rows and reports whether it moved', () => {
  const items = [
    { id: 'a', type: 'app' },
    { id: 'b', type: 'app' },
    { id: 'c', type: 'app' },
  ];
  assert.equal(reorderItems(items, items[1], -1), true);
  assert.deepEqual(
    items.map(i => i.id),
    ['b', 'a', 'c'],
  );
  assert.equal(reorderItems(items, items[0], -1), false); // already at the top
  assert.deepEqual(
    items.map(i => i.id),
    ['b', 'a', 'c'],
  );
});

test('reorderItems skips items nested inside folders when ordering the top level', () => {
  const folder = { id: 'f', type: 'folder', children: ['x'] };
  const items = [folder, { id: 'x', type: 'app' }, { id: 'b', type: 'app' }];
  assert.equal(reorderItems(items, folder, 1), true); // folder moves past nested x to b's slot
  assert.deepEqual(
    items.map(i => i.id),
    ['b', 'x', 'f'],
  );
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
  /* provider holds a default but is itself hidden, so the field keyed on it
     must stay hidden too. */
  const fields = [
    { key: 'source' },
    { key: 'provider', default: 'scrutiny', showIf: { field: 'source', equals: 'disks' } },
    { key: 'scrutinyUrl', showIf: { field: 'provider', equals: 'scrutiny' } },
  ];
  const vals = { source: 'system', provider: 'scrutiny', scrutinyUrl: '' };
  const shown = visibleFieldKeys(fields, k => vals[k]);
  assert.deepEqual([...shown], ['source']);
});

/* Two tiles of one widget type each open the same form. Carrying values by type
   alone filled the second tile's form from the first, so a Beszel tile opened
   after a Glances one showed Glances as its source. */
test('typed values are carried within one editing session, never into the next', () => {
  const form = { getValues: () => ({}) };
  const opened = { form, type: 'system-summary', session: 4 };

  assert.equal(carriesTypedValues(opened, 'system-summary', 4), true, 'a re-render of the same open form');
  assert.equal(carriesTypedValues(opened, 'system-summary', 5), false, 'another widget of the same type');
  assert.equal(carriesTypedValues(opened, 'dns', 4), false, 'a different widget type');
  assert.equal(carriesTypedValues({ form: null, type: 'system-summary', session: 4 }, 'system-summary', 4), false);
  assert.equal(carriesTypedValues(null, 'system-summary', 4), false);
});

test('only the visible copy of a repeated key is saved', () => {
  /* The system summary declares its slot list once per source. Both are built,
     one is on screen, and the saved config must carry that one alone. */
  const fields = [
    { key: 'statProvider' },
    { key: 'slots', type: 'group', showIf: { field: 'statProvider', equals: 'system' } },
    { key: 'slots', type: 'group', showIf: { field: 'statProvider', equals: 'glances' } },
  ];
  const vals = { statProvider: 'glances' };
  const flags = visibleFieldFlags(fields, k => vals[k]);
  assert.deepEqual(flags, [true, false, true]);

  const saved = collectFieldValues([
    { field: fields[0], visible: true, kv: ['statProvider', 'glances'] },
    { field: fields[1], visible: false, kv: ['slots', [{ type: 'cpu', thermalZone: 0 }]] },
    { field: fields[2], visible: true, kv: ['slots', [{ type: 'temp', sensor: 'Core 0' }]] },
  ]);
  assert.deepEqual(saved.slots, [{ type: 'temp', sensor: 'Core 0' }]);
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

/* ── P10-3: a stale stored section blanked the admin page ────────────────────
   show() hides every section that is not the requested one, so a request naming
   a section that no longer exists hid all of them: an empty page, no active nav
   link, and nothing on screen to suggest what happened. The stored value came
   straight from localStorage, so anyone whose browser held a section name from
   an older version got that after upgrading, and only clearing site data fixed
   it. The `|| 'general'` fallback covered a missing value but not a stale one,
   which is the case that actually occurs. */

const SECTIONS = ['general', 'appearance', 'dashboard', 'about'];

test('a known section is used as asked', () => {
  for (const s of SECTIONS) assert.equal(resolveAdminSection(s, SECTIONS), s);
});

test('a section that no longer exists falls back rather than showing nothing', () => {
  assert.equal(resolveAdminSection('widgets', SECTIONS), 'general');
  assert.equal(resolveAdminSection('sec-pw', SECTIONS), 'general', 'a partial id is not a section either');
});

test('a missing stored value falls back', () => {
  for (const v of [null, undefined, '']) assert.equal(resolveAdminSection(v, SECTIONS), 'general');
});

test('junk falls back rather than throwing', () => {
  for (const v of [0, {}, [], true, 'general ']) {
    assert.doesNotThrow(() => resolveAdminSection(v, SECTIONS));
    assert.equal(resolveAdminSection(v, SECTIONS), 'general', `for ${JSON.stringify(v)}`);
  }
});

/* The fallback is the first section present, not a hard-coded name, so renaming
   or reordering the sections cannot reintroduce this. */
test('the fallback follows the sections that exist', () => {
  assert.equal(resolveAdminSection('nope', ['appearance', 'general']), 'appearance');
  assert.equal(resolveAdminSection('nope', ['solo']), 'solo');
});

test('the result is always one of the sections given', () => {
  for (const requested of ['general', 'gone', '', null, 'about']) {
    const got = resolveAdminSection(requested, SECTIONS);
    assert.ok(SECTIONS.includes(got), `${JSON.stringify(requested)} resolved to ${got}`);
  }
});

/* Only when the page genuinely has no sections, where show() has nothing to do
   and returns without touching anything. */
test('no sections at all resolves to null', () => {
  assert.equal(resolveAdminSection('general', []), null);
  assert.equal(resolveAdminSection('general', null), null);
  assert.equal(resolveAdminSection('general', [null, '']), null, 'empty entries do not count');
});

/* ── refused widgets ──────────────────────────────────────────────────────── */

/* A widget whose manifest is refused does not appear in the type list, which on
   its own is indistinguishable from never having installed it. The reasons
   already travel with /api/widgets; these turn them into lines the picker and
   the config editor both show, so the two cannot word a refusal differently. */

const REFUSALS = [
  { name: 'weather', errors: ['viewField "veiw" is not a declared field'] },
  { name: 'books', errors: ['widget.json is not valid JSON', 'name must match the folder name'] },
];

test('every reason becomes a line, named for the picker', () => {
  assert.deepEqual(rejectionLines(REFUSALS), [
    'weather: viewField "veiw" is not a declared field',
    'books: widget.json is not valid JSON',
    'books: name must match the folder name',
  ]);
});

/* The editor is already showing one widget, so repeating its name reads as a
   stutter. */
test('the name is left off when the caller is showing one widget', () => {
  assert.deepEqual(rejectionLines([REFUSALS[0]], { withName: false }), ['viewField "veiw" is not a declared field']);
});

/* The list is JSON off the API. A malformed entry must not render as
   "undefined: undefined" in front of someone already debugging a manifest. */
test('an entry that is not a named widget with reasons is dropped', () => {
  assert.deepEqual(
    rejectionLines([
      null,
      { errors: ['no name'] },
      { name: '', errors: ['empty name'] },
      { name: 'x' },
      { name: 'y', errors: 'not an array' },
      { name: 'z', errors: [] },
      { name: 'ok', errors: ['', '   ', 42, 'a real reason'] },
    ]),
    ['ok: a real reason'],
  );
});

test('a missing or non-array list is no lines rather than a throw', () => {
  for (const v of [undefined, null, {}, 'nope', 0]) {
    assert.deepEqual(rejectionLines(v), [], `${JSON.stringify(v)} should give no lines`);
  }
});

/* ── shouldWritePassword ──────────────────────────────────────────────────── */

/* Typing a password and switching protection off in the same save is a
   contradiction. Storing it first signed every other device out, because
   set-password rotates the session secret, and the toggle in the same save then
   deleted the password again. The round trip cost the user their sessions and
   left nothing behind, and the save reported success. */

test('a password typed while switching protection off is not written', () => {
  assert.equal(shouldWritePassword({ enabled: false, newPassword: 'correct-horse' }), false);
});

test('a password typed while switching protection on is written', () => {
  assert.equal(shouldWritePassword({ enabled: true, newPassword: 'correct-horse' }), true);
});

test('nothing is written when no password was typed', () => {
  assert.equal(shouldWritePassword({ enabled: true, newPassword: '' }), false);
  assert.equal(shouldWritePassword({ enabled: true, newPassword: undefined }), false);
  assert.equal(shouldWritePassword({ enabled: false, newPassword: '' }), false);
});

/* ── settingsSaveBlocker ──────────────────────────────────────────────────────
   Both rules used to be checked after the config had already been sent, so a
   refusal saved the title, language, log level and Docker fields and then
   reported only the password problem. Asking here, before the first write, is
   what makes a refusal leave the server untouched. */

/* Written the way saveServer calls it, passing the strength result alongside
   the password, so these exercise the rule as it really runs. */
const blockerFor = v => settingsSaveBlocker({ ...v, strength: pwStrength(v.newPassword) });

test('nothing blocks a save that changes no security setting', () => {
  assert.equal(blockerFor({ enabled: false, passwordSet: false, newPassword: '' }), null);
});

test('enabling auth with no password to back it is blocked', () => {
  const b = blockerFor({ enabled: true, passwordSet: false, newPassword: '' });
  assert.equal(b.reason, BLOCK.NEEDS_PASSWORD);
});

test('a weak new password is blocked, and carries the label to say why', () => {
  const b = blockerFor({ enabled: true, passwordSet: false, newPassword: 'abc' });
  assert.equal(b.reason, BLOCK.WEAK_PASSWORD);
  assert.ok(b.labelKey, 'the message names the strength that was reached');
});

test('a strong new password does not block', () => {
  assert.equal(blockerFor({ enabled: true, passwordSet: false, newPassword: 'correct-horse-9!' }), null);
});

test('the missing-password rule is checked before the strength rule', () => {
  /* Both could fire on the same save. The first is the one worth reporting: it
     says the switch cannot go on at all, rather than that the box is too weak. */
  const b = blockerFor({ enabled: true, passwordSet: false, newPassword: '' });
  assert.equal(b.reason, BLOCK.NEEDS_PASSWORD);
});

test('a weak password typed while switching protection off never blocks', () => {
  /* It is not stored, so its strength is not a reason to refuse the save. */
  assert.equal(blockerFor({ enabled: false, passwordSet: true, newPassword: 'abc' }), null);
});

test('an already-stored password is not re-examined when nothing new is typed', () => {
  assert.equal(blockerFor({ enabled: true, passwordSet: true, newPassword: '' }), null);
});

/* ── clearsStoredPassword ─────────────────────────────────────────────────── */

test('switching protection off with a password stored has to be confirmed', () => {
  assert.equal(clearsStoredPassword({ enabled: false, wasEnabled: true, passwordSet: true }), true);
});

test('switching protection off with no password stored has nothing to lose', () => {
  assert.equal(clearsStoredPassword({ enabled: false, wasEnabled: true, passwordSet: false }), false);
});

test('leaving protection on never clears a password', () => {
  assert.equal(clearsStoredPassword({ enabled: true, wasEnabled: true, passwordSet: true }), false);
});

test('a save that leaves protection off asks nothing, even with a stale password stored', () => {
  assert.equal(clearsStoredPassword({ enabled: false, wasEnabled: false, passwordSet: true }), false);
});

/* ── recoversSession ──────────────────────────────────────────────────────── */

test('a 401 on an ordinary write is a session to recover', () => {
  assert.equal(recoversSession('/api/config', 401), true);
  assert.equal(recoversSession('/api/auth/toggle', 401), true);
});

test('the two sign-in requests are answers, not sessions to recover', () => {
  assert.equal(recoversSession('/api/auth/check', 401), false);
  assert.equal(recoversSession('/api/auth/login', 401), false);
});

test('a query string does not hide the path', () => {
  assert.equal(recoversSession('/api/auth/check?x=1', 401), false);
});

test('only a 401 means the session, not any other failure', () => {
  /* An upstream service answering 401 arrives as a 502 carrying that status in
     its detail, so a failing badge never raises a sign-in box. */
  for (const s of [200, 400, 403, 500, 502]) assert.equal(recoversSession('/api/config', s), false, String(s));
});

test('recoversSession tolerates a missing path', () => {
  assert.equal(recoversSession(undefined, 401), true);
  assert.equal(recoversSession(null, 200), false);
});

test('an error waits to be dismissed, in both phases', () => {
  assert.equal(toastHoldMs('err', 'Wallpaper failed: image too large (max 16 MB)', 'show'), null);
  assert.equal(toastHoldMs('err', 'x', 'release'), null);
});

test('a confirmation still hides itself, and sooner once it has been read', () => {
  assert.equal(toastHoldMs('ok', 'Saved', 'show'), 3000);
  assert.equal(toastHoldMs('ok', 'x'.repeat(1000), 'show'), 15000);
  assert.equal(toastHoldMs('ok', 'x'.repeat(1000), 'release'), 1500);
});

test('toastMs holds a long message longer than a short one', () => {
  assert.equal(toastMs('Saved'), 3000);
  assert.equal(toastMs(''), 3000);
  assert.equal(toastMs('x'.repeat(100)), 6000);
  assert.equal(toastMs('x'.repeat(1000)), 15000);
  assert.equal(toastMs(undefined), 3000);
});
