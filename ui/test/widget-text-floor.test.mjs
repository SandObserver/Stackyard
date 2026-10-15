import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/* Apple's widget guidance sets 11pt as the smallest readable text, measured at
   the design size each widget page is written for. */
const FLOOR = 11;
const root = new URL('../widgets/', import.meta.url);

const pages = fs
  .readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .flatMap(d =>
    fs
      .readdirSync(new URL(d.name + '/', root))
      .filter(f => f.endsWith('.html'))
      .map(f => path.join(d.name, f)),
  );

test('no bundled widget page sets text below 11px', () => {
  const small = [];
  for (const page of pages) {
    const src = fs.readFileSync(new URL(page, root), 'utf8');
    const re = /font-size:\s*([0-9.]+)px|fontSize\s*=\s*['"`]([0-9.]+)px|TEXT_H\s*=\s*([0-9.]+)/g;
    for (const m of src.matchAll(re)) {
      const size = Number(m[1] ?? m[2] ?? m[3]);
      if (size < FLOOR) small.push(`${page}: ${m[0]}`);
    }
  }
  assert.ok(pages.length > 10, 'widget pages were found');
  assert.deepEqual(small, []);
});
