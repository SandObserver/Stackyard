import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Raw `el.innerHTML = ` string-building is safe only while every interpolation
   remembers esc(). html`` from utils.js removes that requirement, but the
   existing files predate it and are migrated one at a time.

   This is a ratchet, not a ban. Each file's remaining assignments are capped at
   the count below. The counts may only ever go down: migrate a file, lower its
   number, and once it hits zero delete the entry so the file can never regress.
   A file not listed here must have none at all, which is what stops the pattern
   coming back in new code.

   Reads (`if (el.innerHTML)`) are not matched and are not the concern; only
   assignments write markup. */
const BUDGET = {
  'admin-widget-form.js': 31,
  'widget-config-form.js': 12,
  'admin.js': 11,
  'dashboard.js': 7,
  'admin-app-form.js': 6,
  'ui.js': 4,
  'spotlight.js': 3,
  'i18n.js': 1,
  'admin-color-control.js': 1,
};

const jsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js');
const ASSIGN = /\.innerHTML\s*=(?!=)/g;

const counts = Object.fromEntries(
  fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).map(f => {
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    return [f, (src.match(ASSIGN) || []).length];
  }).filter(([, n]) => n > 0),
);

test('no unlisted file assigns innerHTML directly', () => {
  const unlisted = Object.keys(counts).filter(f => !(f in BUDGET));
  assert.deepEqual(unlisted, [],
    `Use html\`\` from utils.js instead of assigning innerHTML: ${unlisted.join(', ')}`);
});

test('no file exceeds its innerHTML budget', () => {
  const over = Object.entries(counts)
    .filter(([f, n]) => f in BUDGET && n > BUDGET[f])
    .map(([f, n]) => `${f}: ${n} > ${BUDGET[f]}`);
  assert.deepEqual(over, [], `innerHTML budget exceeded. Use html\`\` instead:\n${over.join('\n')}`);
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
