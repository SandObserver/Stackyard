// @ts-check
/* Catalogs are plain JSON at /i18n/<code>.json. English is the source and the
   fallback. */

import { setHtml } from '/js/html.js?v=c71f8903';
import { i18nMarkup } from '/js/i18n-markup.js?v=8c90e1dd';

/* The locale registry: the one place a supported language is defined.

   `code` is a BCP 47 tag and the catalog filename. `name` is the language's own
   name, shown in the selector. `english` is its English name, for documentation
   and for reporting. `dir` is the writing direction. `status` is 'source' for
   the language the strings are written in, and 'machine' for a catalog produced
   by machine translation and not yet checked by a speaker.

   Only list a locale whose file exists, or the selector offers one that cannot
   render. */
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr', status: 'source' },
  { code: 'fa', name: 'فارسی', english: 'Persian', dir: 'rtl', status: 'machine' },
  { code: 'zh-Hans', name: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr', status: 'machine' },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr', status: 'machine' },
  { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr', status: 'machine' },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr', status: 'machine' },
];

/** The source locale. It is the fallback for every key, and the only catalog
    whose text is written rather than translated. */
export const SOURCE_LANG = 'en';

/** @param {string} code @returns {boolean} Whether the registry lists it. */
export const isSupported = code => LANGUAGES.some(l => l.code === code);

/* Direction for a code the registry does not list, taken from the locale data
   the runtime already carries rather than guessed from the string. */
function runtimeDir(code) {
  try {
    /* Two spellings of the same locale data: `getTextInfo()` is the current
       one, `textInfo` is what older runtimes carry. Neither is in the ambient
       type for Locale. */
    const loc = /** @type {any} */ (new Intl.Locale(code).maximize());
    const info = typeof loc.getTextInfo === 'function' ? loc.getTextInfo() : loc.textInfo;
    const d = info && info.direction;
    if (d === 'rtl' || d === 'ltr') return d;
  } catch {
    /* Not a well-formed tag, or a runtime without text info. */
  }
  return null;
}

/* Read only when the runtime carries no text info for the tag. */
const RTL = new Set(['fa', 'ar', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);

/** @param {string} [code] @returns {'ltr'|'rtl'} */
export function dirFor(code) {
  const known = LANGUAGES.find(l => l.code === code);
  if (known && known.dir === 'rtl') return 'rtl';
  if (known) return 'ltr';
  const tag = String(code || '');
  if (!tag) return 'ltr';
  return runtimeDir(tag) === 'rtl' || RTL.has(tag.split('-')[0]) ? 'rtl' : 'ltr';
}

/* Null prototype on all three. The keys are catalog keys and English source
   text, so an inherited member must not answer. */
let base = Object.create(null); /* en.json, flattened: the fallback for every key */
let active = Object.create(null); /* selected locale, flattened; falls back to base per key */
let current = 'en';

/** The locale in use. Widgets are iframes that do not load this module, so the
    dashboard reads it here and passes it on their URL. */
export const currentLang = () => current;

function flatten(obj, prefix, out) {
  for (const k of Object.keys(obj || {})) {
    const key = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

async function fetchCatalog(code) {
  try {
    const r = await fetch(`/i18n/${code}.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    return flatten(await r.json(), '', Object.create(null));
  } catch {
    return null;
  }
}

/* Development locales, reached by ?lang= and absent from the registry.
   What each one does: docs/i18n.md. */
export const PSEUDO_LANG = 'en-XA';
export const KEY_LANG = 'cimode';

const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };

/* Split on placeholders and tags so neither is accented or padded. Renaming a
   placeholder would drop the value out of the sentence. */
const KEEP = /(\{\w+\}|<\/?[a-zA-Z][a-zA-Z0-9]*\s*\/?>)/g;

/** @param {string} value @returns {string} */
export function pseudo(value) {
  const parts = String(value == null ? '' : value).split(KEEP);
  let body = '';
  let letters = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2) {
      body += parts[i];
      continue;
    }
    body += parts[i].replace(/[aeiouAEIOU]/g, c => ACCENTS[c]);
    letters += parts[i].length;
  }
  return `[${body}${'\u00b7'.repeat(Math.ceil(letters * 0.4))}]`;
}

/* The page URL, not a setting: a development locale must not survive a reload
   into someone else's session or be persisted to the config. */
function devLocale() {
  try {
    const v = new URLSearchParams(location.search).get('lang');
    return v === PSEUDO_LANG || v === KEY_LANG ? v : null;
  } catch {
    return null;
  }
}

export async function initI18n(code) {
  code = code || 'en';
  const dev = devLocale();
  base = (await fetchCatalog('en')) || Object.create(null);

  if (dev === KEY_LANG) {
    base = Object.create(null);
    active = base;
    current = 'en';
  } else if (dev === PSEUDO_LANG) {
    const mapped = Object.create(null);
    for (const k of Object.keys(base)) mapped[k] = pseudo(base[k]);
    base = mapped;
    active = mapped;
    current = PSEUDO_LANG;
  } else {
    const loaded = code === 'en' ? base : await fetchCatalog(code);
    active = loaded || base;
    current = loaded && code !== 'en' ? code : 'en';
  }

  const el = document.documentElement;
  el.setAttribute('lang', current);
  el.setAttribute('dir', dirFor(current));
  if (typeof document !== 'undefined' && document.querySelectorAll) translateDOM(document);
  return current;
}

export function getLang() {
  return current;
}

/* Elements opt in by attribute:
     data-i18n="key"       -> textContent
     data-i18n-html="key"  -> markup, limited to the tags i18n-markup.js allows
     data-i18n-ph="key"    -> placeholder
     data-i18n-al="key"    -> aria-label
     data-i18n-title="key" -> title */
function translateDOM(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  /* Only the tag subset in i18n-markup.js, never arbitrary markup. */
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    setHtml(el, i18nMarkup(t(el.getAttribute('data-i18n-html'))));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  root.querySelectorAll('[data-i18n-al]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-al')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}

/* Plural rules are the locale's own. Persian and French both put zero in the
   `one` category, so choosing on `count === 1` is wrong in two of the six
   languages shipped, and wrong in a different way in any language with `few` or
   `many`. */
/** @type {Map<string, Intl.PluralRules>} */
const pluralRules = new Map();

/** The CLDR plural category for a count in a locale.
    @param {string} locale @param {number} count
    @returns {Intl.LDMLPluralRule} */
export function pluralCategory(locale, count) {
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      return count === 1 ? 'one' : 'other';
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/* A counted message is stored as `key_<category>`, one entry per category the
   language uses. `other` is required, so it answers for a category a catalog
   does not carry. */
function lookupPlural(key, count) {
  const category = pluralCategory(current, count);
  for (const map of [active, base]) {
    for (const suffix of [category, 'other']) {
      const v = map[key + '_' + suffix];
      if (v != null) return v;
    }
  }
  return null;
}

/** Translate a key. Pass a numeric `count` for a counted message: it selects
    the plural form and fills `{count}`.
    @param {string} key @param {Record<string, unknown>} [vars]
    @returns {string} */
export function t(key, vars) {
  const count = vars ? vars.count : undefined;
  let s = /** @type {string|null} */ (null);
  if (typeof count === 'number' && Number.isFinite(count)) s = lookupPlural(key, count);
  if (s == null) s = active[key] != null ? active[key] : base[key] != null ? base[key] : key;
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
