/* The list writes the whole item list back to the server. Each write reads the
   server's list first and refuses to overwrite a change made somewhere else,
   and every write runs on the one queue the Settings writes use. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { beforeEach, test } from 'node:test';
import { catalogRoutes, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

/* A server that keeps the config and answers each request a turn late, so
   writes started together overlap. */
const server = { config: { _rev: 1, items: [], settings: {} }, log: [], failNextPost: 0 };
const catalog = catalogRoutes();
async function fetch(url, opts = {}) {
  await settle(2);
  const method = opts.method || 'GET';
  const reply = (status, payload) => ({ ok: status < 400, status, json: async () => structuredClone(payload) });
  if (url in catalog) return reply(200, catalog[url]);
  if (url !== '/api/config') return reply(404, {});
  if (method !== 'POST') {
    server.log.push('read');
    return reply(200, server.config);
  }
  const body = JSON.parse(opts.body);
  server.log.push({ post: body.items.map(i => i.id) });
  if (server.failNextPost) {
    server.failNextPost--;
    return reply(server.status ?? 500, { error: 'refused', kind: 'internal' });
  }
  server.config = { ...body, _rev: server.config._rev + 1 };
  return reply(200, { ok: true, items: body.items });
}

const dom = installDom({ markup: pageBody('admin/index.html'), fetch });
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { state } = await import('../js/admin-state.js');
const { configWrites } = await import('../js/admin-save-logic.js');
const { setReauthHandler } = await import('../js/admin-shared.js');
const { createListWrites } = await import('../js/admin-list-writes.js');

const saveButton = dom.document.getElementById('dash-save');
const toastText = () => dom.document.getElementById('toast-msg').textContent;
const app = id => ({ id, type: 'app', label: id, href: `http://${id}.local` });
let renders = 0;

/** A page that loaded `items` from the server and drew them. */
function loadedPage(items) {
  server.config = { _rev: 1, items: structuredClone(items), settings: { language: 'en' } };
  server.log = [];
  server.failNextPost = 0;
  delete server.status;
  state.items = structuredClone(items);
  const writes = createListWrites({ render: () => renders++, saveButton });
  writes.loaded(structuredClone(items));
  writes.drawn();
  writes.syncDashSave();
  return writes;
}

beforeEach(() => {
  renders = 0;
  setReauthHandler(null);
  dom.document.getElementById('toast-msg').textContent = '';
});

test('a save sends the list, and records it as saved', async () => {
  const writes = loadedPage([app('a')]);
  state.items.push(app('b'));
  writes.syncDashSave();
  assert.equal(saveButton.disabled, false, 'an unsaved change leaves Save off');
  assert.equal(writes.unsaved(), true);
  assert.equal(await writes.save(), true);
  assert.deepEqual(
    server.config.items.map(i => i.id),
    ['a', 'b'],
  );
  assert.equal(writes.unsaved(), false);
  assert.equal(saveButton.disabled, true);
  assert.ok(renders > 0, 'the list is not redrawn after the write');
});

test('a save refuses to overwrite a list changed somewhere else', async () => {
  const writes = loadedPage([app('a')]);
  server.config.items.push(app('other-tab'));
  state.items.push(app('b'));
  assert.equal(await writes.save(), false);
  assert.deepEqual(server.log, ['read'], 'the stale list was written');
  assert.equal(toastText(), t('toast.dashboardChangedElsewhere'));
  assert.equal(writes.unsaved(), true);
});

test('a save refreshes the shared settings from what it wrote', async () => {
  const writes = loadedPage([app('a')]);
  server.config.settings = { language: 'en', keepAwake: true };
  state._settings = {};
  await writes.save();
  assert.deepEqual(state._settings, { language: 'en', keepAwake: true });
});

test('a retry after sign-in sends the list recorded as sent, not the live one', async () => {
  const writes = loadedPage([app('a')]);
  state.items.push(app('b'));
  server.failNextPost = 1;
  server.status = 401;
  setReauthHandler(() => {
    state.items.push(app('typed-during-sign-in'));
    return true;
  });
  assert.equal(await writes.save(), true);
  const posts = server.log.filter(e => e.post);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1].post, ['a', 'b']);
});

