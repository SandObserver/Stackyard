/* The HTML parser keeps the first of a repeated attribute and silently drops
   the rest, so the wrong value wins and nothing reports it. A duplicate id
   fails the same way: getElementById returns one element and hides the other. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pages = fs
  .readdirSync(root, { recursive: true, encoding: 'utf8' })
  .filter(p => p.endsWith('.html'))
  .sort();

/* Inline scripts and styles are not markup. Left in place their string
   literals parse as tags and their template ids as duplicates. */
const markupOf = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

const tagsOf = markup => markup.match(/<[a-zA-Z][a-zA-Z0-9-]*(?:"[^"]*"|'[^']*'|[^>"'])*>/g) || [];

const attributeNamesOf = tag => {
  const withoutValues = tag.replace(/"[^"]*"|'[^']*'/g, '""');
  return [...withoutValues.matchAll(/(?:^|\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?=\s*=)/g)].map(m => m[1].toLowerCase());
};

const repeated = names => [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];

test('every page is checked', () => {
  assert.ok(pages.includes('index.html'), 'the dashboard page was not found');
  assert.ok(pages.includes('admin/index.html'), 'the settings page was not found');
});

for (const page of pages) {
  const markup = markupOf(fs.readFileSync(path.join(root, page), 'utf8'));

  test(`${page} sets no attribute twice on one element`, () => {
    for (const tag of tagsOf(markup)) {
      const duplicates = repeated(attributeNamesOf(tag));
      assert.deepEqual(duplicates, [], `${duplicates.join(', ')} is repeated in ${tag.slice(0, 80)}`);
    }
  });

  test(`${page} gives every element a unique id`, () => {
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(repeated(ids), [], 'the same id is used more than once');
  });
}
