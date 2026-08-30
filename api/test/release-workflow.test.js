const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

/* The release workflow runs on a tag only, so nothing else exercises it before a
   release. These pin what cannot be verified until a tag is cut. */

const root = path.join(__dirname, '..', '..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
const job = workflow.jobs['build-and-push'];
const steps = job.steps;
const byName = name => steps.find(s => s.name === name);
const indexOf = name => steps.findIndex(s => s.name === name);

test('the job asks for exactly the permissions it needs', () => {
  /* Without id-token, cosign fails after the release has already pushed. */
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

/* Every pushed platform, and only those, needs a build-and-scan pair ahead of
   it. A scan that reads fewer platforms than the push ships one unscanned. */
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

test('QEMU is set up before the arm64 build', () => {
  assert.ok(indexOf('Set up QEMU') !== -1, 'arm64 cannot be built on the runner without it');
  assert.ok(indexOf('Set up QEMU') < indexOf('Build arm64 for scanning'));
});

test('the image is addressed by digest everywhere after the build', () => {
  /* A tag can be moved between the scan and the pull. */
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
  /* Deciding twice pushes to a registry the build never logged in to. */
  const login = byName('Log in to Docker Hub');
  assert.equal(login.if, "steps.registries.outputs.dockerhub == 'true'");
  assert.ok(indexOf('Choose registries') < indexOf('Log in to Docker Hub'));
  const meta = byName('Extract metadata');
  assert.equal(meta.with.images, '${{ steps.registries.outputs.images }}');
  assert.ok(indexOf('Choose registries') < indexOf('Extract metadata'));
});

test('ghcr.io is published unconditionally', () => {
  const choose = byName('Choose registries');
  assert.match(choose.run, /echo 'ghcr\.io\/sandobserver\/stackyard'/);
  assert.equal(byName('Log in to GitHub Container Registry').if, undefined);
});

test('the checks still run before anything is published', () => {
  assert.ok(indexOf('Run project checks') < indexOf('Build and push'));
  assert.equal(byName('Run project checks').with.mode, 'release');
});

/* A tag must not publish an image the browser tests reject. */

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

/* Every other gate reads a locally built copy. These pin the checks that read
   the published image, and that nothing announces a release before they pass. */

test('the published image is verified, and the release page waits for it', () => {
  const verify = workflow.jobs['verify-published'];
  assert.ok(verify, 'the post-release verification job is gone');
  assert.deepEqual([].concat(verify.needs || []), ['build-and-push']);
  assert.deepEqual(
    [].concat(workflow.jobs['release-page'].needs || []),
    ['verify-published'],
    'a release page must not describe an image that failed verification',
  );
  assert.equal(job.outputs?.digest, '${{ steps.build.outputs.digest }}', 'the digest has to reach the verify job');
});

test('verification reads the digest, and checks what the docs tell a reader to check', () => {
  const runs = workflow.jobs['verify-published'].steps.filter(s => s.run).map(s => s.run);
  const cosign = runs.filter(r => r.includes('cosign'));
  assert.equal(cosign.length, 2, 'both the signature and the SBOM attestation are verified');
  for (const r of cosign) {
    assert.match(r, /stackyard@\$\{DIGEST\}/, 'a tag can be moved; verify the digest');
    assert.match(r, /--certificate-identity-regexp/);
    assert.match(r, /--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
  }
  assert.ok(
    cosign.some(r => r.includes('verify-attestation') && r.includes('--type spdxjson')),
    'the SBOM attestation is what --type spdxjson verifies',
  );
  assert.ok(
    runs.some(r => r.includes('/health')),
    'a signed image that does not boot is still a failed release',
  );
});

/* docs/security.md tells a reader to run these. Drift means the release verifies
   something the reader cannot reproduce. */
test('the documented verification flags are the ones the release runs', () => {
  const docs = fs.readFileSync(path.join(root, 'docs/security.md'), 'utf8');
  for (const flag of [
    "--certificate-identity-regexp '^https://github.com/SandObserver/stackyard/'",
    '--certificate-oidc-issuer https://token.actions.githubusercontent.com',
    '--type spdxjson',
  ]) {
    assert.ok(docs.includes(flag), `docs/security.md no longer documents ${flag}`);
  }
});
