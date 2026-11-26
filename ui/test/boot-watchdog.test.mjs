import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

register('./js-root-hooks.mjs', import.meta.url);

const src = fs.readFileSync(new URL('../js/boot-hints.js', import.meta.url), 'utf8');
const en = JSON.parse(fs.readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8'));

class FakeScript {
  constructor(type) {
    this.type = type;
  }
}

function el(tag) {
  return {
    tag,
    children: [],
    attrs: {},
    textContent: '',
    listeners: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    append(...c) {
      this.children.push(...c);
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
}

function run({ started = false, lang = '', languages = ['en'], catalog = null } = {}) {
  const listeners = { error: [], load: [] };
  const timers = [];
  const classes = new Set(lang && lang !== 'en' ? ['lang-pending'] : []);
  const body = el('body');
  body.classList = { add: c => classes.add(`body:${c}`) };
  const window = {
    __bootStarted: started,
    addEventListener: (type, fn) => listeners[type]?.push(fn),
  };
  const fetched = [];
  vm.runInNewContext(src, {
    window,
    localStorage: { getItem: () => (lang ? JSON.stringify({ lang }) : null) },
    navigator: { languages },
    document: {
      currentScript: { dataset: {} },
      documentElement: {
        style: { setProperty() {} },
        classList: { add: c => classes.add(c), remove: c => classes.delete(c) },
      },
      createElement: el,
      body,
    },
    location: { reload() {} },
    setTimeout: fn => timers.push(fn),
    fetch: async url => {
      fetched.push(url);
      return { ok: !!catalog, json: async () => catalog };
    },
    HTMLScriptElement: FakeScript,
    Image: class {},
  });
  const screen = () => body.children[0];
  const texts = () => {
    const card = screen().children[0];
    return card.children.map(c => c.textContent);
  };
  return { listeners, timers, classes, screen, texts, fetched };
}

test('a page whose entry module never runs shows the failure notice in English', () => {
  const r = run();
  for (const fn of r.listeners.load) fn();
  for (const fn of r.timers) fn();
  assert.equal(r.screen().attrs.role, 'alert');
  assert.equal(r.screen().className, 'cfg-recovery');
  assert.deepEqual(r.texts(), [en.bootFailed.title, en.bootFailed.why, en.bootFailed.reload]);
  assert.ok(r.classes.has('boot-failed'));
  assert.ok(r.classes.has('body:load-stopped'), 'the Settings spinner stays over the notice');
});

test('a page whose entry module ran shows nothing', () => {
  const r = run({ started: true });
  for (const fn of r.listeners.load) fn();
  for (const fn of r.timers) fn();
  assert.equal(r.screen(), undefined);
});

test('a module script that fails to load shows the notice at once', () => {
  const r = run();
  for (const fn of r.listeners.error) fn({ target: new FakeScript('') });
  assert.equal(r.screen(), undefined, 'a classic script must not count');
  for (const fn of r.listeners.error) fn({ target: new FakeScript('module') });
  assert.ok(r.screen());
});

test('the notice uncovers a page that waits for its language and loads that catalog', async () => {
  const fa = JSON.parse(fs.readFileSync(new URL('../i18n/fa.json', import.meta.url), 'utf8'));
  const r = run({ lang: 'fa', catalog: fa });
  assert.ok(r.classes.has('lang-pending'));
  for (const fn of r.listeners.error) fn({ target: new FakeScript('module') });
  assert.equal(r.classes.has('lang-pending'), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(r.fetched, ['/i18n/fa.json']);
  assert.equal(r.screen().dir, 'rtl');
  assert.deepEqual(r.texts(), [fa.bootFailed.title, fa.bootFailed.why, fa.bootFailed.reload]);
});

test('the notice knows every language the app ships', async () => {
  const { LANGUAGES } = await import('../js/i18n.js');
  const listed = src
    .match(/const LANGS = \[([^\]]+)\]/)[1]
    .match(/'[^']+'/g)
    .map(s => s.slice(1, -1));
  assert.deepEqual([...listed].sort(), LANGUAGES.map(l => l.code).sort());
  const r = run({ languages: ['zh-CN'], catalog: { bootFailed: { title: 'x' } } });
  for (const fn of r.listeners.error) fn({ target: new FakeScript('module') });
  assert.deepEqual(r.fetched, ['/i18n/zh-Hans.json']);
});
