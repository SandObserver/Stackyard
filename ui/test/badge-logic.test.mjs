import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBadgeVisual,
  needsDark,
  resolveColor,
  NAMED,
  healthReason,
  badgeSignature,
  readBadgeUpdate,
  badgeMinimum,
  firingLabels,
  LABEL_DEFAULT_COLOR,
  MAX_LABELS,
  safeColor,
} from '../js/badge-logic.js';

test('unhealthy takes priority over everything else', () => {
  const v = computeBadgeVisual({
    health: true,
    activity: 5,
    staticBdg: { enabled: true, label: 'x' },
    hasHC: true,
    hideHealthy: false,
  });
  assert.ok(v.cls.startsWith('badge on red'));
  assert.equal(v.txt, '!');
  assert.ok(v.aria.startsWith('Status: needs attention'));
});

test('a health failure keeps the pill and puts everything else in the list', () => {
  const v = computeBadgeVisual({
    health: true,
    labels: [{ path: 'a', name: 'pending', unit: 'pending' }],
    values: [4],
    staticBdg: { enabled: true, label: 'backup', color: 'gray' },
    hasHC: true,
  });
  assert.equal(v.txt, '!', 'the pill still reports the failure');
  assert.ok(v.cls.includes('has-more'));
  assert.deepEqual(
    v.rows.map(r => r.name),
    ['Status: needs attention', 'pending', 'backup'],
  );
});

test('a live value outranks a fixed label, which drops to the list', () => {
  const v = computeBadgeVisual({
    labels: [{ path: 'a', name: 'pending', unit: 'pending' }],
    values: [4],
    staticBdg: { enabled: true, label: 'backup', color: 'gray' },
  });
  assert.equal(v.txt, '4 pending');
  assert.deepEqual(
    v.rows.map(r => r.name),
    ['pending', 'backup'],
  );
});

test('activity takes priority over a static label and the healthy dot', () => {
  const v = computeBadgeVisual({
    activity: 3,
    staticBdg: { enabled: true, label: 'x' },
    hasHC: true,
    hideHealthy: false,
  });
  assert.ok(v.cls.startsWith('badge on blue'));
  assert.equal(v.txt, '3');
  assert.equal(v.aria.split('.')[0], '3 pending');
});

test('a static label takes the pill when nothing is firing', () => {
  const v = computeBadgeVisual({ staticBdg: { enabled: true, label: 'x' }, hasHC: true, hideHealthy: false });
  assert.equal(v.txt, 'x');
});

test('activity takes the pill when there is no fixed label', () => {
  const v = computeBadgeVisual({ activity: 3, hasHC: true, hideHealthy: false });
  assert.equal(v.cls, 'badge on blue');
  assert.equal(v.txt, '3');
  assert.equal(v.aria, '3 pending');
});

test('one badge alone advertises no list', () => {
  const only = computeBadgeVisual({ staticBdg: { enabled: true, label: 'x' } });
  assert.equal(only.more, 0);
  assert.deepEqual(only.rows, []);
  const healthy = computeBadgeVisual({ hasHC: true, hideHealthy: false });
  assert.equal(healthy.cls, 'badge on green');
  assert.equal(healthy.more, 0, 'the healthy dot reports nothing a list could add');
});

test('the badge count that opens a list is two, in priority order', () => {
  const v = computeBadgeVisual({
    health: true,
    staticBdg: { enabled: true, label: 'backup' },
    labels: [
      { path: 'a', name: 'errors' },
      { path: 'b', name: 'pending' },
    ],
    values: [1, 2],
    hasHC: true,
  });
  assert.deepEqual(
    v.rows.map(r => r.name),
    ['Status: needs attention', 'errors', 'pending', 'backup'],
  );
  assert.equal(v.more, 3);
});

test('activity caps displayed count at 99+', () => {
  const v = computeBadgeVisual({ activity: 150 });
  assert.equal(v.txt, '99+');
  assert.equal(v.aria, '99+ pending');
});

