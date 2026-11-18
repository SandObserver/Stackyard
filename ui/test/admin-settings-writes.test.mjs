/* Settings writers share one queue with the list. Each write reads the config
   in its own turn, so the page never refuses its own saves as stale. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);

function mkEl(props = {}) {
  const attrs = {};
  const classes = new Set();
  const listeners = {};
  return {
    value: '',
    checked: false,
    disabled: false,
    type: '',
    textContent: '',
    isConnected: false,
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
      contains: c => classes.has(c),
    },
    getAttribute: k => attrs[k] ?? null,
    setAttribute: (k, v) => {
      attrs[k] = String(v);
    },
    removeAttribute: k => {
      delete attrs[k];
    },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    fire(type) {
      return listeners[type]({ target: this });
    },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {},
    ...props,
  };
}

const nodes = {
  'bg-save': mkEl(),
  'srv-save': mkEl(),
  'set-awake': mkEl({ type: 'checkbox' }),
  'set-type-search': mkEl({ type: 'checkbox' }),
  'bg-type': mkEl(),
  'bg-col-inp': mkEl(),
};
globalThis.document = {
  getElementById: id => nodes[id] ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => mkEl(),
  documentElement: mkEl(),
};
globalThis.location = /** @type {any} */ ({ host: 'localhost', hostname: 'localhost' });
globalThis.window = /** @type {any} */ ({ setTimeout, clearTimeout });

/* The server's stale-write check, and nothing else. Reads answer a turn late,
   so two writes started together both read before either posts. */
const server = {
  config: { _rev: 1, items: [], settings: { keepAwake: false, background: { type: 'color', color: '#000000' } } },
  posts: [],
};
globalThis.fetch = async (url, opts = {}) => {
  await new Promise(done => setTimeout(done, 5));
  const reply = (status, payload) => ({ ok: status < 400, status, json: async () => structuredClone(payload) });
  if (opts.method !== 'POST') {
    if (url === '/api/config') return reply(200, server.config);
    return reply(200, { configured: false, enabled: false });
  }
  const body = JSON.parse(opts.body);
  if (url !== '/api/config') {
    server.posts.push({ url, status: 200 });
    return reply(200, { ok: true });
  }
  if (body._rev != null && body._rev !== server.config._rev) {
    server.posts.push({ url, status: 409 });
    return reply(409, { error: 'changed somewhere else', kind: 'invalid' });
  }
  server.config = { ...body, _rev: server.config._rev + 1 };
  server.posts.push({ url, status: 200 });
  return reply(200, { ok: true, items: body.items });
};

const { configWrites } = await import('../js/admin-save-logic.js');
const { state } = await import('../js/admin-state.js');
const { loadSettings } = await import('../js/admin-settings.js');

let applied = [];
loadSettings(structuredClone(server.config), {
  applyBg: () => applied.push(structuredClone(state._settings.background)),
});
await new Promise(r => setTimeout(r, 20));

const changeWallpaper = collection => {
  nodes['bg-type'].value = 'unsplash';
  nodes['bg-col-inp'].value = collection;
  return nodes['bg-save'].fire('click');
};

test('a wallpaper save and a switch flipped before it returns both land', async () => {
  server.posts = [];
  const awake = nodes['set-awake'];
  awake.checked = true;
  await Promise.all([changeWallpaper('mountains'), awake.fire('change')]);
  assert.deepEqual(
    server.posts.map(p => p.status),
    [200, 200],
  );
  assert.equal(awake.checked, true, 'the switch is not put back');
  assert.equal(server.config.settings.keepAwake, true);
  assert.equal(server.config.settings.background.collection, 'mountains');
});

test('a list write queued between two Settings writes reads the revision the first one left', async () => {
  server.posts = [];
  const ts = nodes['set-type-search'];
  ts.checked = false;
  const listWrite = configWrites.run(async () => {
    const full = await (await fetch('/api/config')).json();
    full.items = [{ id: 'a', type: 'app', label: 'A' }];
    const r = await fetch('/api/config', { method: 'POST', body: JSON.stringify(full) });
    assert.equal(r.status, 200);
  });
  await Promise.all([ts.fire('change'), listWrite, changeWallpaper('forest')]);
  assert.deepEqual(
    server.posts.map(p => p.status),
    [200, 200, 200],
  );
  assert.equal(server.config.items.length, 1);
  assert.equal(server.config.settings.typeToSearch, false);
  assert.equal(server.config.settings.background.collection, 'forest');
});

test('a wallpaper save updates the shared settings before the background is applied again', async () => {
  applied = [];
  await changeWallpaper('ocean');
  assert.equal(state._settings.background.collection, 'ocean');
  assert.deepEqual(applied, [{ type: 'unsplash', brightness: 0.62, collection: 'ocean' }]);
});

test('a switch save keeps the shared settings in step with the server', async () => {
  const awake = nodes['set-awake'];
  awake.checked = false;
  await awake.fire('change');
  assert.equal(state._settings.keepAwake, false);
  assert.deepEqual(state._settings, server.config.settings);
});

test('a switch save leaves the Save mark to a save in flight or a failed save', async () => {
  globalThis.matchMedia ??= /** @type {any} */ (() => ({ matches: true }));
  const awake = nodes['set-awake'];
  const save = mkEl({
    isConnected: true,
    getClientRects: () => [{}],
    querySelector: () => ({ querySelectorAll: () => [] }),
  });
  awake.closest = () => ({ querySelector: () => save });
  try {
    save.setAttribute('aria-busy', 'true');
    awake.checked = true;
    await awake.fire('change');
    assert.equal(save.classList.contains('saved'), false, 'no check while the Save press is running');
    save.removeAttribute('aria-busy');
    save.classList.add('failed');
    awake.checked = false;
    await awake.fire('change');
    assert.equal(save.classList.contains('saved'), false, 'a failed save keeps its cross');
    assert.equal(save.classList.contains('failed'), true);
    save.classList.remove('failed');
    awake.checked = true;
    await awake.fire('change');
    assert.equal(save.classList.contains('saved'), true, 'a free Save button still shows the switch save');
  } finally {
    awake.closest = () => null;
  }
});

const admin = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');

test('every list write in admin.js runs on the shared queue', () => {
  assert.doesNotMatch(admin, /serialWrites\(\)/, 'admin.js keeps its own queue');
  for (const write of ['writeItems(asked, done)', 'appendItems(newItems)', 'writeBackup(file)'])
    assert.ok(admin.includes(`configWrites.run(() => ${write})`), `${write} is not queued`);
});

test('list writes refresh the shared settings and the page hands Settings its applyBg', () => {
  assert.equal(admin.match(/state\._settings = (full|body)\.settings \|\| \{\};/g)?.length, 3);
  assert.match(admin, /loadSettings\(c, \{ applyBg \}\);/);
});
