const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const REPORTER = path.join(root, 'scripts', 'test-reporter-github.js');
const reporter = require(REPORTER);
const { escapeData, escapeProperty, annotation, failingLine } = reporter;

async function collect(events, env = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    async function* source() {
      yield* events;
    }
    let out = '';
    for await (const chunk of reporter(source())) out += chunk;
    return out;
  } finally {
    for (const k of Object.keys(env)) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
}

function failure(name, file, { line = 1, message = 'boom', stackLine } = {}) {
  const cause = new Error(message);
  if (stackLine) cause.stack = `Error: ${message}\n    at TestContext.<anonymous> (${file}:${stackLine}:7)`;
  const error = Object.assign(new Error('test failed'), { failureType: 'testCodeFailure', cause });
  return { type: 'test:fail', data: { name, file, line, details: { type: 'test', error } } };
}

test('message data escapes percent, CR and LF', () => {
  assert.equal(escapeData('100% sure\r\nnext'), '100%25 sure%0D%0Anext');
  assert.equal(escapeData('a:b,c'), 'a:b,c');
});

test('properties also escape colon and comma', () => {
  assert.equal(escapeProperty('values: a,b\n%'), 'values%3A a%2Cb%0A%25');
});

test('an annotation names the file, line and test', () => {
  assert.equal(
    annotation({ file: 'api/test/x.test.js', line: 12, title: 'adds: 1,2', message: 'expected 3\nactual 4' }),
    '::error file=api/test/x.test.js,line=12,title=adds%3A 1%2C2::expected 3%0Aactual 4\n',
  );
  assert.equal(annotation({ message: 'plain' }), '::error::plain\n');
});

test('the failing line is the deepest frame in the test file', () => {
  const file = path.join(root, 'api/test/x.test.js');
  const err = new Error('x');
  err.stack = [
    'Error: x',
    `    at helper (${path.join(root, 'api/src/y.js')}:4:1)`,
    `    at TestContext.<anonymous> (${file}:30:5)`,
    `    at file://${file}:10:3`,
  ].join('\n');
  assert.equal(failingLine(err, file, 2), 30);
  assert.equal(failingLine(err, `file://${file}`, 2), 30);
  assert.equal(failingLine(new Error('no frame'), file, 2), 2);
});

test('output is shown for failed files only, with one annotation per failed test', async () => {
  const passFile = path.join(root, 'api/test/pass.test.js');
  const failFile = path.join(root, 'api/test/fail.test.js');
  const summary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-')), 'summary.md');
  const out = await collect(
    [
      { type: 'test:stdout', data: { file: passFile, message: 'NOISE from a passing file\n' } },
      { type: 'test:pass', data: { name: 'fine', file: passFile, details: { type: 'test' } } },
      { type: 'test:pass', data: { name: 'skipped', file: passFile, skip: true, details: { type: 'test' } } },
      { type: 'test:stderr', data: { file: path.relative(process.cwd(), failFile), message: 'server log line\n' } },
      failure('adds, badly', failFile, { line: 3, message: 'sum is wrong\nmore', stackLine: 9 }),
      {
        type: 'test:fail',
        data: {
          name: 'group',
          file: failFile,
          line: 2,
          details: { type: 'suite', error: { failureType: 'subtestsFailed' } },
        },
      },
    ],
    { GITHUB_STEP_SUMMARY: summary },
  );
  const errors = out.split('\n').filter(l => l.startsWith('::error'));
  assert.deepEqual(errors, ['::error file=api/test/fail.test.js,line=9,title=adds%2C badly::sum is wrong']);
  assert.doesNotMatch(out, /NOISE/);
  assert.match(out, /::group::Output of api\/test\/fail\.test\.js\nserver log line\n::endgroup::\n/);
  assert.match(out, /\n1 passed, 1 failed, 1 skipped\n$/);
  const md = fs.readFileSync(summary, 'utf8');
  assert.match(md, /`api\/test\/fail\.test\.js:9` `adds, badly`: `sum is wrong`/);
});

test('a clean run prints only the counts and writes no summary', async () => {
  const summary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-')), 'summary.md');
  const out = await collect(
    [
      { type: 'test:stdout', data: { file: 'a.js', message: 'quiet\n' } },
      { type: 'test:pass', data: { name: 'one', file: 'a.js', details: { type: 'test' } } },
      { type: 'test:pass', data: { name: 'suite', file: 'a.js', details: { type: 'suite' } } },
    ],
    { GITHUB_STEP_SUMMARY: summary },
  );
  assert.equal(out, '1 passed, 0 failed\n');
  assert.equal(fs.existsSync(summary), false);
});

/* The same form the checks action sets, so a Node change to the event shape or
   to NODE_OPTIONS fails here first. */
test('node --test loads it from NODE_OPTIONS and annotates a real failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporter-run-'));
  fs.writeFileSync(path.join(dir, 'pass.test.js'), "require('node:test')('quiet', () => { console.log('NOISE'); });\n");
  fs.writeFileSync(
    path.join(dir, 'fail.test.js'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "test('loud', () => {",
      "  console.log('kept output');",
      "  assert.equal(1, 2, 'one is not two');",
      '});',
      '',
    ].join('\n'),
  );
  const env = { ...process.env, NODE_OPTIONS: `--test-reporter=${REPORTER} --test-reporter-destination=stdout` };
  delete env.GITHUB_STEP_SUMMARY;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^::error file=[^,]*\/fail\.test\.js,line=5,title=loud::one is not two$/m);
  assert.match(r.stdout, /::group::Output of .*fail\.test\.js\nkept output\n::endgroup::/);
  assert.doesNotMatch(r.stdout, /NOISE/);
  assert.match(r.stdout, /^1 passed, 1 failed$/m);
});