test('activity appends a truncated unit', () => {
  const v = computeBadgeVisual({ activity: 4, custom: { unit: 'downloads waiting' } });
  assert.equal(v.txt, '4 download');
  assert.equal(v.aria, '4 downloads waiting pending');
});

test('static label takes priority over the healthy dot', () => {
  const v = computeBadgeVisual({ staticBdg: { enabled: true, label: 'Maintenance' }, hasHC: true, hideHealthy: false });
  assert.equal(v.cls, 'badge on blue');
  assert.equal(v.txt, 'Maintenanc');
  assert.equal(v.aria, 'Maintenance');
});

test('static label is truncated to 10 characters', () => {
  const v = computeBadgeVisual({ staticBdg: { enabled: true, label: 'Way too long a label' } });
  assert.equal(v.txt, 'Way too lo');
});

test('healthy dot shows only when hideHealthy is off and a health check exists', () => {
  const shown = computeBadgeVisual({ hasHC: true, hideHealthy: false });
  assert.equal(shown.cls, 'badge on green');
  assert.equal(shown.aria, 'Status: healthy');

  const hiddenByPref = computeBadgeVisual({ hasHC: true, hideHealthy: true });
  assert.equal(hiddenByPref.cls, 'badge');
  assert.equal(hiddenByPref.aria, '');

  const noHealthCheck = computeBadgeVisual({ hasHC: false, hideHealthy: false });
  assert.equal(noHealthCheck.cls, 'badge');
});

test('stale flag is appended only for the signal currently shown', () => {
  const staleActivity = computeBadgeVisual({ activity: 2, badgesStale: true, healthStale: false });
  assert.ok(staleActivity.cls.includes('stale'));
  assert.match(staleActivity.aria, /may be out of date/);

  const staleHealthDot = computeBadgeVisual({ hasHC: true, hideHealthy: false, healthStale: true });
  assert.ok(staleHealthDot.cls.includes('stale'));

  const activityIgnoresHealthStale = computeBadgeVisual({ activity: 2, healthStale: true, badgesStale: false });
  assert.ok(!activityIgnoresHealthStale.cls.includes('stale'));
});

test('resolveColor maps named colors and passes through raw hex', () => {
  assert.equal(resolveColor('blue'), NAMED.blue);
  assert.equal(resolveColor('#ff0000'), '#ff0000');
  assert.equal(resolveColor(''), '');
  assert.equal(resolveColor(undefined), '');
});

test('needsDark picks dark text only where white cannot be read', () => {
  assert.equal(needsDark('#ffcc00'), true);
  assert.equal(needsDark('#e9152d'), false);
  assert.equal(needsDark('not-a-color'), false);
});

test('computed color follows the resolved background, custom or class-based', () => {
  const customBg = computeBadgeVisual({ activity: 1, custom: { color: '#ffcc00' } });
  assert.equal(customBg.bg, '#ffcc00');
  assert.equal(customBg.color, '#1c1c1e');

  const classBasedRed = computeBadgeVisual({ health: true });
  assert.equal(classBasedRed.bg, '');
  assert.equal(classBasedRed.color, '', 'a named badge is inked by --on-fill, which the theme moves');
});

/* A dark user colour used to return no ink and fall through to the stylesheet.
   The stylesheet now inks a named fill, which is bright in the dark theme, so
   the fall-through would put dark text on a dark badge. */
test('a user colour is always given its own ink', () => {
  assert.equal(computeBadgeVisual({ activity: 1, custom: { color: '#1e6ef4' } }).color, '#ffffff');
  assert.equal(computeBadgeVisual({ activity: 1, custom: { color: '#ffcc00' } }).color, '#1c1c1e');
  assert.equal(
    computeBadgeVisual({ activity: 0, staticBdg: { enabled: true, label: 'beta', color: '#008932' } }).color,
    '#ffffff',
  );
});

