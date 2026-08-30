const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

/* The release workflow runs on a tag and nowhere else, so no pull request ever
   exercises it. Its first outing after a change is the release itself, which is
   how v1.5.0-rc.1 came to publish nothing at all.

   These are the properties that cannot be verified any other way until a tag is
   cut: what the job is allowed to do, that the supply-chain steps run in an
   order where each has something to work on, and that nothing addresses the
   image by a tag when a digest is available. */

const root = path.join(__dirname, '..', '..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
const job = workflow.jobs['build-and-push'];
const steps = job.steps;
const byName = name => steps.find(s => s.name === name);
const indexOf = name => steps.findIndex(s => s.name === name);

test('the job asks for exactly the permissions it needs', () => {
  /* id-token is what keyless signing exchanges for a Sigstore certificate.
     Without it cosign fails at the end of a release that has already pushed. */
  assert.deepEqual(job.permissions, { contents: 'read', packages: 'write', 'id-token': 'write' });
});

test('every action is pinned to a full commit sha', () => {
  const unpinned = steps
    .filter(s => s.uses && !s.uses.startsWith('./'))
    .map(s => s.uses)
    .filter(u => !/@[0-9a-f]{40}$/.test(u));
  assert.deepEqual(unpinned, [], 'a tag can be moved; pin the commit');
});

test('the supply-chain steps run after the build, in an order that works', () => {
  const build = indexOf('Build and push');
  assert.ok(build !== -1, 'the build step is gone');
  for (const name of ['Install cosign', 'Sign the image', 'Generate SBOM', 'Upload SBOM']) {
    assert.ok(indexOf(name) > build, `${name} must run after the build`);
  }
  assert.ok(indexOf('Install cosign') < indexOf('Sign the image'), 'cosign must be installed before it is used');
  assert.ok(indexOf('Generate SBOM') < indexOf('Upload SBOM'), 'the SBOM must exist before it is uploaded');
});

/* Every platform in the push, and only those, must have a build-and-scan pair
   ahead of it. arm64 shipped unscanned for several releases because the scan
   read one platform while the push carried two. */
const publishedPlatforms = String(byName('Build and push').with.platforms)
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);
const scanBuilds = steps.filter(s => /^Build \S+ for scanning$/.test(s.name || ''));

test('every published platform is scanned before anything is pushed', () => {
  assert.deepEqual(
    scanBuilds.map(s => s.with.platforms).sort(),
    [...publishedPlatforms].sort(),
    'a platform is published that nothing scanned',
  );

  for (const built of scanBuilds) {
    const arch = built.with.platforms.replace('linux/', '');
    const scan = byName(`Scan the ${arch} image`);
    assert.ok(scan, `${arch} has no scan step`);
    assert.ok(indexOf(built.name) < indexOf(scan.name), `${arch}: there is nothing to scan yet`);
    assert.ok(indexOf(scan.name) < indexOf('Build and push'), `${arch}: a scanned image is one that has not shipped`);
    assert.equal(built.with.push, false, `${arch}: the gate must not publish what it is gating`);
    assert.equal(built.with.load, true, `${arch}: trivy reads it from the local daemon`);
    assert.equal(built.with.tags, scan.with['image-ref'], `${arch}: the scan must read the image just built`);
    assert.match(
      String(built.with['build-args']),
      /APP_VERSION=\$\{\{ steps\.meta\.outputs\.version \}\}/,
      `${arch}: a different build-arg would build different layers from the ones pushed`,
    );
    assert.match(String(built.with['cache-to']), /type=gha/, `${arch}: the push step rebuilds this from cache`);
  }

  assert.match(
    String(byName('Build and push').with['cache-from']),
    /type=gha/,
    'without the shared cache every platform is built twice over',
  );
});

test('a high or critical finding fails the job, on either platform', () => {
  for (const built of scanBuilds) {
    const arch = built.with.platforms.replace('linux/', '');
    const scan = byName(`Scan the ${arch} image`);
    assert.equal(scan.with['exit-code'], '1', `${arch}: a finding must fail the release, not just print`);
    assert.equal(scan.with.severity, 'HIGH,CRITICAL', arch);
    assert.equal(scan.with['ignore-unfixed'], true, arch);
  }
});

