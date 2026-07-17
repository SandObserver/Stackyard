import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Raw `el.innerHTML = ` string-building is safe only while every interpolation
   remembers esc(). setHtml() + html`` from utils.js remove that requirement, but
   the existing files predate them and are migrated one at a time.

   This is a ratchet, not a ban. Each file's remaining writes are capped at the
   count below. The counts may only ever go down: migrate a file, lower its
   number, and once it hits zero delete the entry so the file can never regress.
   A file not listed here must have none at all, which is what stops the pattern
   coming back in new code.

   Two things are deliberately not counted:

   Reads (`if (el.innerHTML)`) do not write markup.

   Clears (`el.innerHTML = ''`) interpolate nothing, so there is no value to
   escape and no way for them to be unsafe. Counting them would inflate the
   budgets and push pointless churn through rendering code. 28 of the 76 raw
   assignments in this codebase are clears; only the other 48 are real. */
const BUDGET = {
  'admin-widget-form.js': 21,
  'admin.js': 16,
  'admin-app-form.js': 2,
};

/* setHtml's own write. It is the single sanctioned innerHTML in the codebase and
   the reason every other file can be held to zero. */
const IMPLEMENTATION = 'html.js';

const jsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js');
/* Matches `= ` and `+= `. The compound form appends markup and is exactly as
   unsafe, but was invisible here until admin.js turned out to use it seven
   times. Only the plain form can be a clear: `+= ''` writes nothing anyway. */
const ASSIGN = /\.innerHTML\s*(\+?)=(?!=)\s*/g;
const CLEAR = /^(?:''|""|``)\s*[;,)]/;

function countWrites(src) {
  let n = 0;
  for (const m of src.matchAll(ASSIGN)) {
    const isPlain = m[1] === '';
    if (!(isPlain && CLEAR.test(src.slice(m.index + m[0].length)))) n++;
  }
  return n;
}

const counts = Object.fromEntries(
  fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && f !== IMPLEMENTATION)
    .map(f => [f, countWrites(fs.readFileSync(path.join(jsDir, f), 'utf8'))])
    .filter(([, n]) => n > 0),
);

test('no unlisted file writes markup through innerHTML', () => {
  const unlisted = Object.keys(counts).filter(f => !(f in BUDGET));
  assert.deepEqual(unlisted, [],
    `Use setHtml(el, html\`...\`) from utils.js instead: ${unlisted.join(', ')}`);
});

test('no file exceeds its innerHTML budget', () => {
  const over = Object.entries(counts)
    .filter(([f, n]) => f in BUDGET && n > BUDGET[f])
    .map(([f, n]) => `${f}: ${n} > ${BUDGET[f]}`);
  assert.deepEqual(over, [], `innerHTML budget exceeded. Use setHtml(el, html\`...\`):\n${over.join('\n')}`);
});

test('the budget has no stale entries', () => {
  /* Keeps the ratchet honest: a budget left above the real count would silently
     hand back room to regress. Lower the number when you migrate. */
  const stale = Object.entries(BUDGET)
    .filter(([f, n]) => (counts[f] || 0) < n)
    .map(([f, n]) => `${f}: budget ${n}, actual ${counts[f] || 0}`);
  assert.deepEqual(stale, [], `Lower these budgets to match reality:\n${stale.join('\n')}`);
});

test('a fully migrated file is removed from the budget', () => {
  const zeroed = Object.keys(BUDGET).filter(f => !(f in counts));
  assert.deepEqual(zeroed, [],
    `Delete these from BUDGET so they can never regress: ${zeroed.join(', ')}`);
});