/* ── P6-2: a red tile could not say why ──────────────────────────────────────
   /api/health returns `unhealthy` plus the detail explaining it: `state` and
   `status` from Docker, `pingStatus` and `pingError` from the URL check. Only
   `unhealthy` was ever read, so a red dot carried no reason. An item configured
   with both checks also lost its container detail server-side, because the ping
   result replaced the container's entry instead of joining it.

   The reason is now the tile's hover text, and is appended to the accessible
   label so it is not sight-only. */

test('a stopped container explains itself using Docker wording', () => {
  assert.equal(healthReason({ state: 'exited', status: 'Exited (1) 2 hours ago' }), 'Exited (1) 2 hours ago');
});

test('a container with no status falls back to its state', () => {
  assert.equal(healthReason({ state: 'paused', status: '' }), 'Container paused');
});

/* The server uses 'unknown' when it cannot find the container at all, which is a
   different problem from one that is stopped. */
test('a missing container says so', () => {
  assert.equal(healthReason({ state: 'unknown', status: '' }), 'Container not found');
});

test('a container running but failing its own healthcheck is reported', () => {
  assert.equal(healthReason({ state: 'running', status: 'Up 3 days (unhealthy)' }), 'Up 3 days (unhealthy)');
});

test('a healthy container produces no reason', () => {
  assert.equal(healthReason({ state: 'running', status: 'Up 3 days' }), '');
});

test('a failed ping reports its error', () => {
  assert.equal(healthReason({ pingError: 'connect ECONNREFUSED' }), 'Ping failed: connect ECONNREFUSED');
});

test('a ping that answered with an error status reports the code', () => {
  assert.equal(healthReason({ pingStatus: 503 }), 'Ping returned 503');
  assert.equal(healthReason({ pingStatus: 200 }), '', 'a good status is not a reason');
});

/* The case the server bug hid: both checks configured and both failing. */
test('both checks failing give both reasons', () => {
  const r = healthReason({ state: 'exited', status: 'Exited (1) 2 hours ago', pingError: 'ECONNREFUSED' });
  assert.match(r, /Exited \(1\) 2 hours ago/);
  assert.match(r, /Ping failed: ECONNREFUSED/);
});

/* An upstream error can run to hundreds of characters, and a tooltip that leaves
   the screen is worse than no tooltip. */
test('a long value is truncated', () => {
  const r = healthReason({ pingError: 'x'.repeat(300) });
  assert.ok(r.length < 100, `too long: ${r.length}`);
  assert.match(r, /…$/);
});

test('healthReason tolerates junk', () => {
  for (const v of [null, undefined, 'x', 5, []]) assert.equal(healthReason(v), '');
  assert.equal(healthReason({}), '');
});

/* ── the reason reaches the badge ─────────────────────────────────────────── */

test('an unhealthy badge carries the reason as hover text', () => {
  const v = computeBadgeVisual({
    health: 1,
    activity: 0,
    hasHC: true,
    healthDetail: { state: 'exited', status: 'Exited (1)' },
  });
  assert.equal(v.title, 'Exited (1)');
  assert.match(v.aria, /needs attention: Exited \(1\)/, 'and is not sight-only');
});

test('a healthy badge carries no hover text', () => {
  const v = computeBadgeVisual({
    health: 0,
    activity: 0,
    hasHC: true,
    hideHealthy: false,
    healthDetail: { state: 'running', status: 'Up 3 days' },
  });
  assert.equal(v.title, '');
});

test('an unhealthy badge with no detail still works', () => {
  const v = computeBadgeVisual({ health: 1, activity: 0, hasHC: true });
  assert.equal(v.title, '');
  assert.equal(v.aria, 'Status: needs attention');
});

test('the same badge visual signs identically, so an unchanged badge is not repainted', () => {
  const opts = { health: 0, activity: 4, hasHC: true, custom: { unit: 'GB' } };
  assert.equal(badgeSignature(computeBadgeVisual(opts)), badgeSignature(computeBadgeVisual(opts)));
});