test('list saves run through the one shared queue', async () => {
  const writes = loadedPage([app('a')]);
  let settingsRan = false;
  state.items.push(app('b'));
  const listSave = writes.save();
  const settingsWrite = configWrites.run(async () => {
    settingsRan = true;
    assert.deepEqual(
      server.config.items.map(i => i.id),
      ['a', 'b'],
      'the next write ran before the save landed',
    );
  });
  await Promise.all([listSave, settingsWrite]);
  assert.equal(settingsRan, true);
});

test('a failed save puts the list back as it was before the change', async () => {
  const writes = loadedPage([app('a'), app('b')]);
  const before = structuredClone(state.items);
  state.items.reverse();
  server.failNextPost = 1;
  assert.equal(await writes.saveOrRevert(before), false);
  assert.deepEqual(
    state.items.map(i => i.id),
    ['a', 'b'],
  );
  assert.match(toastText(), new RegExp(t('toast.saveFailed', { err: '' }).trim().slice(0, 10)));
});

test('a change saved while a failed save is queued is reverted only once both settle', async () => {
  const writes = loadedPage([app('a'), app('b'), app('c')]);
  const first = structuredClone(state.items);
  state.items.reverse();
  server.failNextPost = 1;
  const failing = writes.saveOrRevert(first);
  const second = structuredClone(state.items);
  state.items.push(app('d'));
  const landing = writes.saveOrRevert(second);
  assert.deepEqual(await Promise.all([failing, landing]), [false, true]);
  assert.deepEqual(
    server.config.items.map(i => i.id),
    ['c', 'b', 'a', 'd'],
  );
  assert.deepEqual(
    state.items.map(i => i.id),
    ['c', 'b', 'a', 'd'],
  );
});

test('an import appends to the server list and records what it saved', async () => {
  const writes = loadedPage([app('a')]);
  await writes.appendAndSave([app('imported')]);
  assert.deepEqual(
    server.config.items.map(i => i.id),
    ['a', 'imported'],
  );
  assert.deepEqual(
    state.items.map(i => i.id),
    ['a', 'imported'],
  );
  assert.equal(writes.unsaved(), false, 'the page would warn about changes already on the server');
  assert.equal(saveButton.disabled, true);
});

test('an import keeps what another tab added, and refuses an id that is now taken', async () => {
  const writes = loadedPage([app('a')]);
  server.config.items.push(app('other-tab'));
  await writes.appendAndSave([app('imported')]);
  assert.deepEqual(
    server.config.items.map(i => i.id),
    ['a', 'other-tab', 'imported'],
  );
  await assert.rejects(writes.appendAndSave([app('other-tab')]), {
    message: t('toast.importIdTaken', { name: '⁨other-tab⁩' }),
  });
});

test('a save asked for before an import replaced a stale list is refused', async () => {
  const writes = loadedPage([app('a')]);
  server.config.items.push(app('other-tab'));
  const imported = writes.appendAndSave([app('imported')]);
  state.items.push(app('local'));
  const queued = writes.save();
  await imported;
  assert.equal(await queued, false);
  assert.equal(server.log.filter(e => e.post).length, 1, 'the queued save wrote over the replaced list');
  assert.equal(toastText(), t('toast.dashboardChangedElsewhere'));
});

test('a backup restore replaces the list and the settings, and the next save starts from it', async () => {
  const writes = loadedPage([app('a')]);
  const backup = { items: [app('x'), app('y')], settings: { language: 'en', keepAwake: true } };
  assert.equal(await writes.restoreBackup(backup), true);
  assert.deepEqual(
    server.config.items.map(i => i.id),
    ['x', 'y'],
  );
  assert.deepEqual(
    state.items.map(i => i.id),
    ['x', 'y'],
  );
  assert.equal(state._settings.keepAwake, true);
  assert.equal(writes.unsaved(), false);
  state.items.push(app('z'));
  assert.equal(await writes.save(), true, 'the restored list is treated as stale');
});

test('a backup restore refuses to overwrite a list changed somewhere else', async () => {
  const writes = loadedPage([app('a')]);
  server.config.items.push(app('other-tab'));
  assert.equal(await writes.restoreBackup({ items: [app('x')], settings: {} }), false);
  assert.deepEqual(server.log, ['read']);
  assert.equal(toastText(), t('toast.dashboardChangedElsewhere'));
});
