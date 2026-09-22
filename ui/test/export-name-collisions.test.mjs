/* One exported name, one meaning. Two modules defining the same name is legal
   JavaScript, so nothing else reports it: not lint, not the typechecks, not the
   suites. An importer picks whichever module it happens to name, and a reader
   comparing two call sites has no way to tell they are different functions.

   This found nothing when it was written. It exists because renaming
   badge-logic.js's `safeColor` to `paletteColor` collided with palette.js's own
   `paletteColor`, recreating the defect the rename was removing, with every
   gate green.

   Re-exports are not definitions. A facade that forwards another module's
   binding is one function with one name, which is the point of a facade. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

/* Two definitions of one name, kept on purpose. Each needs a reason: this list
   is where a deliberate one is accounted for rather than silently allowed. */
const SAME_ON_PURPOSE = {
  /* widget-toolbox wraps widget-error's, binding it to the widget catalog's
     translator. Widgets see one `errorState` and never import the other. */
  errorState: ['widget-error.js', 'widget-toolbox.js'],
};

const DEFINITION = /^export\s+(?:async\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/gm;

function definitionsIn(file) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  return new Set([...src.matchAll(DEFINITION)].map(m => m[1]));
}

test('no two modules define the same exported name', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  for (const file of files) {
    for (const name of definitionsIn(file)) {
      owners.set(name, [...(owners.get(name) || []), file]);
    }
  }

  const clashes = [...owners]
    .filter(([name, where]) => where.length > 1)
    .filter(([name, where]) => {
      const allowed = SAME_ON_PURPOSE[name];
      return !allowed || allowed.join() !== [...where].sort().join();
    })
    .map(([name, where]) => `${name}: ${where.sort().join(', ')}`);

  assert.deepEqual(
    clashes,
    [],
    `rename one after what distinguishes it, or add it to SAME_ON_PURPOSE with a reason:\n  ${clashes.join('\n  ')}`,
  );
});

/* An entry left behind after a rename silently permits the next collision. */
test('every deliberate duplicate still exists', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  for (const [name, where] of Object.entries(SAME_ON_PURPOSE)) {
    const found = files.filter(f => definitionsIn(f).has(name)).sort();
    assert.deepEqual(found, [...where].sort(), `SAME_ON_PURPOSE lists ${name} in files that no longer define it`);
  }
});
