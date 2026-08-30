/* Regression tests for P8-6: widget status text was always English.

   Every widget shows "Loading", "Unavailable", "No data" and a relative time
   while it works or fails, and all of it was hardcoded English. Someone running
   Stackyard in Persian saw a translated dashboard with English words inside
   every tile.

   Unlike the dashboard's own strings, this was not just a matter of swapping
   text for lookups. A widget is an iframe: it loads widget-toolbox.js but not
   the i18n module, and nothing told it which language was selected. The language
   had to reach the iframe first.

   It arrives on the iframe URL, and the toolbox fetches the same locale file the
   parent already has, so the request comes from cache. The alternative was
   passing the translated strings themselves, which would lengthen the URL with
   every new string; the URL is also the cache key, so it would churn. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const { widgetSrc } = await import('../js/widget-types.js');

const REG = { 'system-summary': { sizes: ['medium'], entryVersions: { 'index.html': 'abc12345' } } };
const ITEM = { id: 'w1', widgetType: 'system-summary', widgetSize: 'medium' };

/* ── the language reaches the iframe ──────────────────────────────────────── */

test('the widget URL carries the language', () => {
  assert.match(widgetSrc(ITEM, REG, { lang: 'fa' }), /[?&]lang=fa\b/);
});

test('a locale tag with a subtag survives', () => {
  assert.match(widgetSrc(ITEM, REG, { lang: 'zh-Hans' }), /[?&]lang=zh-Hans\b/);
});

/* Nothing to say when the caller has no language, and English is the default
   inside the widget anyway. */
test('no language means no parameter', () => {
  assert.doesNotMatch(widgetSrc(ITEM, REG), /lang=/);
});

test('the language does not disturb the other parameters', () => {
  const src = widgetSrc(ITEM, REG, { mobile: true, lang: 'de' });
  for (const part of ['v=abc12345', 'id=w1', 'size=medium', 'mobile=1', 'lang=de']) {
    assert.ok(src.includes(part), `${part} missing from ${src}`);
  }
});

test('both mount sites pass the language', () => {
  assert.match(read('js/dashboard.js'), /widgetSrc\(item, widgetReg, \{ lang: currentLang\(\) \}\)/);
  assert.match(read('js/ui.js'), /widgetSrc\(item, widgetReg\(\), \{ mobile: true, lang: currentLang\(\) \}\)/);
});

test('the locale in use is readable from the i18n module', () => {
  /* Widgets do not load it, so the dashboard has to read it on their behalf. */
  assert.match(read('js/i18n.js'), /export const currentLang = \(\) => current/);
});

/* ── the toolbox uses it ──────────────────────────────────────────────────── */

const toolbox = read('js/widget-toolbox.js');

test('the toolbox reads the language from its own URL', () => {
  assert.match(toolbox, /new URLSearchParams\(location\.search\)\.get\('lang'\)/);
});

