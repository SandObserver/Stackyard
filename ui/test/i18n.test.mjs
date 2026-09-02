import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { register } from 'node:module';

/* i18n.js imports html.js by its served path ('/js/html.js?v=c71f8903...'), which Node
   cannot resolve from disk. Register the mapping hook in THIS process, then load
   i18n.js dynamically so the hook is active when its imports resolve. Same
   reasoning as utils.test.mjs. */
register('./js-root-hooks.mjs', import.meta.url);
const { dirFor, t, getLang, LANGUAGES, SOURCE_LANG, isSupported, pluralCategory, pseudo, PSEUDO_LANG, KEY_LANG } =
  await import('../js/i18n.js');

test('dirFor returns the listed direction for known locales', () => {
  assert.equal(dirFor('en'), 'ltr');
  assert.equal(dirFor('fa'), 'rtl');
  assert.equal(dirFor('zh-Hans'), 'ltr');
  assert.equal(dirFor('de'), 'ltr');
});

test('dirFor infers rtl for unlisted right-to-left scripts', () => {
  assert.equal(dirFor('ar'), 'rtl');
  assert.equal(dirFor('he'), 'rtl');
  assert.equal(dirFor('ur'), 'rtl');
});

test('dirFor matches on the base subtag and defaults to ltr', () => {
  assert.equal(dirFor('ps-AF'), 'rtl');
  assert.equal(dirFor('en-US'), 'ltr');
  assert.equal(dirFor('xx'), 'ltr');
  assert.equal(dirFor(''), 'ltr');
  assert.equal(dirFor(undefined), 'ltr');
});

test('LANGUAGES entries are well-formed with unique codes', () => {
  const codes = new Set();
  for (const l of LANGUAGES) {
    assert.equal(typeof l.code, 'string');
    assert.equal(typeof l.name, 'string');
    assert.ok(l.dir === 'ltr' || l.dir === 'rtl', `${l.code} has invalid dir`);
    assert.ok(!codes.has(l.code), `duplicate code ${l.code}`);
    codes.add(l.code);
  }
  assert.ok(codes.has('en'));
});

test('t falls back to the key itself when nothing is loaded', () => {
  assert.equal(t('some.missing.key'), 'some.missing.key');
  assert.equal(getLang(), 'en');
});

/* A catalog must not inherit from Object.prototype, or `active[key]` finds
   "constructor" and "toString", and t() writes the inherited function into the
   DOM. */
test('t returns the key itself for a key named after an inherited member', () => {
  for (const key of [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    '__proto__',
  ]) {
    assert.equal(t(key), key, key);
  }
});

test('t interpolates provided vars and leaves unmatched placeholders intact', () => {
  assert.equal(t('{name}', { name: 'Sam' }), 'Sam');
  assert.equal(t('{missing}', { name: 'Sam' }), '{missing}');
});

/* ── the locale registry ──────────────────────────────────────────────────── */

test('the registry names the source locale once and marks the rest', () => {
  const source = LANGUAGES.filter(l => l.status === 'source');
  assert.equal(source.length, 1, 'exactly one locale is the source');
  assert.equal(source[0].code, SOURCE_LANG);
  for (const l of LANGUAGES) {
    assert.ok(l.status === 'source' || l.status === 'machine', `${l.code} has an unknown status`);
    assert.equal(typeof l.english, 'string');
    assert.ok(l.english.length > 0, `${l.code} has no English name`);
  }
});

test('the registry is what decides whether a locale is offered', () => {
  assert.ok(isSupported('fa'));
  assert.ok(!isSupported('en-XA'), 'the pseudolocale is not a shipped language');
  assert.ok(!isSupported('ru'));
  assert.ok(!isSupported(''));
});

/* ── plural categories ────────────────────────────────────────────────────── */

/* Choosing on `count === 1` puts zero in the plural form. French and Persian
   both put zero in `one`, and Chinese has a single form for every count. */
