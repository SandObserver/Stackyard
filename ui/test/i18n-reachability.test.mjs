import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Every catalog key is referenced by name, and every name referenced exists.
   Both directions are checked, and both start clean.

   A key referenced through a variable is still found: it appears as a string
   literal even though it is not written inside the t() call. A key assembled
   from pieces at runtime cannot be seen, and needs an entry in DYNAMIC below.
   Nothing needs one today. */

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Keys built at runtime rather than written out. Each needs a reason: the test
   cannot see them, so this list is where they are accounted for. */
const DYNAMIC = {};

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const en = flatten(JSON.parse(fs.readFileSync(path.join(uiDir, 'i18n/en.json'), 'utf8')));
const keys = Object.keys(en).filter(k => !k.startsWith('_meta'));

/* Everything that can reference a key: the two page scripts, the shared
   modules, the static markup, and the widget frontends. */
function sourceFiles() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'test' || e.name === 'i18n' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(uiDir);
  return out;
}

const files = sourceFiles();
/* Comments are stripped first. i18n.js documents the attributes it supports by
   writing data-i18n="key" in a comment, which is documentation, not a
   reference, and would otherwise be reported as a key that does not exist. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const src = files.map(f => stripComments(fs.readFileSync(f, 'utf8'))).join('\n');

/* A key is referenced if its full dotted name appears as a string literal. That
   covers t('a.b'), data-i18n="a.b", and a key held in a variable or an array.

   Matched by substring, not by a regex built from the key. A regex must escape
   every regex character in the key, and escaping only the dot passes until a
   key carries one the escape missed. */
const quoted = k => [`'${k}'`, `"${k}"`, `\`${k}\``];

/* A counted message is stored once per plural category, as `key_one`,
   `key_other` and so on, and the source names the base key. Both directions
   below compare base names, so a category the source never writes out is still
   accounted for. */
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL = new RegExp(`_(${CATEGORIES.join('|')})$`);
const baseName = k => k.replace(PLURAL, '');
const pluralBases = new Set(keys.filter(k => PLURAL.test(k)).map(baseName));

const referenced = new Set(keys.filter(k => quoted(baseName(k)).some(q => src.includes(q))));

/* The widget toolbox loads the widget block and looks up bare names inside it,
   so widget.loading is written as _t('loading', 'Loading'). */
for (const m of src.matchAll(/_t\(\s*['"]([\w.]+)['"]/g)) referenced.add(`widget.${m[1]}`);

test('the scan finds the catalog and the source', () => {
  assert.ok(keys.length > 100, `only ${keys.length} keys parsed`);
  assert.ok(files.length > 20, `only ${files.length} source files found`);
  assert.ok(referenced.has('setup.title'), 'a known key should be found by the scan');
});

/* Direction one: a key nothing names is dead weight, or a sign that the UI it
   belonged to was deleted and the string left behind. */
test('every catalog key is referenced by name', () => {
  const unreferenced = keys.filter(k => !referenced.has(k) && !(k in DYNAMIC)).sort();
  assert.deepEqual(
    unreferenced,
    [],
    `Defined in en.json but named nowhere. Remove them, or add to DYNAMIC with a reason:\n  ${unreferenced.join('\n  ')}`,
  );
});

/* Direction two: this is the one a user sees. t('hom.retry') renders the string
   "hom.retry" on the page, because t falls back to the key. */
test('every referenced key exists in the catalog', () => {
  const named = new Set();
  for (const m of src.matchAll(/(?<![\w$.])t\(\s*['"]([\w.]+\.[\w.]+)['"]/g)) named.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-html|-ph|-al)?=["']([\w.]+)["']/g)) named.add(m[1]);

  const known = new Set(keys);
  const missing = [...named].filter(k => !known.has(k) && !pluralBases.has(k)).sort();
  assert.deepEqual(
    missing,
    [],
    `Referenced but not in en.json; t() renders the key itself to the user:\n  ${missing.join('\n  ')}`,
  );
});

/* Translating by matching rendered English against the catalog must not come
   back. Its absence is what makes the two tests above exact. */
test('translation by matching English text is gone', () => {
  const i18n = fs.readFileSync(path.join(uiDir, 'js/i18n.js'), 'utf8');
  for (const gone of ['revMap', 'translateText', 'TEXT_SELECTORS']) {
    assert.ok(
      !i18n.includes(gone),
      `${gone} is back. Translating by matching rendered English makes reachability undecidable and breaks silently when the English changes.`,
    );
  }
});

/* Two keys may share an English value. Three separate elements legitimately
   read "Search", each free to be translated differently. Nothing to assert. */
