/* Reads CHANGELOG.md as structure rather than prose: the Keep a Changelog
   headings, the Semantic Versioning numbering, and the compare links. Used by
   changelog-check.js, release-prep.js and release-notes.js so the three agree
   on what the file means. */

const { parseTag } = require('./is-prerelease.js');

const REPO = 'SandObserver/stackyard';

const HEADER = [
  '# Changelog',
  '',
  'All notable changes to this project are documented in this file.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
  'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
];

/* Keep a Changelog 1.1.0 defines these six and no others, in this order. */
const TYPES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

const VERSION_HEADING = /^##\s+\[([^\]]+)\](?:\s+-\s+(.*))?\s*$/;
const SECTION_HEADING = /^###\s+(.*?)\s*$/;
const LINK_DEF = /^\[([^\]]+)\]:\s+(\S+)\s*$/;
const BULLET = /^-\s+(.*)$/;

/** @typedef {{ text: string, line: number }} Entry */
/** @typedef {{ type: string, line: number, entries: Entry[] }} Section */
/** @typedef {{ name: string, date: string|null, line: number, sections: Section[] }} Version */

/** @param {string} markdown */
function parse(markdown) {
  const lines = String(markdown ?? '').split('\n');
  /** @type {Version[]} */
  const versions = [];
  /** @type {{ name: string, url: string, line: number }[]} */
  const links = [];
  let version = null;
  let section = null;
  let entry = null;

  lines.forEach((raw, i) => {
    const line = i + 1;
    const vh = VERSION_HEADING.exec(raw);
    if (vh) {
      version = { name: vh[1], date: vh[2] ? vh[2].trim() : null, line, sections: [] };
      versions.push(version);
      section = null;
      entry = null;
      return;
    }
    const sh = SECTION_HEADING.exec(raw);
    if (sh && version) {
      section = { type: sh[1], line, entries: [] };
      version.sections.push(section);
      entry = null;
      return;
    }
    const ld = LINK_DEF.exec(raw);
    if (ld) {
      links.push({ name: ld[1], url: ld[2], line });
      return;
    }
    const bullet = BULLET.exec(raw);
    if (bullet && section) {
      entry = { text: bullet[1].trim(), line };
      section.entries.push(entry);
      return;
    }
    /* A wrapped bullet continues the entry it is indented under. */
    if (entry && /^\s+\S/.test(raw)) {
      entry.text += ` ${raw.trim()}`;
      return;
    }
    if (!raw.trim()) entry = null;
  });

  const headerEnd = versions.length ? versions[0].line - 1 : lines.length;
  return { lines, versions, links, header: lines.slice(0, headerEnd) };
}

/** The dated sections, newest first. @param {ReturnType<parse>} doc */
const released = doc => doc.versions.filter(v => v.name !== 'Unreleased');

/** @param {ReturnType<parse>} doc */
const unreleased = doc => doc.versions.find(v => v.name === 'Unreleased') ?? null;

/** True when the date is a real calendar day, not just the right shape.
    @param {string|null} date */
function validDate(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Descending semver comparison. @param {string} a @param {string} b */
function compareVersions(a, b) {
  const pa = parseTag(a);
  const pb = parseTag(b);
  if (!pa || !pb) return 0;
  return pb.major - pa.major || pb.minor - pa.minor || pb.patch - pa.patch;
}

/** Compare links accept either capitalisation of the repository path: GitHub
    redirects one to the other and both forms are already in the file.
    @param {string} url @param {string} tail */
function linkMatches(url, tail) {
  const expected = new RegExp(`^https://github\\.com/${REPO}/${tail}$`, 'i');
  return expected.test(url);
}

/** The bump the entries imply. Advisory only: a tooling or docs addition is a
    patch, and no parser can tell that from a user-facing one.
    @param {Version} version */
function impliedBump(version) {
  const types = version.sections.map(s => s.type);
  if (types.includes('Removed')) return 'major';
  if (types.includes('Added') || types.includes('Changed')) return 'minor';
  return 'patch';
}

/** @param {string} from @param {string} to */
function actualBump(from, to) {
  const a = parseTag(from);
  const b = parseTag(to);
  if (!a || !b) return null;
  if (b.major > a.major) return 'major';
  if (b.minor > a.minor) return 'minor';
  if (b.patch > a.patch) return 'patch';
  return null;
}

module.exports = {
  HEADER,
  TYPES,
  REPO,
  parse,
  parseTagName: parseTag,
  released,
  unreleased,
  validDate,
  compareVersions,
  linkMatches,
  impliedBump,
  actualBump,
};
