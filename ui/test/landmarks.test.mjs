/* Landmarks are how a screen reader skips the furniture.

   The settings page had two navigation landmarks and nothing else, so its whole
   content sat outside any landmark and there was no way to jump past the
   sidebar to it. The dashboard had the same gap around its pager. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const admin = read('admin/index.html');
const dashboard = read('index.html');

test('the settings content is a main landmark', () => {
  assert.match(admin, /<main class="cp">/, 'the content pane is the page, and it has to be reachable as one');
  assert.equal((admin.match(/<main[\s>]/g) || []).length, 1, 'a second main landmark makes neither one the content');
});

test('the settings sidebar is still a named navigation landmark', () => {
  assert.match(admin, /<nav class="sb" aria-label="[^"]+">/);
});

test('the dashboard names its own regions', () => {
  for (const [tag, id] of [
    ['main', 'pages'],
    ['nav', 'dots'],
  ]) {
    const el = new RegExp(`<${tag} id="${id}"([^>]*)>`).exec(dashboard);
    assert.ok(el, `#${id} is missing, or is no longer a landmark`);
    assert.match(el[1], /aria-label="[^"]+"/, `#${id} is a landmark with no name`);
    assert.match(el[1], /data-i18n-al="[^"]+"/, `#${id} has a name the catalog never translates`);
  }
});
