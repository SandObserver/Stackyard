/* P7-3 and P7-4: tests left temporary files behind, and some wrote to shared
   paths.

   Two shapes, one cause — nothing owned the cleanup.

   A test that called fs.mkdtempSync directly usually never removed the result.
   Measured before this landed: one run left 49 directories behind, and 2,354
   had accumulated over three days, about 205 MB.

   A test that pointed CONFIG_PATH at a fixed path such as
   /tmp/stackyard-auth-test-nonexistent.json was relying on nothing ever
   creating it. That held until a test called something that writes config, at
   which point the file survived the run and every later run read what the last
   one stored. It happened during this work: a stale secret kept reappearing
   and the failure looked like a bug in the code under test.

   test-support/tmp.js is the one way to get a temporary path, and registers
   removal. These tests keep it the only way. */

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

/* The half that actually caused a failure. A fixed path is shared between runs
   and between developers, and is only safe while nothing writes to it. */
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

/* Cleanup on exit rather than in an after() hook is deliberate: most of these
   tests need their path at module scope, to set CONFIG_PATH before requiring
   the module that reads it. A hook would run far too late. */
test('cleanup does not depend on a test hook', () => {
  const src = fs.readFileSync(path.join(testDir, HELPER), 'utf8');
  assert.ok(
    !/require\('node:test'\)/.test(src),
    'the helper must not need the test runner; it is used at module scope',
  );
});
