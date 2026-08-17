#!/usr/bin/env node
/* Gates CHANGELOG.md.

   Structure fails the run: the Keep a Changelog header, the six section names,
   a real date on every released version, descending Semantic Versioning, and a
   compare link per version. Those are what make the file a usable record, and a
   broken one is not repairable from the release later.

   Style only warns, and only about [Unreleased]. Whether a line is plain
   English is a review call, and rewriting a shipped entry would falsify the
   record.

   Usage: node scripts/changelog-check.js [--release <version>] [--file <path>] */

const fs = require('node:fs');
const path = require('node:path');
const cl = require('./changelog.js');

const ROOT = path.join(__dirname, '..');
let FILE = 'CHANGELOG.md';

const ACTIONS = process.env.GITHUB_ACTIONS === 'true';

/** @type {{ line: number, message: string }[]} */
const errors = [];
/** @type {{ line: number, message: string }[]} */
const warnings = [];

let releaseVersion = null;

const fail = (line, message) => errors.push({ line, message });
const warn = (line, message) => warnings.push({ line, message });

function checkHeader(doc) {
  const got = doc.header.map(l => l.trimEnd()).filter(l => l !== '');
  const want = cl.HEADER.filter(l => l !== '');
  if (got.join('\n') !== want.join('\n')) {
    fail(1, `the header must be the Keep a Changelog boilerplate with both links, exactly:\n${want.join('\n')}`);
  }
}

function checkVersions(doc) {
  const unreleased = cl.unreleased(doc);
  if (!unreleased) fail(1, 'there is no [Unreleased] section');
  else if (doc.versions[0] !== unreleased) fail(unreleased.line, '[Unreleased] must be the first section');
  if (doc.versions.filter(v => v.name === 'Unreleased').length > 1) fail(1, 'more than one [Unreleased] section');

  const releases = cl.released(doc);
  if (!releases.length) fail(1, 'no released version section');

  for (const v of releases) {
    if (!cl.parseTagName(v.name)) fail(v.line, `"${v.name}" is not a valid semantic version`);
    if (!cl.validDate(v.date)) fail(v.line, `[${v.name}] needs a real date in YYYY-MM-DD form, got "${v.date ?? ''}"`);
    if (!v.sections.length) fail(v.line, `[${v.name}] has no entries`);
    checkSections(v);
  }

  for (let i = 1; i < releases.length; i++) {
    const older = releases[i];
    const newer = releases[i - 1];
    if (cl.compareVersions(newer.name, older.name) >= 0) {
      fail(older.line, `[${older.name}] is not older than [${newer.name}]; versions run newest first`);
    }
    if (cl.validDate(newer.date) && cl.validDate(older.date) && older.date > newer.date) {
      fail(older.line, `[${older.name}] is dated after [${newer.name}]`);
    }
  }

  if (unreleased) checkSections(unreleased);
}

/* Section order is enforced on what is being written now. A shipped section is
   a record: two of them list Security before Fixed, and reordering them would
   edit history to satisfy a linter. */
function checkSections(version) {
  const strict = version.name === 'Unreleased' || version.name === releaseVersion;
  const seen = [];
  for (const s of version.sections) {
    if (!cl.TYPES.includes(s.type)) {
      fail(s.line, `"${s.type}" is not a Keep a Changelog section; use one of ${cl.TYPES.join(', ')}`);
      continue;
    }
    if (seen.includes(s.type)) fail(s.line, `[${version.name}] repeats the ${s.type} section`);
    seen.push(s.type);
    if (!s.entries.length) fail(s.line, `[${version.name}] has an empty ${s.type} section`);
  }
  if (!strict) return;
  const order = seen.map(t => cl.TYPES.indexOf(t));
  if (order.some((n, i) => i > 0 && n < order[i - 1])) {
    fail(version.line, `[${version.name}] lists its sections out of order; use ${cl.TYPES.join(', ')}`);
  }
}

function checkLinks(doc) {
  const releases = cl.released(doc);
  const byName = new Map();
  for (const link of doc.links) {
    if (byName.has(link.name)) fail(link.line, `[${link.name}] has more than one link definition`);
    byName.set(link.name, link);
  }

  const wanted = ['Unreleased', ...releases.map(v => v.name)];
  for (const name of wanted) {
    if (!byName.has(name)) fail(doc.lines.length, `[${name}] has no link definition at the foot of the file`);
  }
  for (const link of doc.links) {
    if (!wanted.includes(link.name)) fail(link.line, `[${link.name}] links to a section that does not exist`);
  }

  const newest = releases[0];
  const unreleasedLink = byName.get('Unreleased');
  if (newest && unreleasedLink && !cl.linkMatches(unreleasedLink.url, `compare/v${newest.name}...HEAD`)) {
    fail(unreleasedLink.line, `[Unreleased] must compare v${newest.name}...HEAD`);
  }

  for (let i = 0; i < releases.length; i++) {
    const v = releases[i];
    const link = byName.get(v.name);
    if (!link) continue;
    const previous = releases[i + 1];
    /* Nothing precedes the first release, so it points at its own tag. */
    const tail = previous ? `compare/v${previous.name}...v${v.name}` : `releases/tag/v${v.name}`;
    if (!cl.linkMatches(link.url, tail)) fail(link.line, `[${v.name}] must link to ${tail}`);
  }
}

