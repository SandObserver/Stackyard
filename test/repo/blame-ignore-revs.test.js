const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

const shas = fs
  .readFileSync(path.join(root, '.git-blame-ignore-revs'), 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' }).trim();
const needsHistory = { skip: shallow === 'true' ? 'shallow clone has no history' : false };

test('every ignored revision is a full commit hash', () => {
  assert.ok(shas.length > 0);
  for (const sha of shas) assert.match(sha, /^[0-9a-f]{40}$/, sha);
});

test('every ignored revision is a commit on HEAD', needsHistory, () => {
  for (const sha of shas) {
    assert.equal(git('cat-file', '-e', `${sha}^{commit}`).status, 0, `${sha} does not exist`);
    assert.equal(git('merge-base', '--is-ancestor', sha, 'HEAD').status, 0, `${sha} is not an ancestor of HEAD`);
  }
});
