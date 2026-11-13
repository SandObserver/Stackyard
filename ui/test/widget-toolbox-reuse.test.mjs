import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const widgets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets');
const pages = fs
  .readdirSync(widgets, { recursive: true })
  .filter(f => /\.(html|js)$/.test(f))
  .map(f => [f, fs.readFileSync(path.join(widgets, f), 'utf8')]);

test('widget pages read their config through getConfig', () => {
  assert.ok(pages.length > 20);
  for (const [name, src] of pages)
    assert.doesNotMatch(src, /[`'"][^`'"\n]*\/widget-config\//, `${name} fetches its config by hand`);
});

test('widget pages ask the toolbox for the reduced-motion setting', () => {
  for (const [name, src] of pages) assert.doesNotMatch(src, /matchMedia\(/, `${name} reads matchMedia itself`);
});

test('widget pages ask the toolbox for the theme', () => {
  for (const [name, src] of pages)
    assert.doesNotMatch(src, /getAttribute\(\s*['"]data-theme['"]\s*\)/, `${name} reads the theme attribute itself`);
});