test('every field that reaches the element changes the signature', () => {
  const base = { cls: 'badge on blue', txt: '4', bg: '#ffcc00', aria: '4 pending', color: '#1c1c1e', title: 'x' };
  for (const key of Object.keys(base)) {
    assert.notEqual(badgeSignature(base), badgeSignature({ ...base, [key]: 'changed' }), key);
  }
});

test('signature fields cannot pack into each other', () => {
  assert.notEqual(badgeSignature({ cls: 'badge on', txt: '' }), badgeSignature({ cls: 'badge', txt: 'on' }));
});

test('a stale badge signs differently from the same badge fresh', () => {
  const fresh = computeBadgeVisual({ activity: 2, badgesStale: false });
  const stale = computeBadgeVisual({ activity: 2, badgesStale: true });
  assert.notEqual(badgeSignature(fresh), badgeSignature(stale));
});

/* ── one item failing inside a working response ───────────────────────────────
   The route reports each item separately: a failure arrives as an error field
   beside a value of zero. Reading the zero paints "nothing pending" on a tile
   whose service never answered. */

test('a reported value is read as a value', () => {
  assert.deepEqual(readBadgeUpdate({ value: 4 }), { value: 4, failed: false });
  assert.deepEqual(readBadgeUpdate({ value: 0 }), { value: 0, failed: false });
});

test('an item that failed is not read as zero', () => {
  assert.deepEqual(readBadgeUpdate({ value: 0, error: 'Timed out', kind: 'timeout' }), { value: null, failed: true });
  assert.deepEqual(readBadgeUpdate({ value: 0, error: 'Connection refused.' }), { value: null, failed: true });
});

test('an entry that is missing or the wrong shape counts as failed', () => {
  for (const v of [null, undefined, 5, 'x', {}, { value: 'many' }]) {
    assert.deepEqual(readBadgeUpdate(v), { value: null, failed: true }, JSON.stringify(v) ?? 'undefined');
  }
});

test('an item that failed marks its badge as out of date', () => {
  const fresh = computeBadgeVisual({ activity: 3 });
  const stale = computeBadgeVisual({ activity: 3, activityStale: true });
  assert.ok(stale.cls.includes('stale'));
  assert.match(stale.aria, /out of date/);
  assert.equal(stale.txt, fresh.txt, 'the last known value is still shown');
  assert.notEqual(badgeSignature(fresh), badgeSignature(stale));
});

test('a healthy dot is marked out of date too when its item failed', () => {
  const v = computeBadgeVisual({ hasHC: true, hideHealthy: false, activityStale: true });
  assert.ok(v.cls.includes('green'));
  assert.ok(v.cls.includes('stale'));
});

test('a count below the configured minimum shows no activity badge', () => {
  const v = computeBadgeVisual({ activity: 3, custom: { min: 5 }, hasHC: false });
  assert.equal(v.cls, 'badge', 'no colour and no text');
  assert.equal(v.txt, '');
  assert.equal(v.aria, '');
});

test('the minimum is inclusive', () => {
  const v = computeBadgeVisual({ activity: 5, custom: { min: 5 } });
  assert.match(v.cls, /blue/);
  assert.equal(v.txt, '5');
});

test('no minimum keeps badging any count above zero', () => {
  assert.match(computeBadgeVisual({ activity: 1 }).cls, /blue/);
  assert.equal(computeBadgeVisual({ activity: 0 }).cls, 'badge');
});

test('a suppressed count does not mark the tile stale', () => {
  const v = computeBadgeVisual({ activity: 2, custom: { min: 9 }, badgesStale: true, hasHC: false });
  assert.ok(!v.cls.includes('stale'), 'nothing is shown, so nothing can be out of date');
});

test('a static badge shows through while activity is below the minimum', () => {
  const v = computeBadgeVisual({ activity: 2, custom: { min: 9 }, staticBdg: { enabled: true, label: 'beta' } });
  assert.equal(v.txt, 'beta');
});

