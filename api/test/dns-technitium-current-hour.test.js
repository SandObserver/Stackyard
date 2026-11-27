const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');
const { KIND, WidgetError } = require('../src/api-error');
const { remember } = require('../src/bounded-cache');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'dns', 'data.js'));

const CONFIG = { provider: 'technitium', dnsUrl: 'http://10.0.0.5:5380', dnsTechnitiumToken: 't' };
const LABELS = ['Total', 'No Error', 'Cached', 'Blocked', 'Dropped'];

function chart(labels, rows) {
  return {
    labels,
    datasets: LABELS.map(label => ({ label, data: rows.map(r => r[label] || 0) })),
  };
}

function reply(stats, mainChartData) {
  return { status: 'ok', response: { stats, mainChartData } };
}

const dayLabels = ['2026-11-27T21:00:00.0000000Z', '2026-11-27T22:00:00.0000000Z', '2026-11-27T23:00:00.0000000Z'];
const hourLabels = ['2026-11-27T22:58:00.0000000Z', '2026-11-27T22:59:00.0000000Z', '2026-11-27T23:13:00.0000000Z'];

function ctxFor(day, hour) {
  return {
    config: CONFIG,
    normalizeBase,
    remember,
    serviceBase,
    serviceLink,
    KIND,
    fail(msg, opts) {
      throw new WidgetError(msg, opts);
    },
    fetchJSON: async url => {
      if (url.includes('type=LastHour')) return typeof hour === 'function' ? hour() : { status: 200, data: hour };
      return { status: 200, data: day };
    },
  };
}

const counts = r => [r.num_dns_queries, r.num_blocked_filtering, r.num_cached];

test('queries in the current hour count before Technitium closes the hour', async () => {
  const day = reply(
    { totalQueries: 0, totalBlocked: 0, totalDropped: 0, totalCached: 0 },
    chart(dayLabels, [{}, {}, {}]),
  );
  const hour = reply({}, chart(hourLabels, [{}, {}, { Total: 9, Blocked: 3, Cached: 4 }]));
  assert.deepEqual(counts(await dataFn(ctxFor(day, hour))), [9, 3, 4]);
});

test('closed hours and the current hour add up', async () => {
  const day = reply(
    { totalQueries: 50, totalBlocked: 5, totalDropped: 1, totalCached: 20 },
    chart(dayLabels, [{ Total: 30 }, { Total: 20 }, {}]),
  );
  const hour = reply(
    {},
    chart(hourLabels, [{ Total: 7 }, { Total: 8 }, { Total: 9, Blocked: 2, Dropped: 1, Cached: 4 }]),
  );
  assert.deepEqual(counts(await dataFn(ctxFor(day, hour))), [59, 9, 24]);
});

test('minutes before the current hour are not counted twice', async () => {
  const day = reply({ totalQueries: 15, totalCached: 0 }, chart(dayLabels, [{}, { Total: 15 }, {}]));
  const hour = reply({}, chart(hourLabels, [{ Total: 7 }, { Total: 8 }, {}]));
  assert.deepEqual(counts(await dataFn(ctxFor(day, hour))), [15, 0, 0]);
});

test('a current hour Technitium already filled is not counted twice', async () => {
  const day = reply(
    { totalQueries: 9, totalBlocked: 3, totalCached: 4 },
    chart(dayLabels, [{}, {}, { Total: 9, Blocked: 3, Cached: 4 }]),
  );
  const hour = reply({}, chart(hourLabels, [{}, {}, { Total: 9, Blocked: 3, Cached: 4 }]));
  assert.deepEqual(counts(await dataFn(ctxFor(day, hour))), [9, 3, 4]);
});

for (const [name, hour] of [
  ['fails', () => Promise.reject(new Error('timeout'))],
  ['is refused', { status: 'invalid-token' }],
  ['has no chart', reply({ totalQueries: 9 })],
]) {
  test(`the day totals stand when the last-hour request ${name}`, async () => {
    const day = reply({ totalQueries: 40, totalBlocked: 2, totalCached: 5 }, chart(dayLabels, [{ Total: 40 }, {}, {}]));
    assert.deepEqual(counts(await dataFn(ctxFor(day, hour))), [40, 2, 5]);
  });
}
