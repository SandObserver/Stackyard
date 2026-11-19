/* Do not call a bare `tsc`. @typescript/typescript6 owns node_modules/.bin/tsc,
   so a bare `tsc` runs TypeScript 6. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const TSC = 'node node_modules/typescript/bin/tsc ';

for (const name of ['typecheck', 'typecheck:ui']) {
  test(`${name} calls the typescript package's own compiler`, () => {
    assert.ok(pkg.scripts[name].startsWith(TSC), `${name} must start with "${TSC}", not a bare tsc`);
  });
}

test('that compiler is the declared typescript version', () => {
  const out = execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--version'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(out.trim(), `Version ${pkg.devDependencies.typescript}`);
});
