#!/usr/bin/env node
/* Prints one changelog section as release notes, for `gh release create
   --notes-file`. The reference-style link definitions are dropped: they resolve
   against the file, not against a release page.

   Usage: node scripts/release-notes.js <version> */

const fs = require('node:fs');
const path = require('node:path');
const cl = require('./changelog.js');

const ROOT = path.join(__dirname, '..');

/** The section a tag describes.

    A prerelease has no section of its own: the changelog is dated when the
    stable version is cut. `v1.8.0-beta.1` reads the 1.8.0 section if it already
    exists, and [Unreleased] otherwise, which is what it is a candidate for.

    @param {string} markdown @param {string} version */
function sectionFor(doc, version) {
  const name = version.replace(/^v/, '');
  const exact = doc.versions.find(v => v.name === name);
  if (exact) return exact;
  const parsed = cl.parseTagName(name);
  if (!parsed || !parsed.prerelease) return null;
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const stable = doc.versions.find(v => v.name === base);
  if (stable) return stable;
  const unreleased = cl.unreleased(doc);
  return unreleased && unreleased.sections.length ? unreleased : null;
}

/** @param {string} markdown @param {string} version */
function notesFor(markdown, version) {
  const doc = cl.parse(markdown);
  const wanted = sectionFor(doc, version);
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
