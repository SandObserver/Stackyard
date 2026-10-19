/* The README names what the image adds to its base. A dependency added to the
   API or a package added to the image makes that sentence false. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the README says what the image adds to its base', () => {
  assert.match(
    read('README.md'),
    /No runtime npm dependencies\.\*\* The image adds only nginx and supervisor, from Alpine, to the official Node base\./,
  );
});

test('the API declares no npm dependencies', () => {
  const pkg = JSON.parse(read('api/package.json'));
  assert.deepEqual(pkg.dependencies || {}, {});
});

test('the image installs nginx and supervisor and no other package', () => {
  const adds = [...read('Dockerfile').matchAll(/apk add\s+((?:--\S+\s+)*)([^&\\\n]+)/g)].map(m => m[2].trim());
  assert.deepEqual(adds, ['nginx supervisor']);
  assert.match(read('Dockerfile'), /^FROM node:\d+-alpine@sha256:[0-9a-f]{64}$/m);
});
