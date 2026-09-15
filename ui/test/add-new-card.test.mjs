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

test('the size chooser tells assistive technology which size is chosen', () => {
  assert.match(
    read('js/admin-widget-form.js'),
    /class="tile-opt[^"]*"[^>]*aria-pressed="\$\{String\(s === state\._wsize\)\}"/,
  );
});

test('glass surfaces keep an edge in forced colors', () => {
  const css = read('css/dashboard.css');
  const block = css.slice(css.indexOf('@media (forced-colors: active)'));
  for (const sel of ['#dock.mdock', '.folder-box-desktop', '.dyn-box-mob', '.folder-icon-grid', '.dyn-fold-wrap']) {
    assert.ok(block.includes(sel), `${sel} has no forced-colors border`);
  }
});
