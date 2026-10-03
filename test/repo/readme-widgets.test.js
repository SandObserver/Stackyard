const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const section = readme.slice(readme.indexOf('## Widgets'), readme.indexOf('## Getting started'));
const key = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

test('the README lists every shipped widget', () => {
  const listed = new Set([...section.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(m => key(m[1])));
  const shipped = fs
    .readdirSync(path.join(root, 'ui', 'widgets'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  assert.deepEqual(
    shipped.filter(name => !listed.has(key(name))),
    [],
  );
});

test('the README does not ask for a registry entry to add a widget', () => {
  assert.doesNotMatch(section, /registry/i);
});
