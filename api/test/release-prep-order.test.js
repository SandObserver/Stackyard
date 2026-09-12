/* release-prep can abort after the fragments have been folded, so it plans the
   fold, runs every check, and only then writes and deletes. A local run that
   tripped a check used to lose the fragment files and leave CHANGELOG.md
   rewritten. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir } = require('../test-support/tmp');

const ROOT = path.join(__dirname, '..', '..');

function repoCopy(name) {
  const dir = path.join(tmpDir(name), 'repo');
  for (const p of ['scripts', 'changelog.d', 'api/package.json', 'render.yaml', 'CHANGELOG.md']) {
    const dst = path.join(dir, p);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(path.join(ROOT, p), dst, { recursive: true });
  }
  return dir;
}

const prep = (dir, version) => {
  try {
    execFileSync(process.execPath, ['scripts/release-prep.js', version], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status;
  }
};

test('a release that aborts keeps the fragments and the changelog', () => {
  const dir = repoCopy('relprep-abort');
  const before = fs.readdirSync(path.join(dir, 'changelog.d')).sort();
  const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
  /* Older than the last release, which is checked after the fold used to run. */
  assert.equal(prep(dir, '1.0.0'), 1);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'changelog.d')).sort(), before, 'the fragments were deleted');
  assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), changelog, 'the changelog was rewritten');
});

test('a release that succeeds still folds and deletes', () => {
  const dir = repoCopy('relprep-ok');
  const version = '99.0.0';
  assert.equal(prep(dir, version), 0);
  assert.deepEqual(
    fs.readdirSync(path.join(dir, 'changelog.d')).sort(),
    ['README.md'],
    'the fragments were left behind',
  );
  assert.match(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), new RegExp(`## \\[${version}\\]`));
});
