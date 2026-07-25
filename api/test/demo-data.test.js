const { test } = require('node:test');
const assert = require('node:assert/strict');
const { metrics, demoBadges, demoHealth } = require('../src/demo-data');

test('metrics return plausible in-range values', () => {
  const cpu = metrics.cpuSample().cpu, ram = metrics.ramPercent();
  assert.ok(cpu >= 0 && cpu <= 100, `cpu ${cpu}`);
  assert.ok(ram >= 0 && ram <= 100, `ram ${ram}`);
  assert.ok(metrics.procCount() > 0);
  assert.ok(metrics.uptimeSeconds() > 0);
  const d = metrics.diskStats('/');
  assert.ok(d.usedPct > 0 && d.usedPct <= 100);
  assert.ok(d.totalGb > 0);
});

const ITEMS = [
  { id: 'app-jellyfin', type: 'app', monitoring: { activity: { enabled: true } } },
  { id: 'app-grafana', type: 'app', monitoring: { healthcheck: { enabled: true } } },
  { id: 'app-plain', type: 'app' },
  { id: 'w-clock', type: 'widget' },
];

test('badges only cover apps with activity enabled', () => {
  const out = demoBadges(ITEMS);
  assert.deepEqual(Object.keys(out), ['app-jellyfin']);
  assert.ok(out['app-jellyfin'].value > 0);
});

test('health marks the showcase app unhealthy and covers only healthcheck apps', () => {
  const out = demoHealth(ITEMS);
  assert.deepEqual(Object.keys(out), ['app-grafana']);
  assert.equal(out['app-grafana'].unhealthy, true);
});

