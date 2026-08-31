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
   literals parse as tags and their template ids as duplicates. Found by index
   rather than by pattern: an end tag may carry whitespace before its bracket. */
const EMBEDDED = ['script', 'style'];

const markupOf = html => {
  const lower = html.toLowerCase();
  let kept = '';
  let at = 0;
  for (;;) {
    let start = -1;
    let resume = html.length;
    for (const tag of EMBEDDED) {
      const open = lower.indexOf(`<${tag}`, at);
      if (open === -1 || (start !== -1 && open > start)) continue;
      const close = lower.indexOf(`</${tag}`, open);
      const bracket = close === -1 ? -1 : lower.indexOf('>', close);
      start = open;
      resume = bracket === -1 ? html.length : bracket + 1;
    }
    if (start === -1) return kept + html.slice(at);
    kept += html.slice(at, start);
    at = resume;
  }
};

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