test('an unusable minimum falls back to one', () => {
  for (const min of [undefined, null, 0, -4, 1, 'x', Number.NaN, Infinity]) {
    assert.equal(badgeMinimum({ min }), 1, String(min));
  }
  assert.equal(badgeMinimum(), 1);
  assert.equal(badgeMinimum({ min: '7' }), 7, 'a numeric string from a form input still counts');
  assert.equal(badgeMinimum({ min: 4.8 }), 4, 'a fractional count is floored');
});

test('the first label reaching its minimum owns the badge', () => {
  const labels = [
    { path: 'a', name: 'errors', unit: 'err', color: 'red', min: 1 },
    { path: 'b', name: 'pending', unit: 'pending', color: 'yellow' },
  ];
  const v = computeBadgeVisual({ labels, values: [0, 4] });
  assert.equal(v.txt, '4 pending');
  assert.equal(v.bg, NAMED.yellow);
  assert.equal(v.more, 0);
});

test('a higher-priority label overrides a lower one that is also firing', () => {
  const labels = [
    { path: 'a', name: 'errors', unit: 'err', color: 'red' },
    { path: 'b', name: 'pending', unit: 'pending', color: 'yellow' },
  ];
  const v = computeBadgeVisual({ labels, values: [2, 9] });
  assert.equal(v.txt, '2 err');
  assert.equal(v.bg, NAMED.red);
  assert.equal(v.more, 1);
  assert.ok(v.cls.includes('has-more'));
  assert.equal(v.nextColor, NAMED.yellow);
  assert.deepEqual(
    v.rows.map(r => [r.name, r.value]),
    [
      ['errors', 2],
      ['pending', 9],
    ],
  );
});

test('a single firing label advertises no list', () => {
  const labels = [
    { path: 'a', name: 'approved' },
    { path: 'b', name: 'declined' },
  ];
  const v = computeBadgeVisual({ labels, values: [7, 0] });
  assert.equal(v.more, 0);
  assert.equal(v.rows.length, 0);
  assert.ok(!v.cls.includes('has-more'));
});

test('a label below its own minimum does not fire', () => {
  const labels = [
    { path: 'a', name: 'big', min: 10 },
    { path: 'b', name: 'small' },
  ];
  const v = computeBadgeVisual({ labels, values: [9, 3] });
  assert.equal(v.txt, '3');
  assert.equal(v.more, 0);
});

test('no firing label falls back to the healthy dot', () => {
  const labels = [{ path: 'a', name: 'pending' }];
  const v = computeBadgeVisual({ labels, values: [0], hasHC: true, hideHealthy: false });
  assert.equal(v.cls, 'badge on green');
});

test('firingLabels skips entries without a path', () => {
  assert.deepEqual(
    firingLabels([{ name: 'x' }, { path: 'b', name: 'y' }], [5, 5]).map(r => r.name),
    ['y'],
  );
});

test('the signature separates two label lists that differ only in a value', () => {
  const labels = [
    { path: 'a', name: 'x' },
    { path: 'b', name: 'y' },
  ];
  const a = badgeSignature(computeBadgeVisual({ labels, values: [1, 2] }));
  const b = badgeSignature(computeBadgeVisual({ labels, values: [1, 3] }));
  assert.notEqual(a, b);
});

test('labels are ignored when the value list is missing', () => {
  const v = computeBadgeVisual({ labels: [{ path: 'a', name: 'x' }], activity: 6, custom: { unit: 'q' } });
  assert.equal(v.txt, '6 q');
});

test('a label with no colour takes the picker default, not the theme blue', () => {
  const v = computeBadgeVisual({ labels: [{ path: 'a', name: 'x' }], values: [3] });
  assert.equal(v.bg, LABEL_DEFAULT_COLOR);
  assert.equal(v.color, '#ffffff', 'and therefore white ink, like an explicitly set default');
});

