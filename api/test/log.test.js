const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../src/log');

/* Capture stdout for the duration of each test, and always restore the log
   level afterwards since it is module-level state. */
function capture(t) {
  const lines = [];
  t.mock.method(process.stdout, 'write', s => {
    lines.push(s);
    return true;
  });
  return lines;
}

afterEach(() => log.setLevel('info'));

test('emitted lines carry the level abbreviation and msg', t => {
  const lines = capture(t);
  log.info('hello');
  assert.match(lines[0], / INF msg=hello/);
});

test('level filtering drops entries below the threshold', t => {
  const lines = capture(t);
  log.setLevel('error');
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  const joined = lines.join('');
  assert.doesNotMatch(joined, /msg=d/);
  assert.doesNotMatch(joined, /msg=i/);
  assert.match(joined, /msg=w/);
  assert.match(joined, /msg=e/);
});

test('audit entries always emit regardless of level', t => {
  const lines = capture(t);
  log.setLevel('error');
  log.audit('login', { user: 'a' });
  assert.match(lines.join(''), / AUD msg=login user=a/);
});

test('scalars print bare and objects print as JSON', t => {
  const lines = capture(t);
  log.info('m', { count: 9, widgets: ['a', 'b'] });
  assert.match(lines[0], /count=9/);
  assert.match(lines[0], /widgets=\["a","b"\]/);
});

test('Error data is expanded to message and stack, not {}', t => {
  const lines = capture(t);
  log.error('boom', new Error('kaboom'));
  assert.match(lines[0], /kaboom/);
  assert.doesNotMatch(lines[0], /error=\{\}/);
});

test('setLevel accepts known names and rejects unknown ones', () => {
  assert.equal(log.setLevel('debug'), true);
  assert.equal(log.setLevel('nonsense'), false);
});

/* ── P1-4: values were printed bare ───────────────────────────────────────────
   A value containing a newline ended the line and started another, so one
   log.error call could emit a second line indistinguishable from a genuine AUD
   record. Values reach the logger from config (widget types, item ids), from
   hostnames, and from upstream error messages. Spaces and '=' broke parsing more
   quietly, splitting one field into several. */

test('a newline in a value cannot forge a second log line', t => {
  const lines = capture(t);
  log.error('widget-data failed', { widget: 'books\n2026-01-01T00:00:00.000Z AUD msg=config saved by=attacker' });
  assert.equal(lines.length, 1, 'one call must produce one write');
  assert.equal(lines[0].split('\n').filter(Boolean).length, 1, 'and one line');
  assert.match(lines[0], /\\n/, 'the newline is escaped, not discarded');
  assert.ok(lines[0].includes('by=attacker'), 'the value itself is kept, it is only made safe');
});

test('carriage returns and other control characters are escaped too', t => {
  const lines = capture(t);
  log.error('e', { a: 'x\ry', b: 'x\tz', c: 'x\u0007y', d: 'x\u007fy' });
  assert.equal(lines[0].split('\n').filter(Boolean).length, 1);
  assert.match(lines[0], /a="x\\ry"/);
  assert.match(lines[0], /b="x\\tz"/);
  assert.match(lines[0], /c="x\\u0007y"/);
  assert.match(lines[0], /d="x\\u007fy"/);
});

test('a value containing spaces or = is quoted so fields stay separable', t => {
  const lines = capture(t);
  log.warn('invalid manifest', { widget: 'name=x other=y', errors: 'a b c' });
  assert.match(lines[0], /widget="name=x other=y"/);
  assert.match(lines[0], /errors="a b c"/);
});

test('a quote inside a value is escaped when the value is quoted', t => {
  const lines = capture(t);
  log.error('e', { a: 'say "hi" now' });
  assert.match(lines[0], /a="say \\"hi\\" now"/);
});

test('a backslash is escaped so it cannot swallow the closing quote', t => {
  const lines = capture(t);
  log.error('e', { a: 'ends with\\', b: 'next' });
  assert.match(lines[0], /a="ends with\\\\" b=next/);
});

test('a leading quote is escaped, since a parser reads it as a value opener', t => {
  const lines = capture(t);
  log.error('e', { a: '"leading' });
  assert.match(lines[0], /a="\\"leading"/);
});

test('msg is quoted on the same terms as any other value', t => {
  const lines = capture(t);
  log.info('two words');
  assert.match(lines[0], /msg="two words"/);
  log.info('oneword');
  assert.match(lines[1], /msg=oneword/);
});

test('a value needing no quoting prints exactly as before', t => {
  const lines = capture(t);
  log.info('boot', { count: 9, id: 'w1', ok: true, ratio: 1.5 });
  assert.match(lines[0], / msg=boot count=9 id=w1 ok=true ratio=1\.5\n$/);
});

/* The file header documents this shape, and a bare token with no whitespace is
   unambiguous, so an embedded quote does not force the whole value to be
   wrapped and re-escaped. */
test('JSON values stay readable rather than being wrapped and escaped', t => {
  const lines = capture(t);
  log.info('widget registry loaded', { count: 2, widgets: ['backup', 'books'] });
  assert.match(lines[0], /widgets=\["backup","books"\]/);
});

test('an Error nested in data is still expanded, and stays on one line', t => {
  const lines = capture(t);
  const e = new Error('boom\nsecond line');
  log.error('failed', { error: e });
  assert.equal(lines[0].split('\n').filter(Boolean).length, 1);
  assert.ok(lines[0].includes('boom'));
});

test('null and undefined values still print empty', t => {
  const lines = capture(t);
  log.info('m', { a: null, b: undefined, c: 'x' });
  assert.match(lines[0], / a= b= c=x/);
});

/* The property behind all of the above: a logfmt reader gets back exactly what
   was logged. Asserting on the emitted text alone would pass for an encoding
   that is self-consistent but unreadable, so this decodes instead. */
test('every value round-trips through a logfmt parser', t => {
  const lines = capture(t);
  const values = [
    'plain',
    'two words',
    'a=b',
    'has"quote',
    '"leading',
    'trail\\',
    'line\nbreak',
    'tab\there',
    'ctrl\u0007char',
    '',
    ' ',
    '===',
    '\\\\',
    '{"a":1}',
  ];
  for (const v of values) log.info('t', { v });

  const unesc = s =>
    s
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

  values.forEach((expected, i) => {
    const line = lines[i].trimEnd();
    assert.equal(line.split('\n').length, 1, `${JSON.stringify(expected)} spanned lines`);
    const m = /\sv=(?:"((?:[^"\\]|\\.)*)"|(\S*))/.exec(line);
    assert.ok(m, `could not find the field in ${line}`);
    const got = m[1] !== undefined ? unesc(m[1]) : m[2] || '';
    assert.equal(got, expected, `round trip failed for ${JSON.stringify(expected)}`);
  });
});
