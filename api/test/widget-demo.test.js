const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { helpers } = require('../src/demo-data');

/* Each widget's demo.js receives the same ctx its data.js would, so these call
   them the way widget-data.js does. */
const demoFn = name => require(path.join(__dirname, '..', '..', 'ui', 'widgets', name, 'demo.js'));
const ctx = (config = {}) => ({ config, demo: helpers, endpoint: '' });

test('every demo module exports a function', () => {
  for (const name of ['backup', 'books', 'dns', 'github', 'nowplaying', 'weather']) {
    assert.equal(typeof demoFn(name), 'function', name);
  }
});

test('dns body carries summary counts and a 24 point chart', () => {
  const b = demoFn('dns')(ctx());
  assert.ok(b.num_dns_queries > b.num_blocked_filtering);
  assert.equal(b.dns_queries.length, 24);
  assert.equal(b.blocked_filtering.length, 24);
  assert.ok(b.dns_queries.every(n => Number.isInteger(n) && n >= 0));
});

test('nowplaying sessions match the widget contract', () => {
  const b = demoFn('nowplaying')(ctx());
  assert.equal(b.provider, 'jellyfin');
  assert.ok(b.sessions.length >= 1);
  for (const s of b.sessions) {
    assert.ok(s.progress >= 0 && s.progress <= 1, 'progress is 0..1');
    assert.ok(['playing', 'paused'].includes(s.state));
    assert.equal(typeof s.title, 'string');
  }
});

test('books body matches the widget contract', () => {
  const b = demoFn('books')(ctx());
  assert.ok(b.books.length >= 1);
  for (const bk of b.books) {
    assert.equal(typeof bk.title, 'string');
    assert.equal(typeof bk.finished, 'boolean');
    assert.ok(bk.progress === null || (bk.progress >= 0 && bk.progress <= 1));
  }
  assert.ok(
    b.books.some(bk => bk.finished),
    'at least one finished book',
  );
});

test('weather body matches the widget contract', () => {
  const b = demoFn('weather')(ctx());
  assert.ok(Number.isInteger(b.temp));
  assert.ok(['c', 'f'].includes(b.units));
  assert.equal(typeof b.isDay, 'boolean');
});

test('github calendar is 53 weeks of 7 days and is stable across calls', () => {
  const fn = demoFn('github');
  const a = fn(ctx()),
    b = fn(ctx());
  assert.equal(a.weeks.length, 53);
  assert.ok(a.weeks.every(w => w.contributionDays.length === 7));
  assert.equal(a.totalContributions, b.totalContributions);
  assert.deepEqual(a.weeks[0], b.weeks[0]);
});

test('backup returns one result per configured slot', () => {
  const config = { slots: [{ provider: 'duplicati', customName: 'Offsite' }, { provider: 'kopia' }] };
  const b = demoFn('backup')(ctx(config));
  assert.equal(b.length, 2);
  assert.equal(b[0].name, 'Offsite');
  assert.equal(b[1].provider, 'kopia');
  assert.deepEqual(demoFn('backup')(ctx({})), []);
});

/* Stats deliberately has no demo.js: ctx.metrics already hands it invented host
   numbers, so it runs its real code path on the demo and exercises more of it. */
test('stats has no demo module and the registry reflects who does', () => {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', 'ui', 'widgets');
  const has = n => fs.existsSync(path.join(dir, n, 'demo.js'));
  assert.equal(has('stats'), false);
  for (const n of ['backup', 'books', 'dns', 'github', 'nowplaying', 'weather']) assert.equal(has(n), true, n);

  process.env.WIDGETS_PATH = dir;
  const reg = require('../src/widgets').getRegistry();
  assert.equal(reg.stats.hasDemoFn, false);
  assert.equal(reg.weather.hasDemoFn, true);
});

test('the drift helpers keep every widget on one clock', () => {
  assert.equal(typeof helpers.wave, 'function');
  assert.equal(typeof helpers.round, 'function');
  const v = helpers.wave(600, 10, 20);
  assert.ok(v > 5 && v < 25, 'stays near its declared range');
  assert.equal(helpers.round(1.23456, 2), 1.23);
});