test('the toolbox fetches the same locale file the parent uses', () => {
  assert.match(toolbox, /fetch\(`\/i18n\/\$\{encodeURIComponent\(_lang\)\}\.json`/);
  assert.match(toolbox, /cache: 'force-cache'/, 'the parent already fetched it');
});

test('English skips the fetch entirely', () => {
  assert.match(toolbox, /if \(_lang === 'en'\) return;/);
});

test('no status string is hardcoded any more', () => {
  for (const [key, english] of [
    ['loading', 'Loading'],
    ['unavailable', 'Unavailable'],
    ['noData', 'No data'],
  ]) {
    assert.ok(toolbox.includes(`_t('${key}', '${english}')`), `${english} is not looked up`);
  }
});

/* A widget must render before its locale arrives, so the English has to remain
   as a fallback rather than a key appearing on screen. */
test('the English remains as a fallback', () => {
  const fn = toolbox.slice(toolbox.indexOf('function _t('), toolbox.indexOf('}', toolbox.indexOf('function _t(')));
  assert.match(fn, /\|\| fallback/);
});

test('a failed locale fetch does not break the widget', () => {
  /* The catch is empty on purpose; the formatter decides whether the comment
     sits inside the braces or on its own line. */
  assert.match(toolbox, /catch\s*\{\s*\/\* English is a usable answer \*\/\s*\}/);
});

/* ── relative times ───────────────────────────────────────────────────────── */

/* Every language forms these differently, and the plural rules alone differ
   across the six shipped here. Intl knows them; hand-written variants would be
   inventing grammar. */
test('relative times use the browser rather than hand-written rules', () => {
  assert.match(toolbox, /new Intl\.RelativeTimeFormat\(_lang/);
  assert.doesNotMatch(toolbox, /m \+ 'm ago'/, 'the hardcoded English forms are gone');
});

test('Intl produces a different string for each shipped locale', () => {
  const seen = new Set();
  for (const lang of ['en', 'de', 'es', 'fr', 'fa', 'zh-Hans']) {
    const s = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(-5, 'minute');
    assert.ok(s, `${lang} produced nothing`);
    seen.add(s);
  }
  assert.ok(seen.size >= 5, `expected distinct forms, got ${[...seen].join(' | ')}`);
});

test('an unusable locale tag falls back rather than throwing', () => {
  assert.match(toolbox, /catch \{[\s\S]{0,200}\$\{value\}\$\{unit\[0\]\} ago/);
});

/* ── the strings exist ────────────────────────────────────────────────────── */

test('every locale carries the widget strings', () => {
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of ['loading', 'unavailable', 'noData', 'justNow']) {
      assert.ok(cat.widget?.[key], `${file} is missing widget.${key}`);
    }
  }
});

test('the translations are not copies of the English', () => {
  const en = JSON.parse(read('i18n/en.json'));
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json') && f !== 'en.json')) {
    const cat = JSON.parse(read(`i18n/${file}`));
    const same = ['loading', 'unavailable', 'noData'].filter(k => cat.widget[k] === en.widget[k]);
    assert.equal(same.length, 0, `${file} left ${same.join(', ')} in English`);
  }
});

/* Each widget carries its own catalogs, one folder per widget, and nothing was
   comparing them against their own English source. A widget added with five of
   the six languages loses those strings silently: the manifest text renders
   instead, which reads as English inside a translated settings form. */
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PLURAL = new RegExp(`_(${CATEGORIES.join('|')})$`);
const placeholders = v => (String(v).match(/\{\w+\}/g) || []).sort();

const widgetCatalogDirs = () =>
  fs
    .readdirSync(path.join(root, 'widgets'), { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(root, 'widgets', e.name, 'i18n')))
    .map(e => e.name);

test('the scan finds the widget catalogs', () => {
  assert.ok(widgetCatalogDirs().length > 5, 'expected a catalog folder for most widgets');
});

test('every widget catalog covers every shipped locale', () => {
  const wanted = fs
    .readdirSync(path.join(root, 'i18n'))
    .filter(f => f.endsWith('.json'))
    .sort();
  for (const name of widgetCatalogDirs()) {
    const have = fs
      .readdirSync(path.join(root, 'widgets', name, 'i18n'))
      .filter(f => f.endsWith('.json'))
      .sort();
    assert.deepEqual(have, wanted, `widgets/${name}/i18n does not carry the same locales as the dashboard`);
  }
});

test('every widget catalog carries the English key set and its placeholders', () => {
  for (const name of widgetCatalogDirs()) {
    const dir = `widgets/${name}/i18n`;
    const en = JSON.parse(read(`${dir}/en.json`));
    const enBases = [...new Set(Object.keys(en).map(k => k.replace(PLURAL, '')))].sort();
    for (const file of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.json') && f !== 'en.json')) {
      const cat = JSON.parse(read(`${dir}/${file}`));
      const bases = [...new Set(Object.keys(cat).map(k => k.replace(PLURAL, '')))].sort();
      assert.deepEqual(bases, enBases, `${dir}/${file} key set differs from en.json`);
      for (const [k, v] of Object.entries(cat)) {
        assert.ok(typeof v === 'string' && v.trim(), `${dir}/${file} has an empty value for ${k}`);
        const source = en[k] ?? en[`${k.replace(PLURAL, '')}_other`];
        if (source !== undefined)
          assert.deepEqual(placeholders(v), placeholders(source), `${dir}/${file} ${k} changed the placeholders`);
      }
    }
  }
});

