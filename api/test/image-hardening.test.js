const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* The runtime image ships no package manager.

   The base image brings npm, corepack and yarn, and their bundled dependencies
   were the entirety of what the release scan found: seven HIGH or CRITICAL
   issues, one of them critical, in tar, brace-expansion, ip-address and undici.
   Alpine reported none and the API reported none, because the API has no
   dependencies at all.

   Nothing in the container uses them. Supervisord runs nginx, node and python3,
   and there is nothing to install at runtime. Removing them takes the findings
   with them, and takes a package manager out of reach of anyone who gets into a
   running container.

   The Dockerfile checks this at build time too. This test is the cheaper half:
   it fails in seconds on a pull request, rather than at the end of a release
   build, if the removal is dropped or a COPY reintroduces one. */

const root = path.join(__dirname, '..', '..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('the Dockerfile removes npm, corepack and yarn', () => {
  for (const target of ['/usr/local/lib/node_modules/npm', '/usr/local/lib/node_modules/corepack', '/opt/yarn-*']) {
    assert.ok(dockerfile.includes(target), `${target} is no longer removed`);
  }
  for (const bin of ['/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/bin/corepack', '/usr/local/bin/yarn']) {
    assert.ok(dockerfile.includes(bin), `${bin} is no longer removed`);
  }
});

test('the removal is verified inside the build', () => {
  /* A path that stops matching after a base image bump would otherwise remove
     nothing and say nothing. */
  assert.match(dockerfile, /if command -v npm \|\| command -v npx \|\| command -v yarn \|\| command -v corepack; then/);
  assert.match(dockerfile, /a package manager survived removal/);
});

test('node itself is still checked to work afterwards', () => {
  assert.match(dockerfile, /node -e "process\.exit\(0\)"/,
    'removing the package managers must not break the runtime');
});

test('nothing in the image invokes a package manager', () => {
  /* If a future change needs npm at runtime, this fails and the removal has to
     be reconsidered rather than worked around.

     An invocation is the name used as a command. Every legitimate mention in
     these files is part of a path being deleted, so a preceding slash is what
     separates the two; `command -v` is the removal's own check. */
  const INVOKED = /(?:^|[\s;&|(])(npm|npx|yarn|corepack)\b/;
  for (const file of ['Dockerfile', 'docker-entrypoint.sh', 'supervisord.conf']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const invocations = src.split('\n')
      .map(l => l.replace(/#.*$/, '').replace(/command -v \w+/g, ''))
      .filter(l => INVOKED.test(l));
    assert.deepEqual(invocations, [], `${file} appears to use a package manager at runtime`);
  }
});

test('the API still declares no runtime dependencies', () => {
  /* The removal is only safe while this holds: a dependency would need an
     install step, and the image has nothing to run one with. */
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'api', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {},
    'the API has a runtime dependency, which the image can no longer install');
});
