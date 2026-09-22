const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(dockerfile, /if command -v npm \|\| command -v npx \|\| command -v yarn \|\| command -v corepack; then/);
  assert.match(dockerfile, /a package manager survived removal/);
});

test('node itself is still checked to work afterwards', () => {
  assert.match(dockerfile, /node -e "process\.exit\(0\)"/, 'removing the package managers must not break the runtime');
});

test('nothing in the image invokes a package manager', () => {
  /* An invocation is the name used as a command. A preceding slash marks a path
     being deleted, and `command -v` is the removal's own check. */
  const INVOKED = /(?:^|[\s;&|(])(npm|npx|yarn|corepack)\b/;
  for (const file of ['Dockerfile', 'docker-entrypoint.sh', 'supervisord.conf']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const invocations = src
      .split('\n')
      .map(l => l.replace(/#.*$/, '').replace(/command -v \w+/g, ''))
      .filter(l => INVOKED.test(l));
    assert.deepEqual(invocations, [], `${file} appears to use a package manager at runtime`);
  }
});

test('the API still declares no runtime dependencies', () => {
  /* A runtime dependency would need an install step, and the image has no
     package manager to run one. */
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'api', 'package.json'), 'utf8'));
  assert.deepEqual(
    pkg.dependencies ?? {},
    {},
    'the API has a runtime dependency, which the image can no longer install',
  );
});

/* setuptools arrives as an apk dependency of supervisor. The deletion has to
   share the RUN that installs it, or the files stay in that layer. */
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

/* One RUN, continuations and all. Matching a single line breaks the moment the
   step gains one, which is how a Dockerfile edit fails a test about setuptools. */
function runBlockContaining(needle) {
  const lines = dockerfile.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('RUN ')) continue;
    const block = [];
    for (let j = i; j < lines.length; j++) {
      block.push(lines[j]);
      /* A comment inside a continuation is dropped by the parser and does not
         end the step, so it carries no backslash of its own. */
      const isComment = lines[j].trim().startsWith('#');
      if (!isComment && !lines[j].endsWith('\\')) break;
    }
    const text = block.join('\n');
    if (text.includes(needle)) return text;
  }
  return null;
}

test('setuptools is removed in the layer that installs supervisor', () => {
  const run = [runBlockContaining('apk upgrade --no-cache')];
  assert.ok(run[0], 'the apk install step has been restructured');
  assert.match(
    run[0],
    /rm -rf \/usr\/lib\/python3\*\/site-packages\/setuptools/,
    'the deletion moved out of the install layer, so the files survive in it',
  );
});

test('the build proves the removal and that supervisord survives it', () => {
  assert.match(dockerfile, /if python3 -c 'import setuptools' 2>\/dev\/null; then/);
  assert.match(dockerfile, /setuptools survived removal/);
  assert.match(dockerfile, /supervisord --version/);
});

/* The base image is pinned by digest, so nothing else pulls a security update
   into the image. */
test('the build upgrades the base packages before installing anything', () => {
  assert.match(dockerfile, /apk upgrade --no-cache/, "the image would ship the base digest's packages unchanged");
  assert.ok(
    dockerfile.indexOf('apk upgrade') < dockerfile.indexOf('apk add'),
    'upgrade first, or the packages installed below are resolved against a stale index',
  );
});

/* The release build has a layer cache, and nothing above this step changes
   between releases. Without something per-release in it, the cache serves the
   upgrade and it silently stops fetching: that is how a published image came to
   carry a libexpat with two HIGH advisories against it. */
test('the upgrade cannot be served from a cache across releases', () => {
  const run = runBlockContaining('apk upgrade --no-cache');
  assert.ok(run, 'the upgrade step was not found');
  assert.match(run, /\$\{?APP_VERSION\}?/, 'nothing per-release is read here, so a cache can serve this layer forever');
  const argAt = dockerfile.lastIndexOf('ARG APP_VERSION', dockerfile.indexOf(run));
  assert.ok(argAt !== -1, 'APP_VERSION is read in the step but never declared above it');
});
