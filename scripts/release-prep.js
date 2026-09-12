#!/usr/bin/env node
/* Prepares a release: dates the [Unreleased] section, adds its compare link,
   bumps api/package.json, and moves the demo image pin in render.yaml.

   Writes files. Run it on a branch, never on the default branch.

   Usage: node scripts/release-prep.js <version> [--date YYYY-MM-DD] */

const fs = require('node:fs');
const path = require('node:path');
const cl = require('./changelog.js');
const fragments = require('./changelog-fragments.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s, 'utf8');

const die = message => {
  console.error(`release-prep: ${message}`);
  process.exit(1);
};

/** @param {string} markdown @param {string} version @param {string} date */
function dateTheSection(markdown, version, date) {
  const doc = cl.parse(markdown);
  const unreleased = cl.unreleased(doc);
  if (!unreleased) die('CHANGELOG.md has no [Unreleased] section');
  if (!unreleased.sections.length) die('[Unreleased] is empty; there is nothing to release');

  const previous = cl.released(doc)[0] ?? null;
  if (previous && cl.compareVersions(version, previous.name) >= 0) {
    die(`${version} is not newer than the last release, ${previous.name}`);
  }

  const lines = markdown.split('\n');
  lines.splice(unreleased.line, 0, '', `## [${version}] - ${date}`);

  const links = cl.parse(lines.join('\n')).links;
  const unreleasedLink = links.find(l => l.name === 'Unreleased');
  if (!unreleasedLink) die('CHANGELOG.md has no [Unreleased] link definition');
  const base = `https://github.com/${cl.REPO}`;
  lines[unreleasedLink.line - 1] = `[Unreleased]: ${base}/compare/v${version}...HEAD`;
  const tail = previous ? `compare/v${previous.name}...v${version}` : `releases/tag/v${version}`;
  lines.splice(unreleasedLink.line, 0, `[${version}]: ${base}/${tail}`);

  return { markdown: lines.join('\n'), previous: previous ? previous.name : null };
}

function main(argv) {
  const version = argv[0];
  const dateAt = argv.indexOf('--date');
  const date = dateAt === -1 ? new Date().toISOString().slice(0, 10) : argv[dateAt + 1];

  if (!version || !cl.parseTagName(version)) die(`"${version ?? ''}" is not a valid semantic version`);
  if (version.startsWith('v')) die('give the version without the leading v');
  if (!cl.validDate(date)) die(`"${date}" is not a date in YYYY-MM-DD form`);

  /* Nothing is written or deleted until every check has passed. dateTheSection
     and the two pins below still abort, and a run that folded first left the
     changelog rewritten and the fragment files gone. */
  const plan = fragments.planFold(read('CHANGELOG.md'));
  const changed = dateTheSection(plan.markdown, version, date);

  const pkgPath = 'api/package.json';
  const pkg = read(pkgPath);
  const bumped = pkg.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (bumped === pkg) die(`${pkgPath} has no version field to bump`);

  const renderPath = 'render.yaml';
  const render = read(renderPath);
  const pinned = render.replace(/(stackyard:)\d+\.\d+\.\d+\S*/, `$1${version}`);
  if (pinned === render) die(`${renderPath} does not pin an image tag; the demo would stay on the old release`);

  write('CHANGELOG.md', changed.markdown);
  write(pkgPath, bumped);
  write(renderPath, pinned);
  fragments.commitFold(plan);

  console.error(`release-prep: ${changed.previous ?? 'first release'} -> ${version} (${date})`);
  console.log(`version=${version}`);
  console.log(`date=${date}`);
  console.log(`previous=${changed.previous ?? ''}`);
}

module.exports = { dateTheSection };

if (require.main === module) main(process.argv.slice(2));
