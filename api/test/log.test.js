const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../src/log');

/* Capture stdout for the duration of each test, and always restore the log
   level afterwards since it is module-level state. */
function capture(t) {
  const lines = [];
  t.mock.method(process.stdout, 'write', (s) => { lines.push(s); return true; });
  return lines;
}

afterEach(() => log.setLevel('info'));

test('emitted lines carry the level abbreviation and msg', (t) => {
  const lines = capture(t);
  log.info('hello');
  assert.match(lines[0], / INF msg=hello/);
});

test('level filtering drops entries below the threshold', (t) => {
  const lines = capture(t);
  log.setLevel('error');
  log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
  const joined = lines.join('');
  assert.doesNotMatch(joined, /msg=d/);
  assert.doesNotMatch(joined, /msg=i/);
  assert.match(joined, /msg=w/);
  assert.match(joined, /msg=e/);
});

test('audit entries always emit regardless of level', (t) => {
  const lines = capture(t);
  log.setLevel('error');
  log.audit('login', { user: 'a' });
  assert.match(lines.join(''), / AUD msg=login user=a/);
});

test('scalars print bare and objects print as JSON', (t) => {
  const lines = capture(t);
  log.info('m', { count: 9, widgets: ['a', 'b'] });
  assert.match(lines[0], /count=9/);
  assert.match(lines[0], /widgets=\["a","b"\]/);
});

test('Error data is expanded to message and stack, not {}', (t) => {
  const lines = capture(t);
  log.error('boom', new Error('kaboom'));
  assert.match(lines[0], /kaboom/);
  assert.doesNotMatch(lines[0], /error=\{\}/);
});

test('setLevel accepts known names and rejects unknown ones', () => {
  assert.equal(log.setLevel('debug'), true);
  assert.equal(log.setLevel('nonsense'), false);
});
