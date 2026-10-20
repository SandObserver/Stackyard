const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const wf = yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', 'demo.yml'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'demo', 'wrangler.jsonc'), 'utf8'));
const usesSecret = job => JSON.stringify(job).includes('secrets.CLOUDFLARE');

test('only the demo environment hands out the Cloudflare token', () => {
  for (const [name, job] of Object.entries(wf.jobs)) {
    if (usesSecret(job))
      assert.equal(job.environment, 'demo', `${name} reads a Cloudflare secret outside the environment`);
  }
  assert.ok(!usesSecret(wf.jobs.build), 'the build job runs dev dependencies');
  assert.ok(!usesSecret(wf.jobs.verify), 'the verify job runs dev dependencies');
});

test('the demo address is in the config and applied when a version goes live', () => {
  assert.deepEqual(config.routes, [{ pattern: 'demo.sandobserver.com', custom_domain: true }]);
  const deploy = wf.jobs.promote.steps.find(s => String(s.with?.command || '').includes('versions deploy'));
  assert.ok(deploy, 'the promote job no longer deploys a version');
  assert.match(deploy.with.command, /^\s*triggers deploy\s*$/m, 'a version upload alone leaves the address unset');
});

test('the first-run placeholder never takes the demo address', () => {
  const prep = wf.jobs.upload.steps.find(s => s.name === 'Prepare the placeholder');
  assert.ok(prep, 'the placeholder step is gone');
  assert.match(prep.run, /delete c\.routes/);
  assert.doesNotMatch(prep.run, /cp upload\/wrangler\.jsonc placeholder/);
});
