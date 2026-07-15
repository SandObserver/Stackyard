const { test } = require('node:test');
const assert = require('node:assert/strict');
const { metrics, demoWidgetBody, demoBadges, demoHealth, demoBackup } = require('../src/demo-data');

test('metrics return plausible in-range values', () => {
  const cpu = metrics.cpuPercent(), ram = metrics.ramPercent();
  assert.ok(cpu >= 0 && cpu <= 100, `cpu ${cpu}`);
  assert.ok(ram >= 0 && ram <= 100, `ram ${ram}`);
  assert.ok(metrics.procCount() > 0);
  assert.ok(metrics.uptimeSeconds() > 0);
  const d = metrics.diskStats('/');
  assert.ok(d.usedPct > 0 && d.usedPct <= 100);
  assert.ok(d.totalGb > 0);
});

test('dns body carries summary counts and a 24 point chart', () => {
  const b = demoWidgetBody('dns');
  assert.ok(b.num_dns_queries > 0);
  assert.ok(b.num_blocked_filtering > 0 && b.num_blocked_filtering < b.num_dns_queries);
  assert.equal(b.dns_queries.length, 24);
  assert.equal(b.blocked_filtering.length, 24);
});

test('nowplaying sessions match the widget contract', () => {
  const b = demoWidgetBody('nowplaying');
  assert.equal(b.sessions.length, 2);
  for (const s of b.sessions) {
    assert.ok(s.title);
    assert.ok(s.player);
    assert.ok(['playing', 'paused'].includes(s.state));
    /* 0..1, not 0..100. tapeSize() clamps to 1, so a percentage pins the tape
       at full and the widget never animates. */
    assert.ok(s.progress >= 0 && s.progress <= 1, `progress out of range: ${s.progress}`);
  }
  assert.ok(b.sessions.some(s => s.state === 'playing'));
});

test('weather body matches the widget contract', () => {
  const b = demoWidgetBody('weather');
  assert.equal(typeof b.temp, 'number');
  assert.equal(b.units, 'c');
  assert.equal(typeof b.isDay, 'boolean');
});

test('github calendar is 53 weeks of 7 days and is stable across calls', () => {
  const a = demoWidgetBody('github'), b = demoWidgetBody('github');
  assert.equal(a.weeks.length, 53);
  assert.equal(a.weeks[0].contributionDays.length, 7);
  assert.ok(a.totalContributions > 0);
  assert.equal(a.totalContributions, b.totalContributions);
});

test('unknown widget types fall through to the real code path', () => {
  assert.equal(demoWidgetBody('clock'), null);
  assert.equal(demoWidgetBody('stats'), null);
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

test('backup returns one result per configured slot', () => {
  const out = demoBackup({ slots: [{ provider: 'duplicati', customName: 'Offsite Backup' }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Offsite Backup');
  assert.equal(out[0].status, 'healthy');
  assert.ok(out[0].lastFinished);
  assert.deepEqual(demoBackup({}), []);
});
