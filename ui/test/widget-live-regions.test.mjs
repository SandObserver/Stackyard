/* A widget must not narrate its own polling. live-region.test.mjs states the
   rule for the dashboard: a live region says what the user did, not everything
   that changes. A widget that re-reads its figures on every poll talks over the
   reader, and the figures are there to be read by navigating to the widget
   anyway.

   The regions that remain are listed here by name. A new one has to be
   justified against the same rule rather than added by habit. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'widgets');

/* Every element allowed to interrupt, and what the user did to earn it. */
const ALLOWED = new Map([
  ['books/index.html#sr', 'the book under the pointer or the focus'],
  ['nowplaying/index.html#sr', 'the track the user moved to with previous or next'],
  ['disk-health/index.html#tip', 'the bay under the pointer or the focus'],
]);

function widgetDocs() {
  const out = [];
  for (const w of fs.readdirSync(dir)) {
    const d = path.join(dir, w);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.html'))) {
      out.push([`${w}/${f}`, fs.readFileSync(path.join(d, f), 'utf8')]);
    }
  }
  return out;
}

test('every widget live region is one the user asked for', () => {
  const found = [];
  for (const [name, src] of widgetDocs()) {
    /* role="status" carries an implicit polite live region, so it counts. */
    for (const m of src.matchAll(/<[^>]*(?:aria-live="(?:polite|assertive)"|role="status")[^>]*>/g)) {
      const id = /id="([^"]+)"/.exec(m[0]);
      found.push(`${name}#${id ? id[1] : '(no id)'}`);
    }
  }
  const unexpected = found.filter(f => !ALLOWED.has(f));
  assert.deepEqual(
    unexpected,
    [],
    `These interrupt a screen reader. If the change is something the user did, add it to ALLOWED with the reason:\n  ${unexpected.join('\n  ')}`,
  );
});

test('the regions that are allowed are still there', () => {
  const docs = new Map(widgetDocs());
  for (const [key, why] of ALLOWED) {
    const [file, id] = key.split('#');
    const src = docs.get(file);
    assert.ok(src, `${file} is gone`);
    const el = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(src);
    assert.ok(el, `${key} is gone, and with it the announcement of ${why}`);
    assert.match(el[0], /aria-live="polite"|role="status"/, `${key} no longer announces ${why}`);
  }
});

/* The figures stay in the document so a reader still finds them by navigating
   there. Dropping the element as well as the live region would take them away. */
test('the summaries a reader navigates to are still written', () => {
  const cases = [
    ['system-summary/index.html', 'sr-sum'],
    ['weather/index.html', 'sr'],
    ['dns/index.html', 'sr'],
  ];
  const docs = new Map(widgetDocs());
  for (const [file, id] of cases) {
    const src = docs.get(file);
    assert.match(src, new RegExp(`id="${id}"`), `${file} dropped #${id} instead of its live region`);
    assert.match(
      src,
      new RegExp(`(getElementById\\('${id}'\\)|${id.replace('-', '')}|${id})`),
      `${file} never writes #${id}`,
    );
  }
});
