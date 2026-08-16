#!/usr/bin/env node
/* Copies the newest released changelog section into the Community Applications
   template's <Changes> tag.

   The newest section in CHANGELOG.md is [Unreleased], which holds notes for
   work that has not shipped. Publishing those to the app store would describe
   the release as containing changes the image does not have, so only a dated
   version section is ever used. */

const fs = require('node:fs');
const path = require('node:path');

/* A version heading carries a date: "## [1.6.1] - 2026-08-14". [Unreleased]
   has none, which is what separates the two. */
const DATED_HEADING = /^##\s+\[([^\]]+)\]\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/;

/** The newest dated section of a changelog.

    @param {string} markdown
    @returns {{ version: string, date: string, body: string }|null} */
function newestRelease(markdown) {
  const lines = String(markdown ?? '').split('\n');
  let start = -1;
  let heading = null;
  for (let i = 0; i < lines.length; i++) {
    const m = DATED_HEADING.exec(lines[i]);
    if (m) {
      start = i;
      heading = m;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return {
    version: heading[1],
    date: heading[2],
    body: lines
      .slice(start + 1, end)
      .join('\n')
      .trim(),
  };
}

/* CA renders the tag as text. Angle brackets and ampersands would break the
   XML, and the reference-style link definitions at the foot of a section are
   noise in an app store listing. */
function toChangesText(release) {
  if (!release) return '';
  const body = release.body
    .split('\n')
    .filter(line => !/^\[[^\]]+\]:\s+https?:/.test(line))
    .join('\n')
    .trim();
  return `### ${release.version} - ${release.date}\n\n${body}`;
}

function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Replace the <Changes> element's contents. Returns the new document.

    @param {string} xml @param {string} text @returns {string} */
function writeChanges(xml, text) {
  const payload = `<Changes>\n${escapeXml(text)}\n  </Changes>`;
  if (!/<Changes>[\s\S]*?<\/Changes>/.test(xml)) {
    throw new Error('template has no <Changes> element');
  }
  return xml.replace(/<Changes>[\s\S]*?<\/Changes>/, payload);
}

module.exports = { newestRelease, toChangesText, writeChanges };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const changelog = path.join(root, 'CHANGELOG.md');
  const template = path.join(root, 'templates', 'stackyard.xml');

  const release = newestRelease(fs.readFileSync(changelog, 'utf8'));
  if (!release) {
    console.error('ca-changes: CHANGELOG.md has no dated version section');
    process.exit(1);
  }

  const before = fs.readFileSync(template, 'utf8');
  const after = writeChanges(before, toChangesText(release));
  if (before === after) {
    console.error(`ca-changes: template already describes ${release.version}`);
    console.log('changed=false');
    process.exit(0);
  }
  fs.writeFileSync(template, after);
  console.error(`ca-changes: template now describes ${release.version} (${release.date})`);
  console.log('changed=true');
}
