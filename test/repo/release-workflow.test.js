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
  }
});

/* Any job with a runtime token can write the gha cache, including the ones that
   run dev dependencies. A planted layer would be signed. */
test('the signed image is not built from a cache other jobs can write', () => {
  for (const s of steps.filter(step => /build-push-action/.test(step.uses || ''))) {
    assert.equal(s.with['cache-from'], undefined, `${s.name} reads an outside cache`);
    assert.equal(s.with['cache-to'], undefined, `${s.name} writes an outside cache`);
  }
  assert.equal(
    byName('Set up Docker Buildx').with?.driver,
    undefined,
    'the push reuses the scan layers from the builder',
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

/* Dev dependencies run install scripts and the linters. They must not run
   where the publishing and signing tokens are. */
test('the checks run in their own read-only job before anything is published', () => {
  const checks = workflow.jobs.checks;
  assert.ok(checks, 'the release has no checks job');
  assert.deepEqual(checks.permissions, { contents: 'read' });
  const step = checks.steps.find(s => s.uses === './.github/actions/checks');
  assert.equal(step?.with?.mode, 'release');
  assert.ok([].concat(job.needs).includes('checks'), 'publishing must wait for the checks');
});

test('the publishing job runs no dev tooling', () => {
  assert.equal(indexOf('Run project checks'), -1);
  for (const s of steps) {
    assert.ok(!String(s.uses || '').startsWith('./'), `${s.name}: a local action can install dev dependencies`);
    assert.doesNotMatch(
      String(s.run || ''),
      /\b(npm|npx|yarn|pnpm|corepack)\b|node_modules/,
      `${s.name} runs a package manager`,
    );
    if (/actions\/setup-node@/.test(s.uses || '')) assert.equal(s.with?.cache, undefined, `${s.name} restores a cache`);
  }
});

test('the QEMU and BuildKit images are pinned by digest', () => {
  assert.match(byName('Set up QEMU').with?.image || '', /^docker\.io\/tonistiigi\/binfmt:\S+@sha256:[0-9a-f]{64}$/);
  assert.match(
    byName('Set up Docker Buildx').with?.['driver-opts'] || '',
    /^image=moby\/buildkit:\S+@sha256:[0-9a-f]{64}$/,
  );
});

/* A tag must not publish an image the browser tests reject. */

test('the release waits for the end-to-end suite', () => {
  assert.equal(
    workflow.jobs.e2e?.uses,
    './.github/workflows/e2e.yml',
    'the release should call the same e2e workflow, not a copy of it',
  );
  assert.ok([].concat(job.needs || []).includes('e2e'), 'publishing must depend on the browser tests');
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

test('the e2e workflow stops and restarts the built image after the specs', () => {
  const e2e = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/e2e.yml'), 'utf8'));
  const e2eSteps = Object.values(e2e.jobs)[0].steps;
  const at = e2eSteps.findIndex(s => s.name === 'Stop and restart the container');
  assert.ok(
    at > e2eSteps.findIndex(s => s.name === 'Run the specs'),
    'the restart must run on the config the specs saved',
  );
  const run = e2eSteps[at].run;
  assert.match(run, /docker stop -t \d+ stackyard-e2e/);
  assert.match(run, /"\$code" = 137/, 'a container killed after the stop timeout must fail the job');
  assert.match(run, /docker start stackyard-e2e/);
  assert.match(run, /"\$before" != "\$after"/, 'the restart must leave the saved config as it was');
});

test('the browser package cache matches only the same Playwright version', () => {
  const e2e = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/e2e.yml'), 'utf8'));
  const cache = Object.values(e2e.jobs)[0].steps.find(s => s.name === 'Cache system packages for the browsers');
  assert.match(cache.with.key, /steps\.image\.outputs\.playwright/);
  assert.ok(!cache.with['restore-keys'], 'a partial hit installs an older package set and skips --with-deps');
});

test('the scheduled scan reads Node.js from the image binary', () => {
  const scan = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/scan-published.yml'), 'utf8'));
  const step = scan.jobs.scan.steps.find(s => s.name === "Check the image's Node.js for missed security releases");
  assert.doesNotMatch(step.run, /NODE_VERSION/, 'the runtime stage is FROM scratch and has no NODE_VERSION');
  assert.match(step.run, /--platform "\$PLATFORM" --entrypoint node/);
  assert.match(step.run, /-p process\.versions\.node/);
  const qemu = scan.jobs.scan.steps.find(s => String(s.uses).startsWith('docker/setup-qemu-action@'));
  assert.ok(qemu, 'the arm64 binary needs QEMU on an amd64 runner');
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

test('the attestation payload is kept out of the job log', () => {
  const runs = workflow.jobs['verify-published'].steps.filter(s => s.run).map(s => s.run);
  const attestation = runs.find(r => r.includes('verify-attestation'));
  assert.ok(attestation, 'the SBOM attestation is verified');
  assert.match(
    attestation,
    />\s*\S+/,
    'the payload is one line of about two megabytes; printing it stalls the log stream until the job times out',
  );
});

test('the identity pattern matches the identity the release signs with', () => {
  const identity = 'https://github.com/SandObserver/Stackyard/.github/workflows/release.yml@refs/tags/v1.0.0';
  const runs = workflow.jobs['verify-published'].steps.filter(s => s.run).map(s => s.run);
  const patterns = runs.flatMap(r => [...r.matchAll(/--certificate-identity-regexp '([^']+)'/g)].map(m => m[1]));
  assert.equal(patterns.length, 2);
  for (const pattern of patterns) {
    assert.match(identity, new RegExp(pattern), `no signature can satisfy ${pattern}`);
  }
});

const vexCall = workflow.jobs.vex;
const vexWorkflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/vex.yml'), 'utf8'));
const vexJob = vexWorkflow.jobs.attach;
const vexStep = name => {
  const step = vexJob.steps.find(s => s.name === name);
  assert.ok(step, `the ${name} step is gone`);
  return step;
};

test('the VEX statements are attached in their own job, which cannot hold up the release', () => {
  assert.deepEqual(vexCall.needs, 'build-and-push');
  assert.equal(job.outputs.dockerhub, '${{ steps.registries.outputs.dockerhub }}');
  assert.equal(vexCall.if, "needs.build-and-push.outputs.dockerhub == 'true'");
  assert.equal(vexCall.uses, './.github/workflows/vex.yml');
  assert.equal(vexCall.with.digest, '${{ needs.build-and-push.outputs.digest }}');
  assert.equal(vexCall.with.version, '${{ needs.build-and-push.outputs.version }}');
  assert.deepEqual(Object.keys(vexCall.secrets), ['DOCKERHUB_TOKEN']);
  assert.equal(
    vexJob['continue-on-error'],
    "${{ github.event_name != 'workflow_dispatch' }}",
    'a Scout failure must not fail a published release, and must fail a run by hand',
  );
  assert.ok(vexJob['timeout-minutes'] <= 10, 'a hung Scout call must end on its own');
  assert.deepEqual(vexCall.permissions, { contents: 'read' });
  assert.deepEqual(vexJob.permissions, { contents: 'read' });
  for (const [name, other] of Object.entries(workflow.jobs)) {
    assert.ok(![other.needs].flat().includes('vex'), `${name} must not wait for the VEX job`);
  }
  assert.equal(steps.filter(s => /scout/i.test(`${s.name} ${s.uses || ''}`)).length, 0);
});

test('a published version can be given its VEX statements by hand', () => {
  assert.deepEqual(Object.keys(vexWorkflow.on.workflow_dispatch.inputs), ['version']);
  const resolve = vexStep('Resolve the image');
  assert.ok(vexJob.steps.indexOf(resolve) < vexJob.steps.indexOf(vexStep('Prepare the VEX statements')));
  assert.equal(resolve.env.DIGEST, '${{ inputs.digest }}');
  assert.match(resolve.run, /\*\[!0-9A-Za-z\.-\]\*/, 'the version lands in an image reference');
  assert.match(resolve.run, /imagetools inspect "\$\{IMAGE\}:\$\{VERSION\}"/);
  assert.match(resolve.run, /TAG=v\$VERSION/);
});

test('a statement is attached only to an image that ships the patched musl', () => {
  const prepare = vexStep('Prepare the VEX statements');
  assert.match(prepare.env.MUSL_FIXED, /^\d+\.\d+\.\d+-r\d+$/);
  for (const arch of publishedPlatforms) assert.match(prepare.run, new RegExp(`\\b${arch.split('/')[1]}\\b`));
  assert.match(prepare.run, /\/lib\/apk\/db\/installed/);
  assert.match(prepare.run, /sort -V/);
  assert.match(prepare.run, /Not attaching\."\s*exit 1/);
  assert.match(prepare.run, /"@id" = \$id \| \.timestamp = \$now/, 'each release needs its own document id and date');
  assert.match(prepare.run, /\.products = \[\{"@id": \$product\}\]/);
});

test('the Scout program is pinned by digest and attaches by referrer', () => {
  const prepare = vexJob.steps.indexOf(vexStep('Prepare the VEX statements'));
  const attach = vexStep('Attach the VEX statements');
  assert.ok(prepare < vexJob.steps.indexOf(attach), 'nothing to attach yet');
  assert.match(attach.env.SCOUT_IMAGE, /^docker\.io\/docker\/scout-cli:[\d.]+@sha256:[0-9a-f]{64}$/);
  assert.match(attach.run, /--referrer\b/, 'attaching into the index changes the signed digest');
  assert.match(attach.run, /--org "\$NAMESPACE"/, 'Scout refuses to attach without the organisation');
  assert.match(attach.run, /"\$\{IMAGE\}@\$\(cat "\$RUNNER_TEMP\/digest-\$arch"\)"/);
  assert.doesNotMatch(attach.run, /registry:\/\//, 'attestation add reads the scheme as a host name');
  assert.match(attach.run, /--predicate-type https:\/\/openvex\.dev\/ns\/v0\.2\.0/);
  assert.match(attach.run, /--file "\/vex\/stackyard-\$arch\.vex\.json"/);
  assert.match(vexStep('Prepare the VEX statements').run, /"\$RUNNER_TEMP\/stackyard-\$arch\.vex\.json"/);
  for (const step of vexJob.steps.filter(s => s.uses)) assert.match(step.uses, /@[0-9a-f]{40}$/, step.uses);
});

test('the VEX document is one Docker Scout accepts, and names no real image by itself', () => {
  const vex = JSON.parse(fs.readFileSync(path.join(root, '.github/vex/stackyard.vex.json'), 'utf8'));
  assert.equal(vex['@context'], 'https://openvex.dev/ns/v0.2.0');
  assert.ok(vex.author, 'Scout rejects a document without an author');
  assert.match(vex['@id'], /\{tag\}/);
  assert.ok(vex.statements.length > 0);
  const justifications = [
    'component_not_present',
    'vulnerable_code_not_present',
    'vulnerable_code_not_in_execute_path',
    'vulnerable_code_cannot_be_controlled_by_adversary',
    'inline_mitigations_already_exist',
  ];
  for (const s of vex.statements) {
    assert.match(s.vulnerability.name, /^CVE-\d{4}-\d+$/);
    assert.equal(s.status, 'not_affected', 'Scout suppresses nothing for any other status');
    assert.ok(justifications.includes(s.justification), `${s.vulnerability.name}: ${s.justification}`);
    for (const p of s.products) assert.match(p['@id'], /@\{version\}$/, 'unstamped, it would cover every release');
  }
});
