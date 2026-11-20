const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the Node floor matches the version CI and the image use', () => {
  const major = read('.nvmrc').trim();
  const api = JSON.parse(read('api/package.json'));
  const dev = JSON.parse(read('package.json'));
  assert.equal(api.engines?.node, `>=${major}`, 'api/package.json engines.node');
  assert.deepEqual(dev.devEngines?.runtime, { name: 'node', version: `>=${major}`, onFail: 'warn' });
  assert.match(read('Dockerfile'), new RegExp(`^FROM node:${major}-`, 'm'), 'Dockerfile base image');
});
