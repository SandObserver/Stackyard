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
