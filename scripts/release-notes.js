#!/usr/bin/env node
/* Prints one changelog section as release notes, for `gh release create
   --notes-file`. The reference-style link definitions are dropped: they resolve
   against the file, not against a release page.

   Usage: node scripts/release-notes.js <version> */

const fs = require('node:fs');
const path = require('node:path');
const cl = require('./changelog.js');

const ROOT = path.join(__dirname, '..');

/** @param {string} markdown @param {string} version */
function notesFor(markdown, version) {
  const doc = cl.parse(markdown);
  const wanted = doc.versions.find(v => v.name === version.replace(/^v/, ''));
  if (!wanted) return null;
  const next = doc.versions[doc.versions.indexOf(wanted) + 1];
  const end = next ? next.line - 1 : doc.lines.length;
  return doc.lines
    .slice(wanted.line, end)
    .filter(line => !/^\[[^\]]+\]:\s+https?:/.test(line))
    .join('\n')
    .trim();
}

module.exports = { notesFor };

if (require.main === module) {
  const version = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';
  const notes = notesFor(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) {
    console.error(`release-notes: CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
