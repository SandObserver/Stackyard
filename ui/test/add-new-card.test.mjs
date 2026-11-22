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
    const radio = kind => card.querySelector(`.tile-opt[data-ctype="${kind}"] input[type="radio"]`);
    assert.equal(radio('app').checked, true);
    radio('widget').checked = true;
    radio('widget').dispatchEvent({ type: 'change', bubbles: true });
    assert.equal(body.firstElementChild, card, 'switching type rebuilt or dropped the chooser');
    assert.equal(radio('widget').checked, true);
    assert.equal(radio('app').checked, false);
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

test('the type and size choosers are radio groups', () => {
  const form = read('js/admin-widget-form.js');
  assert.match(form, /<fieldset class="tile-grp" aria-labelledby="wsize-hdr">/);
  assert.match(
    form,
    /<input type="radio" name="wsize" value="\$\{s\}"\$\{raw\(s === state\._wsize \? ' checked' : ''\)\}>/,
  );
  assert.doesNotMatch(form, /aria-pressed/);
  const editor = read('js/admin-editor.js');
  assert.match(editor, /document\.createElement\('fieldset'\)/);
  assert.match(editor, /document\.createElement\('legend'\)/);
  assert.match(editor, /<input type="radio" name="ev-ctype" value="\$\{kind\}">/);
  assert.doesNotMatch(editor, /aria-pressed/);
});
