/* No inline event handler in markup. Every page except the widget iframes
   serves script-src 'self', so the browser refuses one: the control renders,
   looks clickable, and does nothing, with the only clue in the console.

   The failure is silent, which is why it is worth a test rather than a fix
   alone. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Everything the browser loads, except node_modules and the tests themselves. */
function sources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'test' && e.name !== 'node_modules') sources(rel, out);
    } else if (/\.(js|mjs|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const FILES = sources('.');

/* Matches an attribute in markup, not a property assignment. `el.onclick = fn`
   is ordinary JavaScript and works fine; `onclick="..."` inside a string or a
   template is what the CSP refuses. */
const INLINE_ATTR = /\son[a-z]+\s*=\s*["'][^"']/gi;

/* Comment spans, as [start, end) offsets.

   Do not delete the comments and search what is left. One pass over
   `<!--...-->` leaves the opener of an unterminated comment behind, so a
   handler after it is missed. Finding the spans rewrites nothing, an
   unterminated comment runs to the end of the file as a parser would treat it,
   and a match keeps its true line number.

   Deliberately not a full tokenizer: `//` inside a string or a regular
   expression is read as a comment here. That errs towards ignoring a match, and
   the retry-button assertions below pin the two real call sites. */
function commentSpans(src) {
  const spans = [];
  const push = (open, close, keepOpen) => {
    let i = 0;
    while ((i = src.indexOf(open, i)) !== -1) {
      const end = close ? src.indexOf(close, i + open.length) : -1;
      const stop = end === -1 ? src.length : end + close.length;
      spans.push([i, stop]);
      i = stop;
      if (keepOpen && end === -1) break;
    }
  };
  push('/*', '*/', true);
  push('<!--', '-->', true);

  /* Line comments end at the newline, so they never run away. */
  let i = 0;
  while ((i = src.indexOf('//', i)) !== -1) {
    const nl = src.indexOf('\n', i);
    spans.push([i, nl === -1 ? src.length : nl]);
    i = nl === -1 ? src.length : nl;
  }
  return spans;
}

const inComment = (spans, at) => spans.some(([a, b]) => at >= a && at < b);

const lineOf = (src, at) => src.slice(0, at).split('\n').length;

test('the source tree has files to check', () => {
  assert.ok(FILES.length > 20, `only found ${FILES.length} files`);
});

test('no markup carries an inline event handler', () => {
  const found = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const spans = commentSpans(src);
    for (const m of src.matchAll(INLINE_ATTR)) {
      if (inComment(spans, m.index)) continue;
      found.push(`${f}:${lineOf(src, m.index)} ${m[0].trim()}`);
    }
  }
  assert.deepEqual(found, [], `inline handlers are refused by the CSP:\n${found.join('\n')}`);
});

/* The scan is only worth anything if it would catch the bug it exists for. */
test('the scan finds an inline handler in code and ignores one in a comment', () => {
  const real = '<button onclick="location.reload()">Retry</button>';
  const spans = commentSpans(real);
  const hits = [...real.matchAll(INLINE_ATTR)].filter(m => !inComment(spans, m.index));
  assert.equal(hits.length, 1, 'a real inline handler must be found');

  const commented = '/* written as onclick="x" once */\nconst a = 1;';
  const cSpans = commentSpans(commented);
  assert.equal([...commented.matchAll(INLINE_ATTR)].filter(m => !inComment(cSpans, m.index)).length, 0);
});

/* An unterminated comment must not let a later handler slip through. */
test('an unterminated comment does not hide or reveal a handler', () => {
  const src = '<!-- a --> <!-- b\n<button onclick="x">';
  const spans = commentSpans(src);
  const hits = [...src.matchAll(INLINE_ATTR)].filter(m => !inComment(spans, m.index));
  assert.equal(hits.length, 0, 'everything after an unterminated opener is comment');

  const closed = '<!-- a --> <button onclick="x">';
  const cSpans = commentSpans(closed);
  assert.equal(
    [...closed.matchAll(INLINE_ATTR)].filter(m => !inComment(cSpans, m.index)).length,
    1,
    'and a closed comment does not swallow what follows it',
  );
});

/* The buttons themselves still exist and are still wired, just not inline. */
test('both retry buttons attach their handler in code', () => {
  for (const [file, selector] of [
    ['js/dashboard.js', '.api-error-btn'],
    ['js/admin.js', '.retry-btn'],
  ]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(src.includes(selector), `${file} should still render the retry button`);
    /* Either the raw lookup or the typed q() helper from utils.js; what matters
       is that the handler is attached in code rather than as an inline
       onclick, which the page's CSP forbids. */
    assert.match(
      src,
      new RegExp(
        `(querySelector\\('${selector.replace('.', '\\.')}'\\)|q\\('${selector.replace('.', '\\.')}',[^)]*\\))\\?\\.addEventListener\\('click'`,
      ),
      `${file} should attach the retry handler with addEventListener`,
    );
    assert.match(src, /location\.reload\(\)/, `${file} should still reload`);
  }
});

/* The rule exists because of the policy, so if the policy ever allowed inline
   script this test would be enforcing nothing. */
test('the pages really do forbid inline script', () => {
  const nginx = path.resolve(root, '../nginx');
  const csp = fs.readFileSync(path.join(nginx, 'csp-default.conf'), 'utf8');
  assert.match(csp, /script-src 'self';/, 'the default policy must not allow inline script');

  const dashboard = fs.readFileSync(path.join(nginx, 'dashboard.conf'), 'utf8');
  const admin = dashboard.slice(dashboard.indexOf('location ^~ /admin {'));
  assert.match(
    admin.slice(0, admin.indexOf('\n    }')),
    /script-src 'self';/,
    'the admin policy must not allow inline script either',
  );
});
