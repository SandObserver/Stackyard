/* The dashboard zooms each widget page to its card. A viewport unit then
   resolves against the zoomed frame and is zoomed again. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'widgets');

test('no widget page sizes anything in viewport units', () => {
  const found = [];
  for (const w of fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())) {
    for (const f of fs.readdirSync(path.join(dir, w.name)).filter(n => n.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(dir, w.name, f), 'utf8');
      for (const m of src.matchAll(/\b\d*\.?\d+(?:[sld]?v(?:h|w|min|max|i|b))\b/g))
        found.push(`${w.name}/${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});
