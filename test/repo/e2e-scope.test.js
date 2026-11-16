const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const e2e = yaml.load(read('.github/workflows/e2e.yml'));
const steps = Object.values(e2e.jobs)[0].steps;
const filterAt = steps.findIndex(s => String(s.uses).startsWith('dorny/paths-filter@'));
const filterStep = steps[filterAt];
const patterns = yaml.load(filterStep.with.filters).e2e;
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const GATE = "steps.changes.outputs.e2e != 'false'";

/* Only forms that read the same here and in picomatch with dot: true. */
function matches(pattern, file) {
  if (pattern === '**') return true;
  if (/^[^*?[\]{}!]+\/\*\*$/.test(pattern)) return file.startsWith(pattern.slice(0, -2));
  const ext = /^((?:[^*?[\]{}!]+\/)?)\*(\.\w+)$/.exec(pattern);
  if (ext) {
    const [, dir, suffix] = ext;
    return file.startsWith(dir) && !file.slice(dir.length).includes('/') && file.endsWith(suffix);
  }
  if (/[*?[\]{}!]/.test(pattern)) throw new Error(`unsupported pattern ${pattern}`);
  return file === pattern;
}

const triggers = file => patterns.every(p => (p.startsWith('!') ? !matches(p.slice(1), file) : matches(p, file)));
const runsFor = files => files.some(triggers);

test('the filter step lists the changed files of a pull request only', () => {
  assert.ok(filterAt > 0, 'the e2e job lost its paths-filter step');
  assert.match(filterStep.uses, /^dorny\/paths-filter@[0-9a-f]{40}$/, 'pin the action by commit');
  assert.equal(filterStep.id, 'changes');
  assert.equal(filterStep.if, "github.event_name == 'pull_request' && github.event.pull_request.changed_files < 3000");
  assert.equal(filterStep.with['predicate-quantifier'], 'every');
  assert.ok(!('token' in filterStep.with), 'an empty token switches to git, which needs the base commits');
  assert.deepEqual(
    steps.slice(0, filterAt).map(s => s.name),
    ['Checkout'],
  );
});

test('the filter starts from every file and only removes paths', () => {
  assert.equal(patterns[0], '**');
  for (const p of patterns.slice(1)) {
    assert.ok(p.startsWith('!'), `${p} would narrow the suite to a list`);
    assert.doesNotThrow(() => matches(p.slice(1), ''), `${p} uses a form the test cannot check`);
  }
});

test('every step after the filter runs unless the filter says false', () => {
  const ungated = steps
    .slice(filterAt + 1)
    .filter(s => s.if !== GATE && !/^(failure|always)\(\)$/.test(String(s.if)))
    .map(s => s.name);
  assert.deepEqual(ungated, []);
  assert.ok(steps.some(s => s.name === 'Run the specs' && s.if === GATE));
});

test('the suite runs for a change to anything the image copies', () => {
  const ignored = read('.dockerignore')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('!') && !/[*?[]/.test(l));
  const sources = [];
  for (const line of read('Dockerfile').split('\n')) {
    const m = /^COPY\s+(?!--from)(.+)$/.exec(line);
    if (m) sources.push(...m[1].trim().split(/\s+/).slice(0, -1));
  }
  assert.ok(sources.includes('api/') && sources.includes('ui/'), 'the Dockerfile COPY lines were not found');
  const missed = [];
  for (const src of sources) {
    for (const file of tracked.filter(f => f === src || f.startsWith(src.endsWith('/') ? src : `${src}/`))) {
      if (triggers(file)) continue;
      if (ignored.some(i => file === i || file.startsWith(`${i}/`))) continue;
      missed.push(file);
    }
  }
  assert.deepEqual(missed, [], 'these reach the image but would skip the browser tests');
  for (const file of ['Dockerfile', '.dockerignore']) assert.ok(triggers(file), file);
});

test('the suite runs for a change to anything the specs read', () => {
  const specFiles = [...tracked.filter(f => f.startsWith('e2e/')), 'playwright.config.js'];
  const reads = [];
  for (const file of specFiles) {
    for (const m of read(file).matchAll(/['"`](\.\.\/[^'"`$]+)['"`]/g)) {
      reads.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    }
  }
  assert.ok(reads.length > 0, 'no file read by the specs was found');
  const missed = [...specFiles, ...reads, 'package.json', 'package-lock.json', '.nvmrc'].filter(f => !triggers(f));
  assert.deepEqual(missed, []);
});

test('the filter decides each kind of change as intended', () => {
  const cases = [
    [['README.md'], false],
    [['docs/support.md', 'CHANGELOG.md'], false],
    [['api/test/link-url.test.js', 'ui/test/x.test.mjs', 'test/repo/x.test.js'], false],
    [['templates/stackyard.xml', 'scripts/release-notes.js'], false],
    [['.github/workflows/test.yml', '.github/dependabot.yml'], false],
    [['api/src/server.js'], true],
    [['ui/js/admin.js'], true],
    [['ui/README.md'], true],
    [['README.md', 'nginx/dashboard.conf'], true],
    [['docs/moved.js', 'ui/js/moved.js'], true],
    [['a-new-file.txt'], true],
    [['scripts/a-new-script.js'], true],
    [['.github/workflows/e2e.yml'], true],
    [['scripts/bump-cache-busting.js'], true],
    [['scripts/exit-on-fatal.py'], true],
  ];
  for (const [files, expected] of cases) assert.equal(runsFor(files), expected, files.join(', '));
});

test('the release grants the called e2e job what it asks for', () => {
  const release = yaml.load(read('.github/workflows/release.yml'));
  const asked = Object.values(e2e.jobs)[0].permissions;
  const granted = release.jobs.e2e.permissions || release.permissions;
  for (const [scope, level] of Object.entries(asked)) {
    assert.equal(granted[scope], level, `the release call would fail: ${scope} is not granted`);
  }
});
