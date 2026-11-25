const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const section = readme.slice(readme.indexOf('## Widgets'), readme.indexOf('## Getting started'));
const key = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const widgetsDir = path.join(root, 'ui', 'widgets');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(widgetsDir, ...parts), 'utf8'));
const englishLabel = name => {
  const { label } = readJson(name, 'widget.json');
  return readJson(name, 'i18n', 'en.json')[label] ?? label;
};

test('the README lists every shipped widget', () => {
  const listed = new Set([...section.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(m => key(m[1])));
  const shipped = fs
    .readdirSync(widgetsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  assert.deepEqual(
    shipped.filter(name => !listed.has(key(name)) && !listed.has(key(englishLabel(name)))),
    [],
  );
});

test('the README does not ask for a registry entry to add a widget', () => {
  assert.doesNotMatch(section, /registry/i);
});