/* Mechanical halves of the writing standard. Everything here is a warning: the
   judgement of whether a sentence is plain stays with the reviewer. */
const BANNED = [
  [/\byou\b|\byour\b|\bwe\b|\bour\b/i, 'writes to the reader; state the fact about the software'],
  [/as (discussed|shown|requested)|per your|screenshot/i, 'refers to a conversation, not to the change'],
  [/\bsimply\b|\bobviously\b|\bjust\b|\beasily\b/i, 'filler'],
  [/—/, 'em dash'],
  [/\b(because|since|so that|in order to)\b/i, 'explains why; the entry states what changed'],
  [/^(added|fixed|changed|removed|updated|improved)\b/i, 'past tense; entries are imperative'],
  [/^(this|it|these)\b/i, 'starts with a pronoun rather than the thing that changed'],
];

const MAX_LENGTH = 160;

function checkStyle(version) {
  if (!version) return;
  for (const section of version.sections) {
    for (const entry of section.entries) {
      const text = entry.text.replace(/`[^`]*`/g, 'x');
      for (const [pattern, why] of BANNED) {
        if (pattern.test(text)) warn(entry.line, `${why}: "${short(entry.text)}"`);
      }
      if (entry.text.length > MAX_LENGTH) {
        warn(entry.line, `entry is ${entry.text.length} characters; keep it to one line: "${short(entry.text)}"`);
      }
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length > 2) {
        warn(entry.line, `entry runs to ${sentences.length} sentences; one, or two when the second is an action`);
      }
    }
  }
}

const short = text => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

/** The release-time half: the changelog, the package version and the demo pin
    must all name the same release. */
function checkRelease(doc, version) {
  const releases = cl.released(doc);
  const newest = releases[0];
  if (!newest || newest.name !== version) {
    fail(newest ? newest.line : 1, `the newest dated section is [${newest ? newest.name : 'none'}], not [${version}]`);
  }
  const unreleased = cl.unreleased(doc);
  if (unreleased && unreleased.sections.length) {
    fail(unreleased.line, '[Unreleased] still holds entries; they belong in the release being cut');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'package.json'), 'utf8'));
  if (pkg.version !== version) fail(1, `api/package.json is ${pkg.version}, not ${version}`);

  const render = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
  const pinned = /stackyard:(\S+)/.exec(render);
  if (!pinned || pinned[1] !== version) {
    fail(1, `render.yaml pins the demo to ${pinned ? pinned[1] : 'nothing'}, not ${version}`);
  }

  const previous = releases[1];
  if (previous && newest) {
    const implied = cl.impliedBump(newest);
    const actual = cl.actualBump(previous.name, newest.name);
    if (actual && actual !== implied) {
      warn(newest.line, `entries imply a ${implied} bump, but ${previous.name} to ${version} is a ${actual} one`);
    }
  }
}

function report() {
  for (const w of warnings) {
    if (ACTIONS) console.log(`::warning file=${FILE},line=${w.line}::${w.message}`);
    else console.error(`${FILE}:${w.line}: warning: ${w.message}`);
  }
  for (const e of errors) {
    if (ACTIONS) console.log(`::error file=${FILE},line=${e.line}::${e.message}`);
    else console.error(`${FILE}:${e.line}: error: ${e.message}`);
  }
  const counts = `${errors.length} error(s), ${warnings.length} warning(s)`;
  console.error(`changelog-check: ${counts}`);
  return errors.length === 0;
}

function main(argv) {
  const releaseAt = argv.indexOf('--release');
  const version = releaseAt === -1 ? null : argv[releaseAt + 1];
  if (releaseAt !== -1 && !version) {
    console.error('changelog-check: --release needs a version');
    return false;
  }
  const fileAt = argv.indexOf('--file');
  if (fileAt !== -1) {
    if (!argv[fileAt + 1]) {
      console.error('changelog-check: --file needs a path');
      return false;
    }
    FILE = argv[fileAt + 1];
  }
  releaseVersion = version;
  const doc = cl.parse(fs.readFileSync(path.resolve(ROOT, FILE), 'utf8'));
  checkHeader(doc);
  checkVersions(doc);
  checkLinks(doc);
  checkStyle(cl.unreleased(doc));
  if (version) {
    checkStyle(cl.released(doc)[0]);
    checkRelease(doc, version);
  }
  return report();
}

module.exports = { main };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)) ? 0 : 1);
}
