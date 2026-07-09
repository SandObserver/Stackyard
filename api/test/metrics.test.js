const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const metrics = require('../src/metrics');

test('ramPercent computes used percentage from meminfo', (t) => {
  t.mock.method(fs, 'readFileSync', () =>
    'MemTotal:        1000 kB\nMemFree:          100 kB\nMemAvailable:     250 kB\n');
  assert.equal(metrics.ramPercent(), 75);
});

test('ramPercent returns 0 when MemTotal is missing', (t) => {
  t.mock.method(fs, 'readFileSync', () => 'MemAvailable: 250 kB\n');
  assert.equal(metrics.ramPercent(), 0);
});

test('cpuTemp converts millidegrees to one decimal', (t) => {
  t.mock.method(fs, 'readFileSync', () => '45123\n');
  assert.equal(metrics.cpuTemp(), 45.1);
});

test('cpuTemp returns null for non-numeric contents', (t) => {
  t.mock.method(fs, 'readFileSync', () => 'n/a');
  assert.equal(metrics.cpuTemp(), null);
});

test('cpuTemp returns null when the sensor read throws', (t) => {
  t.mock.method(fs, 'readFileSync', () => { throw new Error('ENOENT'); });
  assert.equal(metrics.cpuTemp(), null);
});

test('procCount reads the total from the loadavg process field', (t) => {
  t.mock.method(fs, 'readFileSync', () => '0.52 0.48 0.44 3/2566 98765\n');
  assert.equal(metrics.procCount(), 2566);
});

test('procCount returns 0 on a malformed loadavg line', (t) => {
  t.mock.method(fs, 'readFileSync', () => 'garbage\n');
  assert.equal(metrics.procCount(), 0);
});

test('uptimeSeconds floors the first uptime field', (t) => {
  t.mock.method(fs, 'readFileSync', () => '12345.67 88888.88\n');
  assert.equal(metrics.uptimeSeconds(), 12345);
});

test('uptimeSeconds returns 0 when the value is not finite', (t) => {
  t.mock.method(fs, 'readFileSync', () => 'x y\n');
  assert.equal(metrics.uptimeSeconds(), 0);
});
