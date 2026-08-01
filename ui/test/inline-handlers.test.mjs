/* Regression test for P9-2: an inline handler that the CSP refuses to run.

   The API error screen offered a Retry button written as
   onclick="location.reload()". Every page except the widget iframes serves
   script-src 'self', so the browser refuses an inline handler: the button
   rendered, looked clickable, and did nothing. A user whose dashboard was
   already broken clicked the one obvious remedy and got no response, with the
   only clue in the console.

   This class of bug is silent by nature, which is why it is worth a test rather
   than a fix alone. Handlers are attached with addEventListener now. */

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
    if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') sources(rel, out); }
    else if (/\.(js|mjs|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const FILES = sources('.');

/* Matches an attribute in markup, not a property assignment. `el.onclick = fn`
   is ordinary JavaScript and works fine; `onclick="..."` inside a string or a
   template is what the CSP refuses. Comments are stripped first, since a comment
   explaining this rule would otherwise trip it. */
const INLINE_ATTR = /\son[a-z]+\s*=\s*["'][^"']/gi;

const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '');

test('the source tree has files to check', () => {
  assert.ok(FILES.length > 20, `only found ${FILES.length} files`);
});

test('no markup carries an inline event handler', () => {
  const found = [];
  for (const f of FILES) {
    const src = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
    for (const m of src.matchAll(INLINE_ATTR)) {
      /* Report enough context to find it. */
      const line = src.slice(0, m.index).split('\n').length;
      found.push(`${f}:${line} ${m[0].trim()}`);
    }
  }
  assert.deepEqual(found, [], `inline handlers are refused by the CSP:\n${found.join('\n')}`);
});

/* The buttons themselves still exist and are still wired, just not inline. */
test('both retry buttons attach their handler in code', () => {
  for (const [file, selector] of [['js/dashboard.js', '.api-error-btn'], ['js/admin.js', '.retry-btn']]) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(src.includes(selector), `${file} should still render the retry button`);
    assert.match(src, new RegExp(`querySelector\\('${selector.replace('.', '\\.')}'\\)\\?\\.addEventListener\\('click'`),
      `${file} should attach the retry handler with addEventListener`);
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
  assert.match(admin.slice(0, admin.indexOf('\n    }')), /script-src 'self';/,
    'the admin policy must not allow inline script either');
});
