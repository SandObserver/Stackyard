import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* One font stack across the project.

   -apple-system resolves to the system face and picks the optical cut for the
   size it is used at. Naming a cut pins it and defeats that, so no cut is
   named.

   Widgets are separate documents and may keep their own stylesheet, so they are
   not required to load tokens.css. They are required to spell the stack the
   same way, which is what this checks. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ui = path.join(root, 'ui');
const CANON = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(css|html|js|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

/* The widget guide and the widget template are scanned too. They are what a new
   widget is copied from, so an old stack there reintroduces itself. */
const all = [...files(ui), ...files(path.join(root, 'docs'))].map(p => [
  path.relative(root, p),
  fs.readFileSync(p, 'utf8'),
]);

test('the scan sees the project', () => {
  assert.ok(all.length > 20, `only ${all.length} files found, the scan is probably wrong`);
});

/* inherit and monospace are not the UI face. monospace is for the code spans in
   the admin hints. */
const ALLOWED = new Set(['inherit', 'monospace', 'var(--font-ui)', 'var(--font)']);

test('every font-family is the one stack', () => {
  const offenders = [];
  for (const [name, src] of all) {
    for (const m of src.matchAll(/font-family:\s*([^;}'"]*(?:'[^']*'[^;}]*)*)/g)) {
      const value = m[1].trim().replace(/\s+/g, ' ');
      if (ALLOWED.has(value) || value === CANON) continue;
      offenders.push(`${name}: ${value}`);
    }
  }
  assert.deepEqual(offenders, [], `Font stack spelled differently:\n  ${offenders.join('\n  ')}`);
});

/* Declarations only. The prose in tokens.css and in this file names both cuts to
   say not to use them. */
test('no declaration names an optical cut', () => {
  const offenders = [];
  for (const [name, src] of all) {
    for (const m of src.matchAll(/font-family:[^;}]*/g)) {
      if (/SF Pro (Display|Text)/.test(m[0])) offenders.push(`${name}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `Naming a cut pins it and defeats optical sizing:\n  ${offenders.join('\n  ')}`);
});

test('the token holds the stack, and the two pages use it', () => {
  const tokens = fs.readFileSync(path.join(ui, 'css', 'tokens.css'), 'utf8');
  assert.ok(tokens.includes(`--font-ui: ${CANON};`), '--font-ui must hold the canonical stack');
  for (const page of ['dashboard.css', 'admin.css']) {
    const src = fs.readFileSync(path.join(ui, 'css', page), 'utf8');
    assert.match(src, /font-family:\s*var\(--font-ui\)/, `${page} should name the token`);
  }
});