test('a folder-style row list keeps each entry addressable', () => {
  const labels = [
    { path: 'a', name: 'Sync · errors', color: 'red' },
    { path: 'b', name: 'Checks · warnings', color: 'yellow' },
  ];
  const v = computeBadgeVisual({ labels, values: [2, 5] });
  assert.equal(v.txt, '2');
  assert.deepEqual(
    v.rows.map(r => r.name),
    ['Sync · errors', 'Checks · warnings'],
  );
});

test('white wins wherever white is readable, even where dark scores higher', () => {
  /* Dark ink measures 4.59 here against white's 4.57, and white is still used. */
  assert.equal(needsDark('#1e6ef4'), false);
  assert.equal(computeBadgeVisual({ activity: 1, custom: { color: '#1e6ef4' } }).color, '#ffffff');
  /* White reaches only 3.56 here, so dark is the only readable choice. */
  assert.equal(needsDark('#ff393c'), true);
  assert.equal(computeBadgeVisual({ activity: 1, custom: { color: '#ff393c' } }).color, '#1c1c1e');
});

/* ── Priority, stated once as a table so the order cannot drift ─────────────
   Unhealthy > Live Activity > Fixed Label > Healthy. */
const ALL = {
  health: true,
  labels: [{ path: 'a', name: 'pending', unit: 'pending', color: 'yellow' }],
  values: [4],
  staticBdg: { enabled: true, label: 'backup', color: 'gray' },
  hasHC: true,
  hideHealthy: false,
};

test('priority: every combination shows the highest-ranked badge present', () => {
  const cases = [
    ['unhealthy + activity + fixed + healthy', {}, '!', 'red'],
    ['activity + fixed + healthy', { health: false }, '4 pending', 'blue'],
    ['fixed + healthy', { health: false, values: [0] }, 'backup', 'blue'],
    ['healthy only', { health: false, values: [0], staticBdg: {} }, '', 'green'],
    ['nothing', { health: false, values: [0], staticBdg: {}, hasHC: false }, '', ''],
  ];
  for (const [what, over, txt, tone] of cases) {
    const v = computeBadgeVisual({ ...ALL, ...over });
    assert.equal(v.txt, txt, `${what}: pill text`);
    if (tone) assert.ok(v.cls.includes(tone), `${what}: expected ${tone}, got ${v.cls}`);
    else assert.equal(v.cls, 'badge', what);
  }
});

test('priority: unhealthy still wins when activity is the only other signal', () => {
  const v = computeBadgeVisual({ health: true, labels: ALL.labels, values: [9], hasHC: true });
  assert.equal(v.txt, '!');
});

test('priority: the list holds exactly the badges the pill did not show', () => {
  const all = computeBadgeVisual(ALL);
  assert.deepEqual(
    all.rows.map(r => r.name),
    ['Status: needs attention', 'pending', 'backup'],
  );
  const noHealth = computeBadgeVisual({ ...ALL, health: false });
  assert.deepEqual(
    noHealth.rows.map(r => r.name),
    ['pending', 'backup'],
  );
  const onlyFixed = computeBadgeVisual({ ...ALL, health: false, values: [0] });
  assert.equal(onlyFixed.more, 0, 'one badge alone opens no list');
});

test('priority: the healthy dot never counts toward the list', () => {
  const v = computeBadgeVisual({ hasHC: true, hideHealthy: false, staticBdg: { enabled: true, label: 'x' } });
  assert.equal(v.txt, 'x');
  assert.equal(v.more, 0);
});

/* ── Bad and hostile config ──────────────────────────────────────────────── */

test('a labels value of the wrong type is ignored rather than thrown on', () => {
  for (const bad of [null, undefined, 'pending', 7, {}, true]) {
    const v = computeBadgeVisual({ labels: bad, values: [1], activity: 2, custom: { unit: 'q' } });
    assert.equal(v.txt, '2 q', `labels ${JSON.stringify(bad)} should fall through`);
  }
});

test('a values list of the wrong type is ignored', () => {
  for (const bad of [null, undefined, 'x', 7, {}]) {
    const v = computeBadgeVisual({ labels: [{ path: 'a', name: 'n' }], values: bad });
    assert.equal(v.more, 0);
    assert.equal(v.rows.length, 0);
  }
});

