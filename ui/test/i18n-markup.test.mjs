/* A translated string may carry markup, and must not carry anything else.
   `data-i18n-html` allows four tags with no attributes and escapes the rest.
   Passing the string through raw() instead allows a script tag, an event
   handler or an image with onerror.

   The mechanism exists because two tips use <strong> mid-sentence, and
   splitting those into separate keys stops a translator moving the emphasis.
   raw() around a string with no markup in it switches off escaping for
   nothing.

   The realistic path is a careless or malicious translation contribution.
   Locale files are static assets with no runtime mechanism to add one. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { register } from 'node:module';

/* The module under test imports /js/html.js, a browser-absolute path, so the
   resolution hook has to be registered before it loads. */
register('./js-root-hooks.mjs', import.meta.url);
const { sanitizeI18nMarkup, ALLOWED_TAGS, VOID_TAGS } = await import('../js/i18n-markup.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* ── what the mechanism exists for ────────────────────────────────────────── */

test('the tags the shipped strings actually use are kept', () => {
  assert.equal(
    sanitizeI18nMarkup('Use the URL of a <strong>socket proxy</strong> container.'),
    'Use the URL of a <strong>socket proxy</strong> container.',
  );
  assert.equal(sanitizeI18nMarkup('a <em>b</em> <code>c</code> d<br>e'), 'a <em>b</em> <code>c</code> d<br>e');
});

/* Compare tags rather than whole strings: text is escaped either way, so a
   legitimate apostrophe in a French translation becomes &#39; and byte equality
   would fail for the wrong reason. What must hold is that every tag a translator
   wrote is still a tag afterwards. */
const tagsOf = s => [...String(s).matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1].toLowerCase());

const htmlKeys = () => [...read('admin/index.html').matchAll(/data-i18n-html="([^"]+)"/g)].map(m => m[1]);

test('the markup in the real shipped strings is preserved', () => {
  /* If a future translation adds a tag outside the subset, this fails and the
     string gets fixed rather than the subset quietly widening. */
  const en = JSON.parse(read('i18n/en.json'));
  const keys = htmlKeys();
  assert.ok(keys.length >= 2, 'expected the tips that use this mechanism');
  for (const key of keys) {
    const [a, b] = key.split('.');
    const value = en[a]?.[b];
    assert.ok(value, `${key} missing from en.json`);
    assert.deepEqual(tagsOf(sanitizeI18nMarkup(value)), tagsOf(value), `${key} uses markup outside the subset`);
  }
});

test('every locale keeps its markup too', () => {
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of htmlKeys()) {
      const [a, b] = key.split('.');
      const value = cat[a]?.[b];
      if (!value) continue; /* a locale may not translate every key yet */
      assert.deepEqual(
        tagsOf(sanitizeI18nMarkup(value)),
        tagsOf(value),
        `${file}: ${key} uses markup outside the subset`,
      );
    }
  }
});

/* ── what must not get through ────────────────────────────────────────────── */

test('a script tag becomes visible text', () => {
  const out = sanitizeI18nMarkup('<script>alert(1)</script>');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /&lt;script&gt;/);
});

test('an element with an event handler is not an element', () => {
  for (const v of ['<img src=x onerror=alert(1)>', '<strong onclick=alert(1)>x</strong>', '<em style="x">y</em>']) {
    const out = sanitizeI18nMarkup(v);
    assert.doesNotMatch(out, /<(img|strong|em)[^>]*\s/i, `${v} kept an attribute: ${out}`);
  }
});

/* The escaped text may well contain the word "class"; what matters is that no
   emitted element carries anything but its name. */
test('no emitted element carries an attribute', () => {
  for (const v of ['<strong class="x">y</strong>', '<em id=z>y</em>', '<code data-x>y</code>', '<br class="y">']) {
    const out = sanitizeI18nMarkup(v);
    const emitted = [...out.matchAll(/<\/?[a-zA-Z][^>]*>/g)].map(m => m[0]);
    for (const tag of emitted) {
      assert.match(tag, /^<\/?(strong|em|code|br)>$/, `${v} emitted ${tag}`);
    }
  }
});

/* Dropping the tag would lose the word inside it silently. Showing it lets a
   translator see the mistake in the UI. */
test('a tag outside the subset is shown, not dropped', () => {
  assert.equal(sanitizeI18nMarkup('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
  assert.equal(sanitizeI18nMarkup('<a href="x">link</a>'), '&lt;a href=&quot;x&quot;&gt;link&lt;/a&gt;');
});

test('ordinary text is escaped as usual', () => {
  assert.equal(sanitizeI18nMarkup('plain & <text>'), 'plain &amp; &lt;text&gt;');
  assert.equal(sanitizeI18nMarkup('it\'s "quoted"'), 'it&#39;s &quot;quoted&quot;');
});

/* ── malformed markup cannot unbalance the output ─────────────────────────── */

test('an unclosed tag is closed', () => {
  assert.equal(sanitizeI18nMarkup('<strong>unclosed'), '<strong>unclosed</strong>');
});

test('a stray closing tag is dropped', () => {
  assert.equal(sanitizeI18nMarkup('</strong>stray'), 'stray');
  assert.equal(sanitizeI18nMarkup('a</em>b'), 'ab');
});

test('crossed tags come out nested', () => {
  assert.equal(sanitizeI18nMarkup('<strong><em>nested</strong></em>'), '<strong><em>nested</em></strong>');
});

test('a void tag needs no closing tag and accepts none', () => {
  assert.equal(sanitizeI18nMarkup('<br/>'), '<br>');
  assert.equal(sanitizeI18nMarkup('a<br>b'), 'a<br>b');
  assert.equal(sanitizeI18nMarkup('a</br>b'), 'ab');
});

test('a self-closing non-void tag is not treated as an element', () => {
  assert.equal(sanitizeI18nMarkup('<strong/>'), '&lt;strong/&gt;');
});

test('output has balanced tags for arbitrary junk', () => {
  const junk = [
    '<<strong>>',
    '<strong',
    'strong>',
    '<>',
    '</>',
    '<strong></strong></strong>',
    '<em><em><em>x',
    '<br><br/></br>',
    '<STRONG>x</STRONG>',
  ];
  for (const v of junk) {
    const out = sanitizeI18nMarkup(v);
    const opens = (out.match(/<(strong|em|code)>/g) || []).length;
    const closes = (out.match(/<\/(strong|em|code)>/g) || []).length;
    assert.equal(opens, closes, `unbalanced for ${JSON.stringify(v)}: ${out}`);
  }
});

test('tag names are matched case-insensitively', () => {
  assert.equal(sanitizeI18nMarkup('<STRONG>x</Strong>'), '<strong>x</strong>');
});

test('non-string input does not throw', () => {
  for (const v of [null, undefined, 0, {}, []]) assert.equal(typeof sanitizeI18nMarkup(v), 'string');
});

test('the allowed set is small and deliberate', () => {
  assert.deepEqual([...ALLOWED_TAGS].sort(), ['br', 'code', 'em', 'strong']);
  assert.deepEqual([...VOID_TAGS], ['br']);
});

/* ── P10-4: raw() where there was nothing to protect ──────────────────────── */

test('no translated string is passed through raw()', () => {
  for (const f of ['js/admin.js', 'js/i18n.js']) {
    assert.doesNotMatch(read(f), /raw\(\s*t\(/, `${f} still switches escaping off for a translation`);
  }
});

test('i18n.js no longer imports raw at all', () => {
  assert.doesNotMatch(read('js/i18n.js'), /\braw\b/);
});
