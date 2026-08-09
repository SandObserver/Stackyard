const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { TRANSLATABLE } = require('../src/widget-i18n');

/* The bundled widgets' own catalogs. A missing key is not an error at runtime,
   it falls back, so nothing would fail loudly if a language drifted: the widget
   would just quietly show English in the middle of a translated form. These
   tests are what makes that drift visible.

   Only bundled widgets are checked. A third-party widget is free to ship one
   language, or none. */

const WIDGETS_DIR = path.join(__dirname, '..', '..', 'ui', 'widgets');
/* The dashboard's own languages. A widget catalog for a language the dashboard
   cannot select would never be read. */
const LANGUAGES = ['en', 'fa', 'zh-Hans', 'es', 'de', 'fr'];

const widgets = fs
  .readdirSync(WIDGETS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(WIDGETS_DIR, d.name, 'widget.json')))
  .map(d => d.name);

const hasCatalog = w => fs.existsSync(path.join(WIDGETS_DIR, w, 'i18n', 'en.json'));
const readCatalog = (w, lang) => JSON.parse(fs.readFileSync(path.join(WIDGETS_DIR, w, 'i18n', lang + '.json'), 'utf8'));

/* Every translatable string in a manifest, as it is written there. */
function manifestStrings(widget) {
  const manifest = JSON.parse(fs.readFileSync(path.join(WIDGETS_DIR, widget, 'widget.json'), 'utf8'));
  const found = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && TRANSLATABLE.has(k)) found.push(v);
      else walk(v);
    }
  };
  walk(manifest);
  return found;
}

test('at least one bundled widget ships a catalog, or these tests prove nothing', () => {
  assert.ok(widgets.some(hasCatalog), 'no widget has i18n/en.json');
});

for (const widget of widgets.filter(hasCatalog)) {
  test(`${widget}: every language has exactly the English keys`, () => {
    const en = Object.keys(readCatalog(widget, 'en')).sort();
    for (const lang of LANGUAGES.filter(l => l !== 'en')) {
      const file = path.join(WIDGETS_DIR, widget, 'i18n', lang + '.json');
      assert.ok(fs.existsSync(file), `${widget} is missing ${lang}.json`);
      assert.deepEqual(
        Object.keys(readCatalog(widget, lang)).sort(),
        en,
        `${widget}/${lang}.json does not have the same keys as en.json`,
      );
    }
  });

  test(`${widget}: no translation is left blank`, () => {
    for (const lang of LANGUAGES) {
      for (const [k, v] of Object.entries(readCatalog(widget, lang))) {
        assert.equal(typeof v, 'string', `${widget}/${lang}.json: ${k} is not a string`);
        assert.notEqual(v.trim(), '', `${widget}/${lang}.json: ${k} is empty`);
      }
    }
  });

  test(`${widget}: every manifest string is a key the catalog answers`, () => {
    /* A manifest string that is not in the catalog still renders, as itself.
       That is the fallback third-party widgets rely on, but for a bundled
       widget it means a string nobody can translate. */
    const en = readCatalog(widget, 'en');
    const orphans = manifestStrings(widget).filter(s => !(s in en));
    assert.deepEqual(orphans, [], `${widget}: manifest strings with no catalog entry`);
  });

  test(`${widget}: placeholders survive every translation`, () => {
    const en = readCatalog(widget, 'en');
    for (const lang of LANGUAGES.filter(l => l !== 'en')) {
      const other = readCatalog(widget, lang);
      for (const [k, v] of Object.entries(en)) {
        const want = (v.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
        const got = ((other[k] || '').match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();
        assert.deepEqual(got, want, `${widget}/${lang}.json: ${k} does not carry the same placeholders`);
      }
    }
  });
}
