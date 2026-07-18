import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanId, buildStatsSlots, buildMapServices, finalizeBackupSlots, buildAppItem } from '../js/admin-save-logic.js';

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

test('buildStatsSlots caps at three and shapes disk/temp/other', () => {
  const out = buildStatsSlots([
    { type: 'disk', primary: '/mnt', secondary: '/home', color: 'red' },
    { type: 'temp', thermalZone: 2 },
    { type: 'cpu' },
    { type: 'ram' },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { type: 'disk', primary: '/mnt', secondary: '/home', color: 'red' });
  assert.deepEqual(out[1], { type: 'temp', thermalZone: 2, color: undefined });
  assert.deepEqual(out[2], { type: 'cpu', color: undefined });
});

test('buildStatsSlots defaults disk mount and normalizes a bad thermal zone', () => {
  assert.deepEqual(buildStatsSlots([{ type: 'disk' }])[0], { type: 'disk', primary: '/', secondary: undefined, color: undefined });
  assert.equal(buildStatsSlots([{ type: 'temp', thermalZone: 'x' }])[0].thermalZone, 0);
});

test('buildMapServices drops services without a type or url and normalizes the rest', () => {
  const out = buildMapServices([
    { id: 'a', type: 'gluetun', name: '  VPN ', url: ' http://x ', adminUrl: ' http://admin ' },
    { id: 'b', type: '', url: 'http://y' },
    { id: 'c', url: 'http://z' },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 'a', type: 'gluetun', name: 'VPN', url: 'http://x', adminUrl: 'http://admin', color: '', enabled: true });
});

test('buildMapServices includes non-blank plain/secret fields and omits blank ones', () => {
  const [withSecret] = buildMapServices([{ id: 'a', type: 'umami', url: 'http://x', websiteId: 'w1', apiKey: 'k1', password: '  ' }]);
  assert.equal(withSecret.websiteId, 'w1');
  assert.equal(withSecret.apiKey, 'k1');
  assert.equal('password' in withSecret, false);
});

test('finalizeBackupSlots propagates the default instance connection to sharing slots', () => {
  const slots = [
    { provider: 'duplicati', useDefault: true, dupUrl: 'http://d', dupHref: 'h', dupPollSec: 30, dupPassSet: true },
    { provider: 'duplicati', useDefault: true, dupUrl: '', dupHref: '', dupPollSec: 60 },
  ];
  const res = finalizeBackupSlots(slots, 'medium');
  assert.equal(res.error, undefined);
  assert.equal(slots[1].dupUrl, 'http://d');
  assert.equal(res.savableSlots[1].dupUrl, 'http://d');
});

test('finalizeBackupSlots does not propagate when the default opts out', () => {
  const slots = [
    { provider: 'duplicati', useDefault: false, dupUrl: 'http://d' },
    { provider: 'duplicati', useDefault: true, dupUrl: 'http://other' },
  ];
  finalizeBackupSlots(slots, 'medium');
  assert.equal(slots[1].dupUrl, 'http://other'); // untouched
});

test('finalizeBackupSlots rejects a provider slot with no URL', () => {
  const res = finalizeBackupSlots([{ provider: 'duplicati', useDefault: true, dupUrl: '' }], 'small');
  assert.match(res.error, /URL required for First Duplicati instance/);
});

test('finalizeBackupSlots strips runtime-only and default fields for saving', () => {
  const [s] = finalizeBackupSlots([{ provider: 'duplicati', dupUrl: 'http://d', dupPollSec: 60, customName: '' }], 'small').savableSlots;
  assert.equal(s.dupPollSec, undefined); // 60 is the default -> omitted
  assert.equal(s.customName, undefined);
  assert.equal(s.useDefault, true);
  const [empty] = finalizeBackupSlots([{ provider: null }], 'small').savableSlots;
  assert.equal(empty.useDefault, undefined);
  assert.equal(empty.jobId, null);
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
