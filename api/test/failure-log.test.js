const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../src/log');
const failureLog = require('../src/failure-log');
const { REPEAT_MS, FORGET_MS } = failureLog;

function record(t) {
  const lines = [];
  t.mock.method(log, 'error', (msg, data) => lines.push({ level: 'error', msg, data }));
  t.mock.method(log, 'info', (msg, data) => lines.push({ level: 'info', msg, data }));
  return lines;
}

beforeEach(() => failureLog.reset());

test('a failure that repeats is logged once until the reminder is due', t => {
  const lines = record(t);
  for (let i = 0; i < 200; i++)
    failureLog.failed('w1', 'widget-data failed', { id: 'w1' }, 'Timed out', 1000 + i * 5000);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { level: 'error', msg: 'widget-data failed', data: { id: 'w1', error: 'Timed out' } });
  assert.equal(lines[1].data.failures, 1 + REPEAT_MS / 5000);
  assert.equal(lines[1].data.since, new Date(1000).toISOString());
});

test('a changed reason is logged at once', t => {
  const lines = record(t);
  failureLog.failed('w1', 'widget-data failed', {}, 'Timed out', 0);
  failureLog.failed('w1', 'widget-data failed', {}, 'AdGuard HTTP 500', 1000);
  assert.deepEqual(
    lines.map(l => l.data.error),
    ['Timed out', 'AdGuard HTTP 500'],
  );
});

test('recovery is logged once with the failure count, and only after a failure', t => {
  const lines = record(t);
  failureLog.recovered('w1', 'widget-data recovered', { id: 'w1' });
  failureLog.failed('w1', 'widget-data failed', {}, 'Timed out', 0);
  failureLog.failed('w1', 'widget-data failed', {}, 'Timed out', 1000);
  failureLog.recovered('w1', 'widget-data recovered', { id: 'w1' });
  failureLog.recovered('w1', 'widget-data recovered', { id: 'w1' });
  assert.deepEqual(lines.at(-1), { level: 'info', msg: 'widget-data recovered', data: { id: 'w1', failures: 2 } });
  assert.equal(lines.filter(l => l.level === 'info').length, 1);
});

test('separate keys are tracked separately', t => {
  const lines = record(t);
  failureLog.failed('w1', 'widget-data failed', {}, 'Timed out', 0);
  failureLog.failed('w2', 'widget-data failed', {}, 'Timed out', 0);
  assert.equal(lines.length, 2);
});

test('an entry untouched for an hour is forgotten', t => {
  const lines = record(t);
  failureLog.failed('junk', 'widget-data failed', {}, 'Timed out', 0);
  failureLog.failed('w1', 'widget-data failed', {}, 'Timed out', FORGET_MS);
  failureLog.recovered('junk', 'widget-data recovered', {});
  assert.equal(lines.filter(l => l.level === 'info').length, 0);
});
