import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanId, buildAppItem } from '../js/admin-save-logic.js';

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
