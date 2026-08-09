import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Every catalog key is referenced by name, and every name referenced exists.

   P15-1 and P15-4. This could not be checked before, because the app
   translated two different ways. Most strings were looked up by key, but about
   50 were translated by matching their rendered English text against the
   catalog at runtime: the markup said "Name" and a reverse map swapped it for
   "Nom". Reachability was then a substring search over the source, which can
   only ever be a guess, and the mechanism failed in ways nothing reported:
   editing the English text in markup silently stopped that string translating,
   in every language; three keys shared the text "Search", so whichever was
   read last won; and short values like "All" or "Set" were swapped wherever
   they appeared.

   Those sites now name their key, the reverse map is gone, and the question is
   exactly decidable. Both directions are checked, and both start clean.

   A key referenced through a variable, as password-strength.js does with its
   labelKey, is still found: the key appears as a string literal in the source
   even though it is not written inside the t() call. That is the one thing
   this cannot follow, so a key assembled from pieces at runtime would need an
   entry in DYNAMIC below. Nothing needs one today. */

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

   Matched by substring rather than by a regex built from the key. Building one
   means escaping the key first, and escaping only the dot, as this did, is the
   kind of half-sanitisation that is right until a key contains a character the
   escape missed. There is nothing to escape in a plain includes(). */
const quoted = k => [`'${k}'`, `"${k}"`, `\`${k}\``];
const referenced = new Set(keys.filter(k => quoted(k).some(q => src.includes(q))));

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
  const missing = [...named].filter(k => !known.has(k)).sort();
  assert.deepEqual(
    missing,
    [],
    `Referenced but not in en.json; t() renders the key itself to the user:\n  ${missing.join('\n  ')}`,
  );
});

/* The mechanism this replaced. Its absence is what makes the two tests above
   exact rather than approximate, so it must not come back. */
test('translation by matching English text is gone', () => {
  const i18n = fs.readFileSync(path.join(uiDir, 'js/i18n.js'), 'utf8');
  for (const gone of ['revMap', 'translateText', 'TEXT_SELECTORS']) {
    assert.ok(
      !i18n.includes(gone),
      `${gone} is back. Translating by matching rendered English makes reachability undecidable and breaks silently when the English changes.`,
    );
  }
});

/* Two keys sharing an English value used to be a real hazard: the reverse map
   was keyed by value, so one of them silently won. With that gone they are
   independent, and three separate elements legitimately read "Search" — a
   placeholder, a label and a dialog's aria-label, each free to be translated
   differently. Nothing to assert. */
