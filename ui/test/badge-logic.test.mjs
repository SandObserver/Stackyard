import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBadgeVisual, needsDark, resolveColor, NAMED, healthReason } from '../js/badge-logic.js';

test('unhealthy takes priority over everything else', () => {
  const v = computeBadgeVisual({ health: true, activity: 5, staticBdg: { enabled: true, label: 'x' }, hasHC: true, hideHealthy: false });
  assert.equal(v.cls, 'badge on red');
  assert.equal(v.txt, '!');
  assert.equal(v.aria, 'Status: needs attention');
});

test('activity takes priority over static label and healthy dot', () => {
  const v = computeBadgeVisual({ activity: 3, staticBdg: { enabled: true, label: 'x' }, hasHC: true, hideHealthy: false });
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
  assert.equal(classBasedRed.color, '');
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
  const v = computeBadgeVisual({ health: 1, activity: 0, hasHC: true, healthDetail: { state: 'exited', status: 'Exited (1)' } });
  assert.equal(v.title, 'Exited (1)');
  assert.match(v.aria, /needs attention: Exited \(1\)/, 'and is not sight-only');
});

test('a healthy badge carries no hover text', () => {
  const v = computeBadgeVisual({ health: 0, activity: 0, hasHC: true, hideHealthy: false, healthDetail: { state: 'running', status: 'Up 3 days' } });
  assert.equal(v.title, '');
});

test('an unhealthy badge with no detail still works', () => {
  const v = computeBadgeVisual({ health: 1, activity: 0, hasHC: true });
  assert.equal(v.title, '');
  assert.equal(v.aria, 'Status: needs attention');
});
