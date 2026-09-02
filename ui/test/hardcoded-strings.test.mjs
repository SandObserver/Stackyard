/* Every user-facing string must go through the translation system.

   The reachability test cannot see a string that was never made a key: English
   typed straight into an attribute leaves nothing missing from the catalogue.
   This scan reads the absence instead, and finds a literal where a translated
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

/* The scan above reads attributes in source text. It cannot see a string
   concatenated or interpolated at run time, such as a translated label with an
   English noun welded onto it. This scan reads the expressions that reach a
   reader. */

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
  const found = [...new Set(runtimeStrings())].sort();
  assert.deepEqual(
    found,
    [],
    `English assembled at run time. Add a key and pass it through t():\n  ${found.join('\n  ')}`,
  );
});

/* The builder writes markup from a template literal, so neither scan above sees
   the words inside it. This one reads the text nodes and the named attributes
   of every html`` block, across lines, because those blocks span them. */
const BLOCKS = /html`((?:[^`\\]|\\.)*)`/g;

const withoutHoles = v =>
  v
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* NOT_PROSE above exempts a bare token, because an attribute value is often
   one. A word on its own in a text node is not, so this scan exempts only a
   unit, a brand and a URL. */
const MARKUP_NOT_PROSE = [/^\([a-z]{1,4}\)$/, /^Stackyard\b/, /^https?:\/\//i, /^[\d.:/]+$/];

test('no user-facing string is written into the markup builder', () => {
  const found = [];
  for (const file of fs.readdirSync(path.join(root, 'js')).sort()) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    const lineOf = at => src.slice(0, at).split('\n').length;
    for (const block of src.matchAll(BLOCKS)) {
      const seen = [];
      for (const m of block[1].matchAll(/>([^<>]+)</g)) seen.push(withoutHoles(m[1]));
      for (const m of block[1].matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)) seen.push(withoutHoles(m[1]));
      for (const value of seen) {
        if (!/[A-Za-z]{2}/.test(value)) continue;
        if (MARKUP_NOT_PROSE.some(re => re.test(value))) continue;
        found.push(`${file}:${lineOf(block.index)}: ${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(found, [], `English written into markup. Add a key and reference it:\n  ${found.join('\n  ')}`);
});