test('the plural category comes from the locale, not from count === 1', () => {
  assert.equal(pluralCategory('en', 0), 'other');
  assert.equal(pluralCategory('en', 1), 'one');
  assert.equal(pluralCategory('en', 2), 'other');

  assert.equal(pluralCategory('fr', 0), 'one');
  assert.equal(pluralCategory('fr', 1), 'one');
  assert.equal(pluralCategory('fr', 2), 'other');

  assert.equal(pluralCategory('fa', 0), 'one');
  assert.equal(pluralCategory('fa', 1), 'one');

  assert.equal(pluralCategory('zh-Hans', 1), 'other');
  assert.equal(pluralCategory('zh-Hans', 5), 'other');
});

test('decimal counts get their own category', () => {
  assert.equal(pluralCategory('en', 1.5), 'other');
  assert.equal(pluralCategory('en', 0.5), 'other');
});

test('an unknown locale tag falls back rather than throwing', () => {
  assert.equal(pluralCategory('not a tag', 1), 'one');
  assert.equal(pluralCategory('not a tag', 7), 'other');
});

/* Catalogs are fetched at runtime, so read them from disk here instead. */
const CATALOG_DIR = new URL('../i18n/', import.meta.url);
const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const load = async code => flatten(JSON.parse(await readFile(new URL(`${code}.json`, CATALOG_DIR), 'utf8')));

/* ── the development locales ──────────────────────────────────────────────── */

test('the pseudolocale accents the text and pads it', () => {
  const out = pseudo('Save changes');
  assert.match(out, /^\[.*\]$/, 'the message is not bracketed');
  assert.ok(out.includes('á') && out.includes('é'), 'nothing was accented');
  assert.ok(out.length > 'Save changes'.length * 1.3, 'the text did not expand');
});

/* A renamed placeholder drops the value out of the sentence, and a mangled tag
   reaches the markup sanitiser as text. */
test('the pseudolocale leaves placeholders and markup alone', () => {
  assert.ok(pseudo('Loaded {count} options').includes('{count}'));
  assert.ok(pseudo('{name} of {total}').includes('{name}'));
  assert.ok(pseudo('{name} of {total}').includes('{total}'));
  const tagged = pseudo('Use <code>docker compose</code> or <strong>this</strong>.<br>');
  for (const tag of ['<code>', '</code>', '<strong>', '</strong>', '<br>']) {
    assert.ok(tagged.includes(tag), `${tag} did not survive`);
  }
});

test('the pseudolocale handles an empty or missing message', () => {
  assert.equal(pseudo(''), '[]');
  assert.equal(pseudo(undefined), '[]');
});

test('every shipped message survives pseudolocalisation intact', async () => {
  const en = await load('en');
  const names = v => (String(v).match(/\{\w+\}/g) || []).sort();
  for (const [k, v] of Object.entries(en)) {
    assert.deepEqual(names(pseudo(v)), names(v), `${k} lost a placeholder`);
  }
});

test('the development locales are not shipped languages', () => {
  assert.ok(!isSupported(PSEUDO_LANG));
  assert.ok(!isSupported(KEY_LANG));
  assert.equal(dirFor(PSEUDO_LANG), 'ltr');
});

