import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Every field in admin-state.js must be read or written somewhere else.

   P10-6: `_wgithubCfg` and `_wclockCfg` were declared here and reset in
   closeModal, and that reset was their only reference. They were per-widget
   config holders from before the manifest-driven auto-form, and `_wAutoCfg`
   took over for every widget type without them being removed. They then sat
   there long enough to look like a pattern worth copying.

   Same shape as innerhtml-ratchet.test.mjs, and like that one the budget is
   empty because the cleanup is complete: any field added here and never used
   fails immediately, rather than outliving the migration that orphaned it.

   Fields legitimately unreferenced outside this file, if any ever exist, go in
   ALLOWED with a reason. Nothing qualifies today. */
const ALLOWED = {};

const jsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js');
const STATE_FILE = 'admin-state.js';

const stateSrc = fs.readFileSync(path.join(jsDir, STATE_FILE), 'utf8');

/* Top-level keys of the exported object literal, taken at one level of
   indentation so nested object values cannot be mistaken for fields. */
function stateFields(src) {
  const body = src.slice(src.indexOf('export const state = {'));
  return [...body.matchAll(/^ {2}(_?[A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map(m => m[1]);
}

const fields = stateFields(stateSrc);

const others = fs.readdirSync(jsDir)
  .filter(f => f.endsWith('.js') && f !== STATE_FILE)
  .map(f => fs.readFileSync(path.join(jsDir, f), 'utf8'))
  .join('\n');

/* The admin modules reach state only as `state.foo` / `st.foo`, never
   `state[key]`. If a dynamic read is ever introduced this test would not see
   it, so it also asserts that below. */
const used = f => new RegExp(`\\.${f}\\b`).test(others);

test('the state object declares the fields this test expects to find', () => {
  assert.ok(fields.length > 10, `parsed only ${fields.length} fields, the matcher is probably wrong`);
  assert.ok(fields.includes('items'), 'items must be among them');
  assert.ok(fields.includes('eid'));
});

test('no field is declared and never used', () => {
  const dead = fields.filter(f => !used(f) && !(f in ALLOWED));
  assert.deepEqual(dead, [],
    `Declared in ${STATE_FILE} but referenced nowhere else. Remove them, or add to ALLOWED with a reason: ${dead.join(', ')}`);
});

/* The guard above is a grep, so it is only sound while access stays static.
   A `state[someKey]` read would make an unused-looking field genuinely used and
   this test would wrongly demand its removal. */
test('state is not accessed dynamically, which would defeat the check above', () => {
  const dynamic = [...others.matchAll(/\bst(?:ate)?\[[^\]]+\]/g)].map(m => m[0]);
  assert.deepEqual(dynamic, [],
    `Dynamic state access found, so the dead-field check is no longer reliable: ${dynamic.join(', ')}`);
});

/* The two fields the finding named, so a revert is caught by name and not only
   by the general rule. */
test('the fields P10-6 removed have not come back', () => {
  for (const gone of ['_wgithubCfg', '_wclockCfg']) {
    assert.ok(!fields.includes(gone), `${gone} was removed as dead; _wAutoCfg holds widget config`);
  }
});
