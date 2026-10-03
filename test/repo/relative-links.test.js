/* CHANGELOG.md is a record and keeps links to files that were later removed.
   The pull request template links relative to github.com, not to the tree. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'coverage']);

function markdownFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) markdownFiles(p, out);
    } else if (e.name.endsWith('.md') && p !== path.join(root, 'CHANGELOG.md')) out.push(p);
  }
  return out;
}

const LINK = [
  /\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*)?\)/g,
  /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm,
  /\b(?:src|href)\s*=\s*["']([^"']+)["']/g,
];

function targets(src) {
  return LINK.flatMap(re => [...src.matchAll(re)].map(m => m[1]));
}

test('relative links in the repository docs point at files that exist', () => {
  const broken = [];
  for (const file of markdownFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const target of targets(src)) {
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
      const rel = decodeURIComponent(target.split(/[?#]/)[0]);
      if (!fs.existsSync(path.join(path.dirname(file), rel))) broken.push(`${path.relative(root, file)}: ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the link scan reads every link form the docs use', () => {
  assert.deepEqual(targets('[a](x.md) [b](y.md "Title") <img src="z.png"> <a href=\'w.md#top\'>w</a>\n[ref]: v.md\n'), [
    'x.md',
    'y.md',
    'v.md',
    'z.png',
    'w.md#top',
  ]);
});
