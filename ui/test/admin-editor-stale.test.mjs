/* An editor that stays open while the list changes under it must act on its
   own item, and a write that lands late must not close a newer editor. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { beforeEach, test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { state } = await import('../js/admin-state.js');
const { initEditor, openEditor } = await import('../js/admin-editor.js');

/** The page's save, held open until the test lets it land. */
const writes = [];
initEditor({
  saveOrRevert: before =>
    new Promise(resolve => {
      writes.push({ before, land: resolve });
    }),
});

const el = id => dom.document.getElementById(id);
const editorOpen = () => !el('dash-edit-view').classList.contains('d-none');
const app = (id, label = id.toUpperCase()) => ({ id, type: 'app', label, href: `http://${id}.local` });

beforeEach(() => {
  writes.length = 0;
  state.items = [];
  for (const d of dom.document.querySelectorAll('dialog.dlg-box')) d.remove();
});

/* Answers the delete confirmation the way a click on its button does. */
async function confirmDelete() {
  await settle();
  const dlg = dom.document.querySelector('dialog.dlg-box');
  assert.ok(dlg, 'no confirmation was asked for');
  const go = dlg.querySelectorAll('button').find(b => b.textContent === 'Delete');
  go.click();
  dlg.dispatchEvent({ type: 'animationend' });
  await settle();
}

test('Delete removes the item by its id, never by the row it was opened from', async () => {
  state.items = [app('a'), app('b'), app('c')];
  openEditor('b');
  state.items.unshift(app('new'));
  el('ev-delete').click();
  await confirmDelete();
  assert.deepEqual(
    state.items.map(i => i.id),
    ['new', 'a', 'c'],
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].before.map(i => i.id),
    ['new', 'a', 'b', 'c'],
    'the undo copy is the list before the delete',
  );
});

test('Delete of an item removed elsewhere writes nothing and says so', async () => {
  state.items = [app('a'), app('b')];
  openEditor('b');
  state.items.splice(1, 1);
  el('ev-delete').click();
  await confirmDelete();
  assert.equal(writes.length, 0);
  assert.equal(editorOpen(), false, 'the editor closes on a stale item');
  assert.equal(el('toast-msg').textContent, t('toast.dashboardChangedElsewhere'));
});

test('a save that lands after the editor changed leaves the new editor open', async () => {
  state.items = [{ id: 'settings', type: 'app', system: 'settings', label: 'Settings' }, app('a')];
  openEditor('settings');
  el('ev-save').click();
  await settle();
  assert.equal(writes.length, 1);
  openEditor('a');
  writes[0].land(true);
  await settle();
  assert.equal(editorOpen(), true);
  assert.equal(state.eid, 'a');
});

test('a save that lands with the same editor open closes it', async () => {
  state.items = [{ id: 'settings', type: 'app', system: 'settings', label: 'Settings' }];
  openEditor('settings');
  el('ev-save').click();
  await settle();
  writes[0].land(true);
  await settle();
  assert.equal(editorOpen(), false);
  assert.equal(state.eid, null);
});

test('a delete that lands after the editor changed leaves the new editor open', async () => {
  state.items = [app('a'), app('b')];
  openEditor('a');
  el('ev-delete').click();
  await confirmDelete();
  openEditor('b');
  writes[0].land(true);
  await settle();
  assert.equal(editorOpen(), true);
  assert.equal(state.eid, 'b');
});

test('a delete that lands with the same editor open returns to the list', async () => {
  state.items = [app('a'), app('b')];
  openEditor('a');
  el('ev-delete').click();
  await confirmDelete();
  writes[0].land(true);
  await settle();
  assert.equal(editorOpen(), false);
});

test('opening an editor starts a new session', () => {
  state.items = [app('a')];
  const was = state._evSession;
  openEditor('a');
  assert.equal(state._evSession, was + 1);
  openEditor(null);
  assert.equal(state._evSession, was + 2);
});

test('a folder save takes the undo copy before it changes any other folder', async () => {
  state.items = [
    app('x'),
    { id: 'f1', type: 'folder', label: 'One', children: ['x'] },
    { id: 'f2', type: 'folder', label: 'Two', children: [] },
  ];
  openEditor('f2');
  el('f-fname').value = 'Two';
  state._folderApps = { getValue: () => ['x'] };
  el('ev-save').click();
  await settle();
  assert.equal(writes.length, 1);
  const before = Object.fromEntries(writes[0].before.map(i => [i.id, i.children]));
  assert.deepEqual(before.f1, ['x'], 'the undo copy already lost the claimed app');
  assert.deepEqual(before.f2, []);
  const now = Object.fromEntries(state.items.map(i => [i.id, i.children]));
  assert.deepEqual(now.f1, []);
  assert.deepEqual(now.f2, ['x']);
});
