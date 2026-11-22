import { test } from 'node:test';
import assert from 'node:assert/strict';
/* html.js is dependency-free, so unlike utils.js it needs no resolve hook. */
import { html, raw, esc, setHtml } from '../js/html.js';

const s = v => String(v);

test('interpolated values are escaped without being asked', () => {
  const label = '<img src=x onerror=alert(1)>';
  assert.equal(s(html`<div>${label}</div>`), '<div>&lt;img src=x onerror=alert(1)&gt;</div>');
});

test('escaping covers the attribute-breakout characters', () => {
  assert.equal(s(html`<div title="${`" onmouseover="alert(1)`}">`), '<div title="&quot; onmouseover=&quot;alert(1)">');
  assert.equal(s(html`<div data-x='${`' onclick='x`}'>`), "<div data-x='&#39; onclick=&#39;x'>");
});

test('static markup in the template is left alone', () => {
  assert.equal(s(html`<b class="x">hi</b>`), '<b class="x">hi</b>');
});

test('raw() opts a trusted string out of escaping', () => {
  assert.equal(s(html`<div>${raw('<b>bold</b>')}</div>`), '<div><b>bold</b></div>');
});

test('nested html results are not double-escaped', () => {
  const inner = html`<b>${'a&b'}</b>`;
  assert.equal(s(html`<div>${inner}</div>`), '<div><b>a&amp;b</b></div>');
});

test('arrays are joined with no separator and each item escaped', () => {
  const items = ['a&b', '<c>'];
  assert.equal(s(html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`), '<ul><li>a&amp;b</li><li>&lt;c&gt;</li></ul>');
});

test('nested arrays flatten', () => {
  assert.equal(s(html`${[['a'], ['b']]}`), 'ab');
});

test('null, undefined and false render as nothing', () => {
  assert.equal(s(html`<i>${null}${undefined}${false}</i>`), '<i></i>');
});

test('zero and empty string render as themselves, not as nothing', () => {
  /* 0 is falsy but meaningful: a badge showing 0 must not vanish. */
  assert.equal(s(html`<i>${0}${''}</i>`), '<i>0</i>');
});

test('numbers are stringified', () => {
  assert.equal(s(html`<i>${42}</i>`), '<i>42</i>');
});

test('a template with no interpolations round-trips', () => {
  assert.equal(s(html``), '');
});

test('the result stringifies for innerHTML assignment', () => {
  /* The DOM coerces via toString, so `el.innerHTML = html`...`` works without a
     wrapper. This pins that contract. */
  const r = html`<p>${'x'}</p>`;
  assert.equal(`${r}`, '<p>x</p>');
  assert.equal(r + '', '<p>x</p>');
});

test('html and esc agree on what escaping means', () => {
  const nasty = `<>&"'`;
  assert.equal(s(html`${nasty}`), esc(nasty));
});

test('raw() accepts a nested html result unchanged', () => {
  assert.equal(s(html`${raw(html`<b>${'&'}</b>`)}`), '<b>&amp;</b>');
});

/* ── setHtml ─────────────────────────────────────────────────────────────── */

test('setHtml writes an html`` result to the element', () => {
  const el = { innerHTML: null };
  setHtml(el, html`<p>${'a&b'}</p>`);
  assert.equal(el.innerHTML, '<p>a&amp;b</p>');
});

test('setHtml refuses a plain string', () => {
  /* The guarantee: an unescaped value cannot reach innerHTML through setHtml,
     even if a caller passes user input straight in. */
  const el = { innerHTML: null };
  assert.throws(() => setHtml(el, '<img src=x onerror=alert(1)>'), TypeError);
  assert.equal(el.innerHTML, null, 'nothing must be written on rejection');
});

test('setHtml refuses values that merely stringify to markup', () => {
  const el = { innerHTML: null };
  assert.throws(() => setHtml(el, { toString: () => '<b>x</b>' }), TypeError);
  assert.throws(() => setHtml(el, ['<b>x</b>']), TypeError);
  assert.throws(() => setHtml(el, null), TypeError);
});

test('setHtml accepts an explicit raw() opt-out', () => {
  const el = { innerHTML: null };
  setHtml(el, raw('<b>trusted</b>'));
  assert.equal(el.innerHTML, '<b>trusted</b>');
});

test('a boolean in an attribute needs String(), because false renders as nothing', () => {
  /* `false` renders as nothing so `${cond && html`...`}` works, which makes
     `aria-selected="${set.has(x)}"` silently produce aria-selected="" where a
     plain template literal produced "false". Attributes that carry a boolean
     must stringify it. This bit the multiselect row during migration. */
  assert.equal(String(html`<li aria-selected="${false}">`), '<li aria-selected="">');
  assert.equal(String(html`<li aria-selected="${String(false)}">`), '<li aria-selected="false">');
  assert.equal(String(html`<li aria-selected="${true}">`), '<li aria-selected="true">');
});

/* A fresh copy of the module, so it creates its policy against the given
   trustedTypes. */
async function withTrustedTypes(trustedTypes, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'trustedTypes');
  globalThis.trustedTypes = trustedTypes;
  try {
    await fn(await import(`../js/html.js?tt=${Math.random()}`));
  } finally {
    if (had) Object.defineProperty(globalThis, 'trustedTypes', had);
    else delete globalThis.trustedTypes;
  }
}

class FakeTrustedHTML {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

test('setHtml writes through the one named Trusted Types policy', async () => {
  const created = [];
  const trustedTypes = {
    createPolicy(name, rules) {
      created.push(name);
      return { createHTML: v => new FakeTrustedHTML(rules.createHTML(v)) };
    },
  };
  await withTrustedTypes(trustedTypes, mod => {
    assert.deepEqual(created, ['stackyard-html']);
    assert.equal(mod.POLICY_NAME, 'stackyard-html');
    const el = { innerHTML: null };
    mod.setHtml(el, mod.html`<b>${'a<b'}</b>`);
    assert.ok(el.innerHTML instanceof FakeTrustedHTML, 'a plain string reached the sink');
    assert.equal(String(el.innerHTML), '<b>a&lt;b</b>');
    assert.throws(() => mod.setHtml(el, '<b>x</b>'), TypeError);
  });
});

test('parseMarkup parses through the policy and refuses a plain string', async () => {
  const trustedTypes = {
    createPolicy: (_name, rules) => ({ createHTML: v => new FakeTrustedHTML(rules.createHTML(v)) }),
  };
  await withTrustedTypes(trustedTypes, mod => {
    const seen = [];
    class Parser {
      parseFromString(src, type) {
        seen.push([src, type]);
        return { documentElement: null };
      }
    }
    mod.parseMarkup(mod.raw('<svg/>'), 'image/svg+xml', Parser);
    assert.ok(seen[0][0] instanceof FakeTrustedHTML);
    assert.equal(String(seen[0][0]), '<svg/>');
    assert.equal(seen[0][1], 'image/svg+xml');
    assert.throws(() => mod.parseMarkup('<svg/>', 'image/svg+xml', Parser), TypeError);
    assert.equal(seen.length, 1);
  });
});

test('without Trusted Types, or when the policy is refused, markup is written as a string', async () => {
  for (const trustedTypes of [
    undefined,
    {
      createPolicy() {
        throw new TypeError('refused');
      },
    },
  ]) {
    await withTrustedTypes(trustedTypes, mod => {
      const el = { innerHTML: null };
      mod.setHtml(el, mod.raw('<i>x</i>'));
      assert.equal(el.innerHTML, '<i>x</i>');
    });
  }
});
