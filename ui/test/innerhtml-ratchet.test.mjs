import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Raw `el.innerHTML = ` and `el.insertAdjacentHTML(...)` string-building is
   safe only while every interpolation remembers esc(). setHtml() + html`` from
   utils.js remove that requirement. The migration is complete, so the budget is
   empty: any file that writes markup outside setHtml fails here.

   Two things are deliberately not counted:

   Reads (`if (el.innerHTML)`) do not write markup.

   Clears (`el.innerHTML = ''`) interpolate nothing, so there is no value to
   escape and no way for them to be unsafe. */
const BUDGET = {};

/* setHtml's own write. It is the single sanctioned innerHTML in the codebase and
   the reason every other file can be held to zero. */
const IMPLEMENTATION = 'html.js';

const jsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js');
/* Matches `= ` and `+= `. The compound form appends markup and is exactly as
   unsafe, but was invisible here until admin.js turned out to use it seven
   times. Only the plain form can be a clear: `+= ''` writes nothing anyway. */
const ASSIGN = /\.innerHTML\s*(\+?)=(?!=)\s*/g;
/* insertAdjacentHTML writes markup exactly like an innerHTML assignment and was
   invisible to the earlier ASSIGN-only regex; 15 call sites hid behind it. */
const INSERT = /\.insertAdjacentHTML\s*\(/g;
const CLEAR = /^(?:''|""|``)\s*[;,)]/;

function countWrites(src) {
  let n = 0;
  for (const m of src.matchAll(ASSIGN)) {
    const isPlain = m[1] === '';
    if (!(isPlain && CLEAR.test(src.slice(m.index + m[0].length)))) n++;
  }
  n += (src.match(INSERT) || []).length;
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