test('label entries that are not objects are skipped without shifting the rest', () => {
  const labels = [null, 'a', { path: 'b', name: 'kept' }, { name: 'no path' }];
  const v = computeBadgeVisual({ labels, values: [9, 9, 5, 9] });
  assert.deepEqual(
    firingLabels(labels, [9, 9, 5, 9]).map(r => r.name),
    ['kept'],
  );
  assert.equal(v.txt, '5');
});

test('a label with no name falls back to its unit, then to its path', () => {
  const rows = firingLabels([{ path: 'p', unit: 'u' }, { path: 'only-path' }], [1, 1]);
  assert.deepEqual(
    rows.map(r => r.name),
    ['u', 'only-path'],
  );
});

test('a hostile label name or unit is carried as text, never as markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const v = computeBadgeVisual({ labels: [{ path: 'a', name: evil, unit: evil }], values: [1] });
  assert.equal(v.rows.length, 0, 'one badge opens no list');
  const two = computeBadgeVisual({
    labels: [
      { path: 'a', name: evil, unit: evil },
      { path: 'b', name: 'x' },
    ],
    values: [1, 1],
  });
  assert.equal(two.rows[0].name, evil, 'stored verbatim; the DOM write escapes it');
});

test('a unit longer than the pill allows is truncated on the badge only', () => {
  const long = 'abcdefghijklmnop';
  const v = computeBadgeVisual({
    labels: [
      { path: 'a', name: 'n', unit: long },
      { path: 'b', name: 'm' },
    ],
    values: [1, 1],
  });
  assert.equal(v.txt, '1 abcdefgh', 'the pill takes eight characters');
  assert.equal(v.rows[0].unit, long, 'the list keeps the whole unit');
});

test('a value beyond the pill cap is capped there and whole in the list', () => {
  const v = computeBadgeVisual({
    labels: [
      { path: 'a', name: 'n', unit: 'u' },
      { path: 'b', name: 'm' },
    ],
    values: [123456, 1],
  });
  assert.equal(v.txt, '99+ u');
  assert.equal(v.rows[0].value, 123456);
});

test('a negative or fractional value is judged against the same threshold', () => {
  const labels = [{ path: 'a', name: 'n' }];
  assert.equal(computeBadgeVisual({ labels, values: [-4] }).txt, '');
  assert.equal(computeBadgeVisual({ labels, values: [0.5] }).txt, '');
  assert.equal(computeBadgeVisual({ labels, values: [1.5] }).txt, '1.5');
});

test('a colour the browser would not read as a colour is dropped', () => {
  for (const bad of ['javascript:alert(1)', 'url(https://evil.example/x.png)', 'expression(1)', '#12345', '']) {
    assert.equal(safeColor(bad), '', `${bad} must not reach CSS`);
  }
  for (const good of ['#fff', '#1e6ef4', '#1e6ef4cc', 'red', 'yellow']) {
    assert.ok(safeColor(good), `${good} is a colour and should pass`);
  }
});

test('a hostile fill leaves the badge on its named colour, never on the raw string', () => {
  const v = computeBadgeVisual({
    labels: [
      { path: 'a', name: 'n', color: 'url(https://evil.example/x.png)' },
      { path: 'b', name: 'm' },
    ],
    values: [1, 1],
  });
  assert.equal(v.bg, LABEL_DEFAULT_COLOR, 'it falls back to the default, not to the url');
  const fixed = computeBadgeVisual({ staticBdg: { enabled: true, label: 'x', color: 'url(https://evil/x)' } });
  assert.equal(fixed.bg, '');
});

test('the signature changes when the list behind an unchanged pill changes', () => {
  const labels = [
    { path: 'a', name: 'x' },
    { path: 'b', name: 'y' },
  ];
  const a = badgeSignature(computeBadgeVisual({ labels, values: [1, 1] }));
  const b = badgeSignature(computeBadgeVisual({ labels, values: [1, 2] }));
  assert.notEqual(a, b, 'the pill reads 1 either way; the list does not');
});

