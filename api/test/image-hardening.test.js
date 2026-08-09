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

/* setuptools arrives as an apk dependency of supervisor and is reported against
   CVE-2026-59890. It is deleted rather than accepted: supervisor has not needed
   it at runtime since Python 3.8, this image is 3.14, and the Alpine package
   ships no pkg_resources for anything to import.

   The deletion has to share the RUN that installs supervisor. In a later layer
   the files would still exist in this one, which is where a scanner reads them
   from and where the image would still carry them. */
test('the Dockerfile deletes setuptools', () => {
  for (const target of [
    '/usr/lib/python3*/site-packages/setuptools',
    '/usr/lib/python3*/site-packages/setuptools-*.dist-info',
    '/usr/lib/python3*/site-packages/_distutils_hack',
    '/usr/lib/python3*/site-packages/distutils-precedence.pth',
  ]) {
    assert.ok(dockerfile.includes(target), `${target} is no longer removed`);
  }
});

test('setuptools is removed in the layer that installs supervisor', () => {
  const run = /RUN apk add --no-cache nginx supervisor[\s\S]*?(?=\n(?:#|[A-Z]+ ))/.exec(dockerfile);
  assert.ok(run, 'the apk install step has been restructured');
  assert.match(run[0], /rm -rf \/usr\/lib\/python3\*\/site-packages\/setuptools/,
    'the deletion moved out of the install layer, so the files survive in it');
});

/* Deleting the files is only half of it. The build asserts nothing can import
   setuptools afterwards, and that supervisord, whose apk dependency brought it
   in, still starts without it. */
test('the build proves the removal and that supervisord survives it', () => {
  assert.match(dockerfile, /if python3 -c 'import setuptools' 2>\/dev\/null; then/);
  assert.match(dockerfile, /setuptools survived removal/);
  assert.match(dockerfile, /supervisord --version/);
});
