const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const shards = yaml.load(read('.github/workflows/e2e.yml')).jobs.shards;
const step = name => {
  const found = shards.steps.find(s => s.name === name);
  assert.ok(found, `the e2e workflow lost its "${name}" step`);
  return found;
};
const config = require(path.join(root, 'playwright.config.js'));
const PASSWORD_ENV = /-e INITIAL_PASSWORD="\$\(node -p "require\('\.\/e2e\/base-url'\)\.PASSWORD"\)"/;

test('both e2e containers start with the password the specs sign in with', () => {
  assert.match(step('Start the container').run, PASSWORD_ENV);
  assert.match(step('Start the container').run, /-e TRUSTED_PROXY=/, 'uploads.spec.js names its client address');
  const auth = step('Start the sign-in container').run;
  assert.match(auth, PASSWORD_ENV);
  assert.match(auth, /-p 8733:80/);
  assert.match(auth, /-e TRUSTED_PROXY=/);
});

test('one shard runs the auth project, and starts its container', () => {
  const rows = shards.strategy.matrix.include.filter(r => r.auth === true);
  assert.equal(rows.length, 1, 'exactly one matrix row may lock out client addresses');
  assert.equal(rows[0].shard, '1/1');
  assert.match(step('Start the sign-in container').run, /^if \[ "\$AUTH" != true \]; then exit 0; fi$/m);
  assert.match(step('Run the specs').run, /if \[ "\$AUTH" = true \]; then set -- "\$@" --project=auth; fi/);
  assert.match(step('Stop the containers').run, /docker rm -f stackyard-e2e stackyard-e2e-auth/);
});

test('every browser project signs in first and reuses that session', () => {
  const projects = config.projects;
  const browsers = projects.filter(p => p.name === 'chromium' || p.name === 'webkit');
  assert.equal(browsers.length, 2);
  for (const p of browsers) {
    const [dep] = p.dependencies || [];
    const setup = projects.find(s => s.name === dep);
    assert.ok(setup, `${p.name} has no sign-in project`);
    assert.equal(setup.metadata.storageState, p.use.storageState);
    assert.ok(setup.testMatch.test('sign-in.setup.js'));
    assert.ok(p.testIgnore.test('auth.spec.js'), `${p.name} would run the lockout specs on the shared container`);
  }
  const auth = projects.find(p => p.name === 'auth');
  assert.ok(auth.testMatch.test('auth.spec.js'));
  assert.equal(auth.use.storageState, undefined);
  assert.equal(auth.dependencies, undefined);
});

test('the local e2e recipe starts the container with the same password', () => {
  const run = read('CONTRIBUTING.md')
    .split('\n')
    .find(l => l.startsWith('docker run -d --name stackyard-e2e '));
  assert.ok(run, 'the CONTRIBUTING.md e2e recipe lost its docker run line');
  assert.match(run, /-e INITIAL_PASSWORD="\$pw"/);
  assert.match(read('CONTRIBUTING.md'), /^pw=\$\(node -p "require\('\.\/e2e\/base-url'\)\.PASSWORD"\)$/m);
});
