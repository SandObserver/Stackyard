const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the image carries the licence and the notice', () => {
  assert.match(read('Dockerfile'), /^COPY LICENSE NOTICE \/usr\/share\/licenses\/stackyard\/$/m);
  const ignored = read('.dockerignore')
    .split('\n')
    .map(l => l.trim());
  for (const name of ['LICENSE', 'NOTICE'])
    assert.ok(!ignored.includes(name), `${name} is left out of the build context`);
});

test('the API package states the licence the repository uses', () => {
  assert.match(read('LICENSE'), /^\s*Apache License\s+Version 2\.0, January 2004/);
  assert.equal(JSON.parse(read('api/package.json')).license, 'Apache-2.0');
});
