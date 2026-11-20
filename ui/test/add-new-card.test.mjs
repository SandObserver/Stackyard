import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* The widget form redraws itself on a size, type or field change. A redraw that
   clears the whole editor takes the type chooser with it. */
test('a widget form redraw keeps the add-new type chooser', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody, settle } = await import('./fake-dom.mjs');
  register('./js-root-hooks.mjs', import.meta.url);
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    await (await import('../js/i18n.js')).initI18n('en');
    const { state } = await import('../js/admin-state.js');
    const { openEditor } = await import('../js/admin-editor.js');
    state.items = [];
    openEditor(null);
    const body = dom.document.getElementById('ev-body');
    const card = body.firstElementChild;
    assert.equal(card.classList.contains('add-new-card'), true, 'a new item opens without the type chooser');
    const tile = kind => card.querySelector(`.tile-opt[data-ctype="${kind}"]`);
    assert.equal(tile('app').getAttribute('aria-pressed'), 'true');
    tile('widget').click();
    assert.equal(body.firstElementChild, card, 'switching type rebuilt or dropped the chooser');
    assert.equal(tile('widget').getAttribute('aria-pressed'), 'true');
    assert.equal(tile('app').getAttribute('aria-pressed'), 'false');
    state.items = [{ id: 'a', type: 'app', label: 'A', href: 'http://a.local' }];
    openEditor('a');
    assert.equal(body.querySelector('.add-new-card'), null, 'an existing item offers a type change');
  } finally {
    await settle(100);
    dom.restore();
  }
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