/* A counted message is the one key set difference a locale is allowed: it
   carries one entry per plural category its own language uses, and English's
   categories are not every language's. Compared by base name, every catalog is
   still exactly the English set. */
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL = new RegExp(`_(${CATEGORIES.join('|')})$`);
const baseNames = keys => [...new Set(keys.map(k => k.replace(PLURAL, '')))].sort();
const codes = async () => (await readdir(CATALOG_DIR)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

test('every locale carries exactly the English key set', async () => {
  const en = baseNames(Object.keys(await load('en')));
  const all = await codes();
  assert.ok(all.length > 1, 'expected more than just the English catalog');
  for (const code of all) {
    assert.deepEqual(baseNames(Object.keys(await load(code))), en, `${code}.json key set differs from en.json`);
  }
});

test('every counted message carries the plural categories its language uses', async () => {
  const enKeys = Object.keys(await load('en'));
  const counted = [...new Set(enKeys.filter(k => PLURAL.test(k)).map(k => k.replace(PLURAL, '')))];
  assert.ok(counted.length > 0, 'no counted messages found; the scan is broken');

  for (const code of await codes()) {
    const cat = await load(code);
    const wanted = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    assert.ok(wanted.includes('other'), `${code} has no 'other' category`);
    for (const base of counted) {
      for (const category of wanted) {
        assert.ok(cat[`${base}_${category}`], `${code}.json is missing ${base}_${category}`);
      }
      const extra = CATEGORIES.filter(c => !wanted.includes(c) && cat[`${base}_${c}`]);
      assert.deepEqual(extra, [], `${code}.json has ${base} forms its language never selects: ${extra}`);
    }
  }
});

/* Machine translation rewrites what looks like a word. A placeholder that came
   back renamed, dropped or duplicated renders as literal braces to the reader,
   or drops the number out of the sentence entirely. */
test('every locale keeps the English placeholders in every message', async () => {
  const en = await load('en');
  const names = v => (String(v).match(/\{\w+\}/g) || []).sort();
  for (const code of await codes()) {
    if (code === 'en') continue;
    const cat = await load(code);
    for (const [k, v] of Object.entries(cat)) {
      const source = en[k] ?? en[`${k.replace(PLURAL, '')}_other`];
      if (source === undefined) continue;
      assert.deepEqual(names(v), names(source), `${code}.json ${k} does not carry the English placeholders`);
    }
  }
});

test('a counted message names its count', async () => {
  const en = await load('en');
  for (const [k, v] of Object.entries(en)) {
    if (PLURAL.test(k)) assert.match(v, /\{count\}/, `${k} is a counted message but never shows the count`);
  }
});

test('the registry and the catalog files name the same locales', async () => {
  const files = new Set(await codes());
  const listed = new Set(LANGUAGES.map(l => l.code));
  assert.deepEqual([...files].sort(), [...listed].sort(), 'a listed locale has no file, or a file is not offered');
});

test('no locale leaves a string empty', async () => {
  const codes = (await readdir(CATALOG_DIR)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  for (const code of codes)
    for (const [k, v] of Object.entries(await load(code)))
      assert.ok(typeof v === 'string' && v.trim(), `${code}.json has an empty value for ${k}`);
});

/* ── counted messages nothing pluralised ──────────────────────────────────── */

/* A message that was never pluralised at all is easy to miss.

   The tell is a number followed by a noun that is written plural in English:
   "{count} items", "at most {n} labels". A number followed by an adjective or a
   participle is not one, because those do not agree in any language shipped
   here: "{count} pending" is right for every count.

   NOT_COUNTED holds what the scan flags that is not a counted noun, each with
   the reason it is not. */
const NOT_COUNTED = {
  'app.pollInterval': 'wraps an editable field, minimum 10',
  /* The sentence is split around a live input, so the surrounding words would
     have to be rebuilt on every keystroke to stay in agreement. The field's
     minimum is 10, so the singular can never be reached. */
};

test('every counted noun has plural forms', async () => {
  const en = await load('en');
  const bases = new Set(Object.keys(en).map(k => k.replace(PLURAL, '')));
  const missing = [];
  for (const [key, value] of Object.entries(en)) {
    if (PLURAL.test(key) || key in NOT_COUNTED) continue;
    /* A placeholder, then a word ending in s that is not a known non-noun. */
    const m = String(value).match(/\{\w+\}\s+([a-z]+s)\b/);
    if (!m) continue;
    if (/^(is|was|has|does|as|its|this|less|plus)$/.test(m[1])) continue;
    if (!bases.has(key) || !Object.keys(en).some(k => k.startsWith(key + '_'))) {
      missing.push(`${key}: "${value}"`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `A count and a plural noun, with no plural forms. Split it per category, or add it to NOT_COUNTED with a reason:\n  ${missing.join('\n  ')}`,
  );
});
