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
} from '../js/badge-logic.js';

test('unhealthy takes priority over everything else', () => {
  const v = computeBadgeVisual({
    health: true,
    activity: 5,
    staticBdg: { enabled: true, label: 'x' },
    hasHC: true,
    hideHealthy: false,
  });
  assert.equal(v.cls, 'badge on red');
  assert.equal(v.txt, '!');
  assert.equal(v.aria, 'Status: needs attention');
});

test('activity takes priority over static label and healthy dot', () => {
  const v = computeBadgeVisual({
    activity: 3,
    staticBdg: { enabled: true, label: 'x' },
    hasHC: true,
    hideHealthy: false,
  });
  assert.equal(v.cls, 'badge on blue');
  assert.equal(v.txt, '3');
  assert.equal(v.aria, '3 pending');
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

test('needsDark picks dark text only when it wins contrast against a light background', () => {
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
