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

/* The scan above reads attributes in source text. It cannot see a string that
   is concatenated or interpolated at run time, which is how the same defect
   came back: a translated label with an English noun welded onto it. This scan
   reads the other half, the expressions that reach a reader. */

/* Where a string becomes something a person reads. */
const SINKS = [
  /setAttribute\(\s*['"](?:aria-label|title|placeholder|alt|aria-description|aria-valuetext)['"]\s*,/g,
  /\.(?:textContent|innerText|title|ariaLabel)\s*=/g,
  /\.dataset\.tileName\s*=/g,
  /\btoast\(/g,
  /\bsetUserText\(\s*[^,]+,/g,
];

/* The tone of a toast, at the end of the call. */
const TONE = /,\s*'(?:err|ok|warn|info)'\s*\)\s*;?\s*$/;

/* A literal that is an argument or an operand names a key, an attribute or a
   mode. Only what is concatenated or interpolated becomes text. */
const OPERANDS =
  /\b[A-Za-z_$][\w$]*\(\s*(?:'[^'\\\n]*'|"[^"\\\n]*")\s*[,)]|[=!]==?\s*(?:'[^'\\\n]*'|"[^"\\\n]*")|\?\s*'(?:err|ok|warn|info)'\s*:\s*'(?:err|ok|warn|info)'/g;

const textLiterals = slice => {
  for (let prev = null; prev !== slice; ) {
    prev = slice;
    slice = slice.replace(/\bt\([^()]*\)/g, '');
  }
  const bare = slice.replace(OPERANDS, m => m.replace(/['"][^'"]*['"]/, "''"));
  const out = [];
  for (const m of bare.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`((?:[^`\\])*)`/g)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw === undefined) continue;
    for (const piece of raw.split(/\$\{[^}]*\}/)) out.push(piece);
  }
  return out;
};

/* A bare lowercase token with nothing around it is a mode or a flag. A fragment
   with a space beside it was concatenated onto text a person reads. */
const READS_AS_PROSE = v =>
  /[A-Za-z]{2}/.test(v) &&
  !/[<>]/.test(v) &&
  !/="/.test(v) &&
  !/^Stackyard\b/.test(v.trim()) &&
  !/^https?:/i.test(v.trim()) &&
  !(v === v.trim() && /^[a-z][a-z0-9-]*$/.test(v));

/* Settings strings still to be translated. This list only shrinks. Adding to it
   is not a fix. */
const PERMITTED = new Set([
  'admin-app-form.js: " value"',
  'admin-app-form.js: "Upload failed: "',
  'admin-app-form.js: "Uploaded "',
  'admin-app-form.js: "↑ Uploading…"',
  'admin-app-form.js: "✓ Connected, no numeric values found"',
  'admin-app-form.js: "✓ Found "',
  'admin-app-form.js: "✓ Reachable ("',
  'admin-app-form.js: "✗ HTTP "',
  'admin-color-control.js: "Dark"',
  'admin-color-control.js: "Light"',
  'admin.js: " apps"',
  'admin.js: " is required"',
  'admin.js: " widget · "',
  'admin.js: "Added"',
  'admin.js: "Could not load config. Is the API container running? ("',
  'admin.js: "Error: "',
  'admin.js: "Name required"',
  'admin.js: "Save failed: "',
  'admin.js: "Saved"',
  'admin.js: "URL required"',
  'admin.js: "Updated"',
]);

const runtimeStrings = () => {
  const seen = [];
  for (const file of fs.readdirSync(path.join(root, 'js')).sort()) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    for (const line of src.split('\n')) {
      for (const sink of SINKS) {
        sink.lastIndex = 0;
        for (const m of line.matchAll(sink)) {
          const slice = line.slice(m.index + m[0].length).replace(TONE, '');
          if (slice.includes('html`')) continue;
          for (const v of textLiterals(slice)) {
            if (READS_AS_PROSE(v)) seen.push(`${file}: ${JSON.stringify(v)}`);
          }
        }
      }
    }
  }
  return seen;
};

test('no user-facing string is built at run time instead of translated', () => {
  const found = [...new Set(runtimeStrings())].filter(s => !PERMITTED.has(s)).sort();
  assert.deepEqual(
    found,
    [],
    `English assembled at run time. Add a key and pass it through t():\n  ${found.join('\n  ')}`,
  );
});

test('nothing permitted has already been translated', () => {
  const seen = new Set(runtimeStrings());
  const stale = [...PERMITTED].filter(s => !seen.has(s)).sort();
  assert.deepEqual(stale, [], `translated already; delete these from PERMITTED:\n  ${stale.join('\n  ')}`);
});