/* ── names built on the server ────────────────────────────────────────────── */

/* The pull request filter names were assembled into a finished English string
   in data.js and sent to the page, which then showed them and put them in the
   accessible name. The widget's own catalog already held all six translations
   and never got to use them. The keys travel now, and the page names them. */

test('the GitHub widget is sent filter keys, not English', () => {
  const data = read('widgets/github/data.js');
  assert.match(data, /filters: filterArr/, 'the server has to send the keys');
  assert.doesNotMatch(data, /'review requested'/, 'a finished English name is being sent again');
});

test('the GitHub widget names its filters from its catalog', () => {
  const page = read('widgets/github/pullrequests.html');
  assert.match(page, /wt\('githubPrFilters\.opt\.' \+ f/, 'the page has to look the keys up');
  assert.doesNotMatch(page, /data\.label/, 'the page is still reading the server-built name');
});

test('every locale can name every pull request filter', () => {
  const dir = path.join(root, 'widgets', 'github', 'i18n');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const f of ['created', 'assigned', 'mentioned', 'review-requested']) {
      assert.ok(cat[`githubPrFilters.opt.${f}`], `${file} cannot name the ${f} filter`);
    }
  }
});

/* Both are read out beside an item's name, so an untranslated one reaches a
   screen reader in English while the row beside it is translated. */
test('every locale names the reorder buttons', () => {
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    for (const key of ['moveUp', 'moveDown']) {
      assert.ok(cat.common?.[key], `${file} is missing common.${key}`);
    }
  }
  assert.match(read('js/admin.js'), /t\(dir < 0 \? 'common\.moveUp' : 'common\.moveDown'\)/);
});

/* The tests above cover the toolbox's own status strings. A widget also writes
   text of its own, and that text goes straight to the screen without passing
   through a catalog unless the author remembers `wt`. The GitHub pull request
   caption did not, and read English on every translated dashboard. */
test('no widget writes display text in English', () => {
  const dir = path.join(root, 'widgets');
  const offenders = [];
  for (const widget of fs.readdirSync(dir)) {
    const wdir = path.join(dir, widget);
    if (!fs.statSync(wdir).isDirectory()) continue;
    for (const file of fs.readdirSync(wdir).filter(f => f.endsWith('.html') || f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(wdir, file), 'utf8');
      /* The assigned literal only. A lookup starts with wt( or _t( and does not
         match, and neither does a value built from data. */
      const assign = /\.textContent\s*=\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
      for (const m of src.matchAll(assign)) {
        /* A widget writes markup, entities, interpolated values and a stylesheet
           through this same property. None of them is a sentence someone reads,
           and each is recognised by a character rather than by unpicking it. */
        if (/[{}<>&]/.test(m[2])) continue;
        if (/[A-Za-z]{3,}/.test(m[2])) offenders.push(`${widget}/${file}: ${m[2].trim().slice(0, 40)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these strings never reach a catalog');
});

/* The fallback is what renders until the catalog arrives, so it has to be the
   English the catalog was written from. */
test('the pull request caption is looked up, and every locale translates it', () => {
  assert.match(read('widgets/github/pullrequests.html'), /wt\('view\.prs\.label', 'Pull Requests'\)/);
  const dir = path.join(root, 'widgets', 'github', 'i18n');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.ok(cat['view.prs.label'], `${file} cannot name the pull request view`);
  }
});

/* The accessible label went through Intl from the start. The date on screen did
   not, so a Persian dashboard showed a Persian clock reading "Sun, Aug 30". */
test('both clock styles name days and months through Intl', () => {
  for (const style of ['analog', 'digital']) {
    const src = read(`widgets/clock/${style}.html`);
    assert.match(src, /_dateShortFmt\.format\(now\)/, `${style} does not format its date`);
    assert.doesNotMatch(src, /'Jan'\s*,\s*'Feb'/, `${style} still carries English month names`);
    assert.doesNotMatch(src, /'Sun'\s*,\s*'Mon'/, `${style} still carries English day names`);
  }
});