/* Emulation is set up for the whole job, but arm64 is the step that cannot
   build without it. */
test('QEMU is set up before the arm64 build', () => {
  assert.ok(indexOf('Set up QEMU') !== -1, 'arm64 cannot be built on the runner without it');
  assert.ok(indexOf('Set up QEMU') < indexOf('Build arm64 for scanning'));
});

test('the image is addressed by digest everywhere after the build', () => {
  /* A tag can be moved between being scanned and being pulled. The digest is
     the artifact that was actually examined. */
  for (const name of ['Sign the image', 'Generate SBOM']) {
    const step = byName(name);
    const text = JSON.stringify(step.with || step.run || '');
    assert.match(text, /steps\.build\.outputs\.digest|\$\{DIGEST\}/, `${name} should use the build digest`);
    assert.doesNotMatch(text, /stackyard:\$\{\{ steps\.meta/, `${name} should not address the image by tag`);
  }
});

test('latest is decided by the semver check, not by looking for a hyphen', () => {
  const meta = byName('Extract metadata');
  const latest = String(meta.with.tags)
    .split('\n')
    .find(l => l.includes('value=latest'));
  assert.ok(latest, 'the latest tag rule is gone');
  assert.match(latest, /steps\.tag\.outputs\.prerelease == 'false'/);
  assert.doesNotMatch(latest, /contains\(github\.ref_name/, 'the hyphen heuristic is back');
  assert.ok(indexOf('Classify the tag') < indexOf('Extract metadata'), 'the classification must come first');
});

test('Docker Hub is optional, and decided once', () => {
  /* Deciding separately in an `if:` and in the tag list is how a build pushes
     to a registry it never logged in to. */
  const login = byName('Log in to Docker Hub');
  assert.equal(login.if, "steps.registries.outputs.dockerhub == 'true'");
  assert.ok(indexOf('Choose registries') < indexOf('Log in to Docker Hub'));
  const meta = byName('Extract metadata');
  assert.equal(meta.with.images, '${{ steps.registries.outputs.images }}');
  assert.ok(indexOf('Choose registries') < indexOf('Extract metadata'));
});

test('ghcr.io is published unconditionally', () => {
  /* Whatever happens with the mirror, the registry the project documents has to
     receive the release. */
  const choose = byName('Choose registries');
  assert.match(choose.run, /echo 'ghcr\.io\/sandobserver\/stackyard'/);
  assert.equal(byName('Log in to GitHub Container Registry').if, undefined);
});

test('the checks still run before anything is published', () => {
  assert.ok(indexOf('Run project checks') < indexOf('Build and push'));
  assert.equal(byName('Run project checks').with.mode, 'release');
});

/* A tag must not publish an image the browser tests reject.

   The end-to-end suite found a bug that made every write fail on a mapped port,
   and it found it after that code had already shipped in 1.5.0. Running it on
   pull requests stops the next one merging; gating the release stops one
   reaching a registry if it slips through anyway. */

test('the release waits for the end-to-end suite', () => {
  assert.equal(
    workflow.jobs.e2e?.uses,
    './.github/workflows/e2e.yml',
    'the release should call the same e2e workflow, not a copy of it',
  );
  assert.deepEqual([].concat(job.needs || []), ['e2e'], 'publishing must depend on the browser tests');
});

test('the e2e workflow can be called, and still runs on its own', () => {
  const e2e = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/e2e.yml'), 'utf8'));
  /* `on:` parses as true in YAML 1.1, which js-yaml follows. */
  const triggers = e2e.on || e2e[true];
  for (const t of ['workflow_call', 'pull_request', 'push', 'workflow_dispatch']) {
    assert.ok(t in triggers, `the e2e workflow lost its ${t} trigger`);
  }
  assert.ok(
    !triggers.pull_request?.paths,
    'e2e is a required check, so a path filter would block a pull request that never runs it',
  );
});
