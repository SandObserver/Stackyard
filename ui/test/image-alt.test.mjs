import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

/* An image with no alt is read by its file name. Each one created in script
   sets alt in the creating call or within the next two lines. */
test('every image created in script has an alt', () => {
  const missing = [];
  let seen = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/mk\('img'|createElement\('img'\)/.test(line)) return;
      seen++;
      const near = lines.slice(i, i + 3).join('\n');
      if (!/\balt:|\.alt =/.test(near)) missing.push(`${f}:${i + 1}`);
    });
  }
  assert.ok(seen >= 5, 'the scan found too few images to be reading ui/js');
  assert.deepEqual(missing, []);
});
