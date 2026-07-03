import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBadgeVisual, needsDark, resolveColor, NAMED } from '../js/badge-logic.js';

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
