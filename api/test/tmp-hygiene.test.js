const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const testDir = __dirname;
/* This file names the very patterns it forbids, in its own assertions and
   messages, so it is excluded from its own scan. */
const SELF = path.basename(__filename);
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js') && f !== SELF);
const read = f => fs.readFileSync(path.join(testDir, f), 'utf8');

/* The helper itself is the one place allowed to call mkdtempSync. */
const HELPER = path.join('..', 'test-support', 'tmp.js');

test('the scan sees the suite', () => {
  assert.ok(files.length > 40, `only ${files.length} test files found`);
});

test('no test creates a temporary directory of its own', () => {
  const offenders = files.filter(f => /mkdtemp/.test(read(f)));
  assert.deepEqual(
    offenders,
    [],
    `Use tmpDir() from test-support/tmp.js, which removes the directory on exit:\n  ${offenders.join('\n  ')}`,
  );
});

test('no test names a fixed path under /tmp', () => {
  const offenders = files.filter(f => /['"]\/tmp\//.test(read(f)));
  assert.deepEqual(
    offenders,
    [],
    `A fixed /tmp path persists between runs. Use tmpPath() from test-support/tmp.js:\n  ${offenders.join('\n  ')}`,
  );
});

/* os.tmpdir() joined by hand is the same hazard wearing a portable hat. */
test('no test builds its own path from os.tmpdir()', () => {
  const offenders = files.filter(f => /os\.tmpdir\(\)/.test(read(f)));
  assert.deepEqual(
    offenders,
    [],
    `Use tmpDir() or tmpPath() rather than composing a path from os.tmpdir():\n  ${offenders.join('\n  ')}`,
  );
});

/* The guarantee rests entirely on the helper removing what it made. */
test('the helper registers cleanup for every directory it creates', () => {
  const src = fs.readFileSync(path.join(testDir, HELPER), 'utf8');
  assert.match(src, /process\.on\('exit'/, 'cleanup must be registered');
  assert.match(src, /rmSync/, 'cleanup must actually remove the directory');
  assert.match(src, /created\.push\(/, 'every directory made must be recorded for removal');
});

test('cleanup does not depend on a test hook', () => {
  const src = fs.readFileSync(path.join(testDir, HELPER), 'utf8');
  assert.ok(
    !/require\('node:test'\)/.test(src),
    'the helper must not need the test runner; it is used at module scope',
  );
});
