import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* The widget form redraws itself on a size, type or field change. A redraw that
   clears the whole editor takes the type chooser with it. */
test('a widget form redraw keeps the add-new type chooser', () => {
  assert.match(read('js/admin.js'), /grp\.className = 'grp add-new-card'/);
  const form = read('js/admin-widget-form.js');
  assert.match(form, /querySelector\(':scope > \.add-new-card'\)/);
  assert.doesNotMatch(form, /body\.replaceChildren\(\);/, 'a bare clear drops the chooser');
});
