import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
const { linkTo } = await import('../js/widget-toolbox.js');

let opened = [];
globalThis.document = {
  createElement: () => ({
    click() {
      opened.push(this.href);
    },
    remove() {},
  }),
  body: { appendChild() {} },
};

function fakeEl(role = null) {
  const attrs = new Map(role ? [['role', role]] : []);
  const on = {};
  const classes = new Set();
  const el = {
    tabIndex: -1,
    getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: k => {
      attrs.delete(k);
      if (k === 'tabindex') el.tabIndex = -1;
    },
    addEventListener: (type, fn) => {
      on[type] = fn;
    },
    classList: { toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
    fire(type, ev) {
      on[type]?.({ preventDefault() {}, ...ev });
    },
  };
  return el;
}

test('a linked element is a focusable link that opens on click and Enter', () => {
  opened = [];
  const el = fakeEl('group');
  assert.equal(linkTo(el, 'https://example.test/'), true);
  assert.equal(el.getAttribute('role'), 'link');
  assert.equal(el.tabIndex, 0);
  assert.equal(el.classList.contains('clickable'), true);
  el.fire('click', { target: el });
  el.fire('keydown', { target: el, key: 'Enter' });
  el.fire('keydown', { target: el, key: 'a' });
  assert.deepEqual(opened, ['https://example.test/', 'https://example.test/']);
});

test('Enter on a focusable element inside the link is left to it', () => {
  opened = [];
  const el = fakeEl();
  linkTo(el, 'https://example.test/');
  el.fire('keydown', { target: {}, key: 'Enter' });
  assert.deepEqual(opened, []);
});

test('an empty or unsafe link restores the element', () => {
  opened = [];
  const el = fakeEl('img');
  linkTo(el, 'https://example.test/');
  assert.equal(linkTo(el, ''), false);
  assert.equal(el.getAttribute('role'), 'img');
  assert.equal(el.getAttribute('tabindex'), null);
  assert.equal(el.classList.contains('clickable'), false);
  el.fire('click', { target: el });
  assert.deepEqual(opened, []);
  const bad = fakeEl();
  assert.equal(linkTo(bad, 'javascript:alert(1)'), false);
  assert.equal(bad.getAttribute('role'), null);
});

const widget = p => fs.readFileSync(new URL(`../widgets/${p}`, import.meta.url), 'utf8');

test('every widget with a configurable link uses the shared link', () => {
  for (const p of [
    'dns/index.html',
    'weather/index.html',
    'github/contributions.html',
    'connections/connections-vpn.html',
    'backup/backup.html',
    'nowplaying/index.html',
    'books/index.html',
  ]) {
    const src = widget(p);
    assert.match(src, /linkTo\(/, p);
    assert.doesNotMatch(src, /addEventListener\(\s*'click',\s*\(\)\s*=>\s*\{?\s*(if\s*\(\w+\)\s*)?openUrl\(/, p);
    assert.match(src, /\.clickable\s*:focus-visible\s*\{\s*outline:/, p);
  }
});

test('the Now Playing link holds no controls', () => {
  const src = widget('nowplaying/index.html');
  assert.match(src, /<div class="np-link" id="np-link"><\/div>/);
  assert.match(src, /linkTo\(linkEl,href\)/);
});

test('the Books link holds no spines and is not their container', () => {
  const src = widget('books/index.html');
  assert.match(src, /<div class="bk-link" id="bk-link"><\/div>/);
  assert.match(src, /linkTo\(link,href\)/);
  assert.doesNotMatch(src, /card\.setAttribute\('role',\s*'link'\)/);
});

test('the DNS link is described by its summary', () => {
  assert.match(
    widget('dns/index.html'),
    /if \(linkTo\(widgetEl, _href\)\) widgetEl\.setAttribute\('aria-describedby', 'sr'\);/,
  );
});

test('the pull request list holds list items', () => {
  const src = widget('github/pullrequests.html');
  assert.match(src, /item\.setAttribute\('role', 'listitem'\);/);
  assert.match(src, /linkTo\(link, pr\.url\)/);
  assert.match(src, /if \(!items\.length\) \{\n\s*list\.removeAttribute\('role'\);/);
});

test('the contributions summary uses the yearly total', () => {
  assert.match(
    widget('github/contributions.html'),
    /const total = formatNumber\(Math\.max\(0, Number\(data\.totalContributions\) \|\| 0\)\);/,
  );
});
