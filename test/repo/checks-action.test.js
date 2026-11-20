const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const steps = yaml.load(fs.readFileSync(path.join(root, '.github/actions/checks/action.yml'), 'utf8')).runs.steps;
const at = name => steps.findIndex(s => s.name === name);
const WRITES = ['Stamp asset cache-busting', 'Verify stamping is settled'];
const SUITES = ['Run backend tests', 'Run frontend tests', 'Run repository tests'];

test('the static checks run before the test suites', () => {
  const firstSuite = Math.min(...SUITES.map(at));
  for (const name of [
    'Check the changelog',
    'Lint',
    'Check formatting',
    'Typecheck (backend)',
    'Typecheck (frontend)',
  ]) {
    assert.ok(at(name) !== -1, `${name} is gone from the checks action`);
    assert.ok(at(name) < firstSuite, `${name} should run before the test suites`);
  }
});

test('every check runs after an earlier check failed, unless the run was cancelled', () => {
  const install = steps.find(s => s.name === 'Install dev tooling');
  assert.equal(install?.id, 'install');
  const ids = new Set(steps.map(s => s.id).filter(Boolean));
  for (const step of steps.slice(at('Install dev tooling') + 1)) {
    if (WRITES.includes(step.name)) continue;
    const cond = String(step.if);
    assert.match(cond, /^\$\{\{ !cancelled\(\) && steps\.[\w-]+\.outcome == 'success'( && .+)? \}\}$/, step.name);
    assert.ok(ids.has(/steps\.([\w-]+)\.outcome/.exec(cond)[1]), `${step.name} waits on a step with no id`);
  }
});

test('the release stamp steps stop at the first failure', () => {
  for (const name of WRITES) {
    const step = steps[at(name)];
    assert.ok(step, `${name} is gone from the checks action`);
    assert.equal(step.if, "inputs.mode == 'release'", `${name} must keep the default success() condition`);
  }
  assert.ok(at(WRITES[0]) > Math.max(...SUITES.map(at)), 'stamping must follow the tests');
});

test('nothing in the checks runs with always()', () => {
  assert.deepEqual(
    steps.filter(s => /always\(\)/.test(String(s.if))).map(s => s.name),
    [],
  );
});

test('each test suite reports through the GitHub reporter', () => {
  assert.ok(fs.existsSync(path.join(root, 'scripts/test-reporter-github.js')));
  for (const name of SUITES) {
    const options = steps[at(name)]?.env?.NODE_OPTIONS || '';
    assert.equal(
      options,
      '--test-reporter=${{ github.workspace }}/scripts/test-reporter-github.js --test-reporter-destination=stdout',
      name,
    );
  }
});
