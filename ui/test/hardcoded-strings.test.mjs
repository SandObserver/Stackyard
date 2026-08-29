/* Every user-facing string must go through the translation system.

   The reachability test proves each catalogue key is used and each reference
   exists. It cannot see a string that was never made a key: English typed
   straight into an attribute is invisible to it, because nothing is missing
   from the catalogue. About 55 such strings had accumulated in Settings, most
   of them accessible names, so a screen reader in Persian read a translated
   page and then spoke English for every control.

   This scan reads the absence instead. It finds a literal where a translated
   value belongs. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Attributes a reader is given, and the row label the pencil is named after. */
const PATTERNS = [
  ['aria-label', /aria-label="([^"${}<>]{2,})"/g],
  ['placeholder', /placeholder="([^"${}<>]{2,})"/g],
  ['title', /(?<!data-i18n-)title="([^"${}<>]{2,})"/g],
  ['row label', /<span class="rl">([^<${}]{2,})</g],
];

/* A literal that is not prose: an example value, a technical token, a brand.
   Each is text no language changes. */
const NOT_PROSE = [
  /^[\d.:/]+$/ /* 192.168.1.100, 2000 */,
  /^https?:\/\//i,
  /^#[0-9a-fA-F]{3,8}$/,
  /^[A-Za-z0-9_-]+$/ /* one bare token: AGVpqBZnzUE, autoplay */,
  /^Stackyard\b/,
  /^e\.g\./i,
  /^\(.*\)$/ /* a parenthesised unit beside a translated label */,
];

const sources = () => {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (['test', 'i18n', 'node_modules', 'icons', 'widgets'].includes(e.name)) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk('js');
  walk('admin');
  out.push('index.html');
  return out;
};

test('the scan reads the interface source', () => {
  const files = sources();
  assert.ok(files.length > 20, `only ${files.length} files scanned`);
  assert.ok(
    files.some(f => f.endsWith('admin/index.html')),
    'the settings markup is not being scanned',
  );
});

test('no user-facing string is written into the source instead of a catalogue', () => {
  const found = [];
  for (const file of sources()) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [what, pattern] of PATTERNS) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
        const value = m[1].trim();
        if (!/[A-Za-z]{2}/.test(value)) continue;
        if (NOT_PROSE.some(re => re.test(value))) continue;
        /* Already wired: the literal is the English default beside its key. */
        const after = src.slice(m.index, m.index + m[0].length + 90);
        if (/data-i18n(-html|-ph|-al|-title)?=/.test(after)) continue;
        found.push(`${file}: ${what} "${value}"`);
      }
    }
  }
  assert.deepEqual(found, [], `English written into the source. Add a key and reference it:\n  ${found.join('\n  ')}`);
});
