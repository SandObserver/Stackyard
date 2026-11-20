/* node:test reporter for GitHub Actions. Each failure becomes an ::error
   annotation on the failing line. Output a test file prints is shown only when
   that file has a failure. CI loads it through NODE_OPTIONS. */

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { fileURLToPath } = require('node:url');

const ROOT = path.join(__dirname, '..');

const escapeData = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const escapeProperty = s => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/* test:stdout names the file relative to the working directory, test:fail
   names it absolute. */
function absolute(file) {
  if (!file) return '';
  return path.resolve(file.startsWith('file:') ? fileURLToPath(file) : file);
}

function relative(file) {
  if (!file) return '';
  const abs = absolute(file);
  const rel = path.relative(ROOT, abs);
  return (rel.startsWith('..') ? abs : rel).split(path.sep).join('/');
}

/* A failed test's error wraps the thrown one in `cause`. */
function thrown(details) {
  const err = details?.error;
  return err?.cause ?? err;
}

function firstLine(err) {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.split('\n').find(l => l.trim()) || 'failed';
}

/* The deepest stack frame inside the test file, else the test's own line. */
function failingLine(err, file, fallback) {
  const stack = typeof err?.stack === 'string' ? err.stack : '';
  if (file) {
    const abs = absolute(file);
    for (const line of stack.split('\n')) {
      const m = /\(?((?:file:\/\/)?[^\s()]+):(\d+):\d+\)?$/.exec(line.trim());
      if (!m) continue;
      if (absolute(m[1]) === abs) return Number(m[2]);
    }
  }
  return fallback;
}

function annotation({ file, line, title, message }) {
  const props = [];
  if (file) props.push(`file=${escapeProperty(file)}`);
  if (line) props.push(`line=${escapeProperty(line)}`);
  if (title) props.push(`title=${escapeProperty(title)}`);
  return `::error${props.length ? ` ${props.join(',')}` : ''}::${escapeData(message)}\n`;
}

const code = s => `\`${String(s).replace(/`/g, "'").replace(/\n/g, ' ')}\``;

async function* githubReporter(source) {
  const output = new Map();
  const failures = [];
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };

  for await (const event of source) {
    const data = event.data || {};
    switch (event.type) {
      case 'test:stdout':
      case 'test:stderr': {
        const key = absolute(data.file);
        if (!output.has(key)) output.set(key, []);
        output.get(key).push(data.message);
        break;
      }
      case 'test:pass':
        if (data.details?.type === 'suite') break;
        if (data.skip) counts.skipped++;
        else if (data.todo) counts.todo++;
        else counts.passed++;
        break;
      case 'test:fail': {
        const failureType = data.details?.error?.failureType;
        if (data.details?.type === 'suite' || failureType === 'subtestsFailed') break;
        if (data.todo) {
          counts.todo++;
          break;
        }
        counts.failed++;
        const err = thrown(data.details);
        const file = relative(data.file);
        const failure = {
          file,
          line: failingLine(err, data.file, data.line),
          title: data.name,
          message: firstLine(err),
          key: absolute(data.file),
        };
        failures.push(failure);
        yield annotation(failure);
        yield `${util.inspect(err, { depth: 4 }).replace(/^/gm, '    ')}\n`;
        break;
      }
    }
  }

  const failedFiles = [...new Set(failures.map(f => f.key))];
  for (const key of failedFiles) {
    const chunks = output.get(key);
    if (!chunks?.length) continue;
    yield `::group::Output of ${relative(key) || 'the test run'}\n`;
    const text = chunks.join('');
    yield text.endsWith('\n') ? text : `${text}\n`;
    yield '::endgroup::\n';
  }

  const parts = [`${counts.passed} passed`, `${counts.failed} failed`];
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.todo) parts.push(`${counts.todo} todo`);
  yield `${parts.join(', ')}\n`;

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath && failures.length) {
    const suite = relative(process.cwd()) || '.';
    const lines = [`### ${failures.length} failed in ${code(suite)}`, ''];
    for (const f of failures) {
      lines.push(`- ${code(`${f.file}:${f.line ?? ''}`)} ${code(f.title)}: ${code(f.message)}`);
    }
    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n\n`);
  }
}

module.exports = githubReporter;
module.exports.escapeData = escapeData;
module.exports.escapeProperty = escapeProperty;
module.exports.annotation = annotation;
module.exports.failingLine = failingLine;
