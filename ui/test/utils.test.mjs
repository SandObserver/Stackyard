import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* utils.js imports a peer by its served path ('/js/icons.js?v=...'), which Node
   cannot resolve from disk. Register the mapping hook in THIS process, then load
   utils.js dynamically so the hook is active when its imports resolve. Doing it
   here (rather than via --import) keeps it working under the test runner's
   per-file child processes. */
register('./js-root-hooks.mjs', import.meta.url);
const { clr, esc } = await import('../js/utils.js');

test('clr maps the sentinel color names to concrete hex', () => {
  assert.equal(clr('dark'), '#1C1C1E');
  assert.equal(clr('light'), '#F2F2F7');
});

test('clr treats empty/falsy as dark', () => {
  assert.equal(clr(''), '#1C1C1E');
  assert.equal(clr(null), '#1C1C1E');
  assert.equal(clr(undefined), '#1C1C1E');
});

test('clr passes through any other value unchanged', () => {
  assert.equal(clr('#abcdef'), '#abcdef');
  assert.equal(clr('rebeccapurple'), 'rebeccapurple');
});

test('esc encodes the five HTML-significant characters', () => {
  assert.equal(esc('<a href="x">&\'y\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;\'y\'&lt;/a&gt;');
});

test('esc encodes ampersand before other entities (no double-encoding)', () => {
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('&lt;'), '&amp;lt;');
});

test('esc coerces null and undefined to empty string', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});
