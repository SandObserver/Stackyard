/* CHANGELOG.md is a record and keeps links to files that were later removed.
   The pull request template links relative to github.com, not to the tree. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const docs = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(f => f && f !== 'CHANGELOG.md' && !f.startsWith('.github/'));

test('relative links in the repository docs point at files that exist', () => {
  const broken = [];
  for (const file of docs) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, target] of src.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#)/i.test(target)) continue;
      const rel = decodeURIComponent(target.split('#')[0]);
      if (!fs.existsSync(path.join(root, path.dirname(file), rel))) broken.push(`${file}: ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});
