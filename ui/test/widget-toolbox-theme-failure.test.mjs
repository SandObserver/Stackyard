/* A theme change redraws the last reading. A widget whose service is down
   must keep showing that it is down. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };

function node(owner, tag = 'div') {
  const classes = new Set();
  return {
    tag,
    ownerDocument: owner,
    hidden: false,
    className: '',
    style: {},
    children: [],
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: c => classes.has(c),
      clear: () => classes.clear(),
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    get textContent() {
      return this.text ?? this.children.map(c => c.textContent ?? '').join('');
    },
    set textContent(v) {
      this.children = [];
      this.text = v === '' ? undefined : v;
    },
  };
}

const themeObservers = [];
globalThis.MutationObserver = class {
  constructor(fn) {
    themeObservers.push(fn);
  }
  observe() {}
};
const doc = {
  hidden: false,
  documentElement: {},
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
  importNode: n => n,
  defaultView: {
    getComputedStyle: () => ({ position: 'relative' }),
    DOMParser: class {
      parseFromString() {
        return { documentElement: node(doc, 'svg') };
      }
    },
  },
};
doc.createElement = tag => node(doc, tag);
doc.head = node(doc, 'head');
doc.body = node(doc, 'body');
globalThis.document = doc;

const { poll } = await import('../js/widget-toolbox.js');

const tick = ms => new Promise(r => setTimeout(r, ms));

async function until(check, what) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await tick(5);
  }
}
const changeTheme = () => themeObservers.forEach(fn => fn());

function failingAfterFirst() {
  let call = 0;
  return async () => {
    call++;
    if (call > 1) throw Object.assign(new Error('down'), { kind: 'network' });
    return { call, updatedAt: Date.now() - 300000 };
  };
}

test('a theme change keeps the shared failure caption on a stale widget', async t => {
  const root = node(doc);
  const content = node(doc);
  root.appendChild(content);
  const p = poll({
    interval: 5,
    staleAfter: 2,
    root,
    content: () => content,
    fetch: failingAfterFirst(),
    render: () => content.classList.clear(),
  });
  t.after(() => p.stop());
  const capOf = () => root.children.find(c => c.classList.contains('wt-cap'));
  await until(() => capOf()?.hidden === false && content.classList.contains('wt-inert'), 'the failure caption');
  const cap = capOf();
  assert.ok(cap, 'no caption was drawn');
  assert.equal(cap.hidden, false, 'the failure is not shown before the theme change');
  assert.ok(content.classList.contains('wt-inert'));
  const line = cap.textContent;
  assert.match(line, /·/, 'the caption does not say how old the reading is');

  changeTheme();
  p.stop();
  assert.equal(cap.hidden, false, 'the theme redraw hid the failure');
  assert.equal(cap.textContent, line, 'the caption changed its wording or lost its age');
  assert.ok(content.classList.contains('wt-inert'), 'the stale reading shows as current');
});

test('a theme change hands a widget its own failure again', async t => {
  const errors = [];
  let shown = 'none';
  const p = poll({
    interval: 5,
    staleAfter: 2,
    fetch: failingAfterFirst(),
    render: () => {
      shown = 'reading';
    },
    onError: info => {
      errors.push(info);
      if (info.stale) shown = 'failure';
    },
  });
  t.after(() => p.stop());
  await until(() => errors.at(-1)?.stale === true, 'a stale failure');
  const last = errors.at(-1);
  assert.equal(last.stale, true, 'the poll never went stale');
  assert.equal(shown, 'failure');
  changeTheme();
  p.stop();
  assert.equal(shown, 'failure', 'the theme redraw left the reading as current');
  assert.equal(errors.at(-1), last, 'the widget was not given the same failure again');
});

test('a theme change on a healthy widget only redraws', async t => {
  const errors = [];
  let paints = 0;
  const p = poll({
    interval: 1000,
    fetch: async () => ({ ok: true }),
    render: () => paints++,
    onError: info => errors.push(info),
  });
  t.after(() => p.stop());
  await until(() => paints === 1, 'the first paint');
  changeTheme();
  p.stop();
  assert.equal(paints, 2);
  assert.equal(errors.length, 0);
});
