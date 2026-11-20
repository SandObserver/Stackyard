#!/usr/bin/env node
/* Lists the browser tests that failed and then passed on a retry, from a
   Playwright JSON report. Usage: node scripts/e2e-flaky.js <report.json>
   Writes a table to $GITHUB_STEP_SUMMARY, one warning annotation per test,
   and `flaky=true|false` to $GITHUB_OUTPUT. */

const fs = require('node:fs');
const path = require('node:path');

/** @typedef {{ title: string, file: string, line: number, project: string }} Flaky */

/** @param {any} report @param {string} [cwd] @returns {Flaky[]} */
function flakyTests(report, cwd = process.cwd()) {
  const rootDir = report?.config?.rootDir || '';
  /** @type {Flaky[]} */
  const out = [];
  const walk = (suite, titles) => {
    const inner = suite.file && suite.title === suite.file ? titles : [...titles, suite.title];
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        if (t.status !== 'flaky') continue;
        out.push({
          title: [...inner, spec.title].filter(Boolean).join(' › '),
          file: repoPath(rootDir, spec.file || suite.file || '', cwd),
          line: Number(spec.line) || 0,
          project: t.projectName || '',
        });
      }
    }
    for (const child of suite.suites || []) walk(child, inner);
  };
  for (const suite of report?.suites || []) walk(suite, []);
  return out;
}

/** @param {string} rootDir @param {string} file @param {string} cwd */
function repoPath(rootDir, file, cwd) {
  if (!rootDir || !file) return file;
  const rel = path.relative(cwd, path.resolve(rootDir, file));
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.split(path.sep).join('/');
}

/** @param {string} s */
const escapeData = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
/** @param {string} s */
const escapeProperty = s => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** @param {Flaky} f */
function annotation(f) {
  const where = `${f.file}:${f.line}`;
  return (
    `::warning file=${escapeProperty(f.file)},line=${f.line},title=${escapeProperty('Flaky test')}::` +
    escapeData(`${f.title} (${where}, ${f.project}) failed, then passed on a retry.`)
  );
}

/** @param {string} s */
const cell = s =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');

/** @param {Flaky[]} list */
function summary(list) {
  if (!list.length) return '### Flaky tests\n\nNone.\n';
  const rows = list.map(f => `| ${cell(f.title)} | \`${cell(`${f.file}:${f.line}`)}\` | ${cell(f.project)} |`);
  return [
    '### Flaky tests',
    '',
    `${list.length} failed, then passed on a retry. Traces are in the playwright-report artifact.`,
    '',
    '| Test | Location | Browser |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/e2e-flaky.js <report.json>');
    process.exit(2);
  }
  const list = flakyTests(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const f of list) console.log(annotation(f));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(list));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `flaky=${list.length > 0}\n`);
  console.log(`${list.length} flaky test${list.length === 1 ? '' : 's'}`);
}

if (require.main === module) main();

module.exports = { flakyTests, annotation, summary };
