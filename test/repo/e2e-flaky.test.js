const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { flakyTests, annotation, summary } = require('../../scripts/e2e-flaky');

const fixture = path.join(__dirname, 'fixtures', 'e2e-report.json');
const report = () => JSON.parse(fs.readFileSync(fixture, 'utf8'));
const CWD = '/home/runner/work/Stackyard/Stackyard';

test('a test that failed and then passed on its retry is listed, others are not', () => {
  assert.equal(report().stats.flaky, 1);
  assert.deepEqual(flakyTests(report(), CWD), [
    { title: 'group › fails once then passes', file: 'e2e/scratch.spec.js', line: 3, project: 'chromium' },
  ]);
});

test('each browser is listed apart', () => {
  const r = report();
  const spec = r.suites[0].suites[0].specs[0];
  spec.tests.push({ ...spec.tests[0], projectName: 'webkit' });
  r.suites[0].specs[0].tests[0].status = 'unexpected';
  assert.deepEqual(
    flakyTests(r, CWD).map(f => f.project),
    ['chromium', 'webkit'],
  );
});

test('a report from another checkout keeps the path the report holds', () => {
  assert.equal(flakyTests(report(), '/elsewhere')[0].file, 'scratch.spec.js');
});

test('no flaky test, no rows', () => {
  const r = report();
  r.suites[0].suites[0].specs[0].tests[0].status = 'expected';
  assert.deepEqual(flakyTests(r, CWD), []);
  assert.match(summary([]), /None\./);
});

test('the annotation points at the line and cannot be cut short by the title', () => {
  const line = annotation({ title: 'a, b: 100%\nnext', file: 'e2e/x,y.spec.js', line: 7, project: 'webkit' });
  assert.equal(line.split('\n').length, 1);
  assert.match(line, /^::warning file=e2e\/x%2Cy\.spec\.js,line=7,title=Flaky test::/);
  assert.match(line, /a, b: 100%25%0Anext \(e2e\/x,y\.spec\.js:7, webkit\)/);
});

test('a pipe in a title does not break the summary table', () => {
  const md = summary([{ title: 'a | b', file: 'e2e/x.spec.js', line: 1, project: 'chromium' }]);
  assert.match(md, /\| a \\\| b \| `e2e\/x\.spec\.js:1` \| chromium \|/);
});

test('the script writes the summary, the annotations and the step output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-flaky-'));
  const env = {
    ...process.env,
    GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    GITHUB_OUTPUT: path.join(dir, 'output'),
  };
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'e2e-flaky.js'), fixture], {
      env,
      encoding: 'utf8',
    });
    assert.match(out, /^::warning file=scratch\.spec\.js,line=3,title=Flaky test::group › fails once then passes/m);
    assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /\| group › fails once then passes \|/);
    assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'flaky=true\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
