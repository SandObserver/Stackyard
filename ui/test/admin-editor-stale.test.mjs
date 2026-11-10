/* An editor that stays open while the list changes under it must act on its
   own item, and a write that lands late must not close a newer editor. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const admin = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const fn = name => {
  const at = admin.indexOf(name);
  assert.notEqual(at, -1, `${name} is missing`);
  return admin.slice(at, admin.indexOf('\n}\n', at));
};

test('Delete removes the item by its id, never by the row it was opened from', () => {
  const del = fn('async function _evDelete(');
  assert.match(admin, /delBtn\.onclick = \(\) => _evDelete\(item\);/);
  assert.doesNotMatch(del, /splice\(/);
  assert.match(
    del,
    /if \(!removeItem\(state\.items, item\.id\)\) \{\s*closeModal\(null\);\s*toast\(t\('toast\.dashboardChangedElsewhere'\), 'err'\);\s*return;\s*\}/,
  );
});

test('a save that lands after the editor changed leaves the new editor open', () => {
  const save = fn('async function doSave(');
  assert.match(
    save,
    /const session = state\._evSession;[\s\S]*if \(!\(await saveOrRevert\(before\)\)\) return;\s*if \(session === state\._evSession\) closeModal\(item\.id\);\s*toast\(t\(replaced \? 'toast\.updated' : 'toast\.added'\)\);/,
  );
  assert.doesNotMatch(save, /^\s*closeModal\(item\.id\);/m);
});

test('a delete that lands after the editor changed leaves the new editor open', () => {
  const del = fn('async function _evDelete(');
  assert.match(
    del,
    /const session = state\._evSession;\s*if \(\(await saveOrRevert\(before, t\('toast\.deleted'\)\)\) && session === state\._evSession\) showListView\(\);/,
  );
});

test('opening an editor starts a new session', () => {
  assert.match(fn('function openModal('), /state\._evSession \+= 1;/);
});