test('a named label announces its name, not the count template twice', () => {
  const named = computeBadgeVisual({ labels: [{ path: 'a', name: 'errors', unit: 'err' }], values: [2] });
  assert.equal(named.aria, 'errors: 2');
  const unnamed = computeBadgeVisual({ labels: [{ path: 'a' }], values: [2] });
  assert.equal(unnamed.aria, 'a: 2', 'the path stands in when there is no name');
});

test('the list is capped, and a label past the cap can still own the badge', () => {
  const labels = Array.from({ length: 12 }, (_, n) => ({ path: `p${n}`, name: `l${n}` }));
  const all = computeBadgeVisual({ labels, values: labels.map(() => 3) });
  assert.equal(all.rows.length, MAX_LABELS, 'the list never grows past the cap');
  assert.equal(all.more, MAX_LABELS - 1);

  /* The cap counts what is firing, not what is configured. */
  const values = labels.map((_, n) => (n === 9 ? 4 : 0));
  const late = computeBadgeVisual({ labels, values });
  assert.equal(late.txt, '4', 'a label past the cap still takes the pill when nothing above it fires');
  assert.equal(late.more, 0);
});

/* An older dashboard's config, which the update must not repaint. */
test('an app with no labels renders exactly as it did before labels existed', () => {
  const legacy = { activity: 7, custom: { unit: 'jobs', color: '#cb30df', min: 3 }, hasHC: true };
  const v = computeBadgeVisual(legacy);
  assert.equal(v.txt, '7 jobs');
  assert.equal(v.num, '7');
  assert.equal(v.bg, '#cb30df');
  assert.equal(v.more, 0, 'no marker appears where there was none');
  assert.deepEqual(v.rows, []);
  assert.equal(computeBadgeVisual({ ...legacy, activity: 2 }).cls, 'badge on green', 'the minimum still applies');
});

test('a legacy fixed label alone is unchanged', () => {
  const v = computeBadgeVisual({ staticBdg: { enabled: true, label: 'backup', color: 'gray' }, hasHC: true });
  assert.equal(v.txt, 'backup');
  assert.equal(v.bg, NAMED.gray);
  assert.equal(v.more, 0);
});

test('a legacy unhealthy badge is unchanged', () => {
  const v = computeBadgeVisual({ health: true, hasHC: true, healthDetail: { state: 'exited' } });
  assert.equal(v.txt, '!');
  assert.ok(v.cls.startsWith('badge on red'));
  assert.equal(v.more, 0);
  assert.ok(v.title, 'the hover reason still explains the failure');
});

test('every badge carries a name that does not rely on its colour', () => {
  const cases = [
    [{ health: true, hasHC: true }, 'Status: needs attention'],
    [{ staticBdg: { enabled: true, label: 'backup' } }, 'backup'],
    [{ labels: [{ path: 'a', name: 'errors' }], values: [2] }, 'errors: 2'],
    [{ activity: 3 }, '3 pending'],
    [{ hasHC: true, hideHealthy: false }, 'Status: healthy'],
  ];
  for (const [opts, expected] of cases) {
    const v = computeBadgeVisual(opts);
    assert.ok(v.aria.startsWith(expected), `expected ${expected}, got ${v.aria}`);
  }
});

test('a badge that opens a list says how many are behind it, in the right number', () => {
  const two = computeBadgeVisual({
    labels: [
      { path: 'a', name: 'x' },
      { path: 'b', name: 'y' },
    ],
    values: [1, 1],
  });
  assert.ok(two.aria.endsWith('1 more badge'), two.aria);
  const three = computeBadgeVisual({
    labels: [
      { path: 'a', name: 'x' },
      { path: 'b', name: 'y' },
      { path: 'c', name: 'z' },
    ],
    values: [1, 1, 1],
  });
  assert.ok(three.aria.endsWith('2 more badges'), three.aria);
});
