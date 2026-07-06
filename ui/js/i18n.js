/* Minimal i18n runtime. Catalogs are plain JSON at /i18n/<code>.json; English
   is the source and the fallback. No build step and no runtime dependency — the
   app only ever fetches JSON. Adding a language is two steps: add an entry to
   LANGUAGES below and drop in ui/i18n/<code>.json. Translations can be authored
   by hand or by any external tool; nothing here depends on one. */

/* Languages offered in the admin selector. `dir` flips the document for
   right-to-left scripts. Persian ships once ui/i18n/fa.json and the RTL styling
   pass land (kept commented so the selector only lists locales that render). */
export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  // { code: 'fa', name: 'فارسی', dir: 'rtl' },
];

/* Fallback direction lookup for any RTL locale not explicitly listed above. */
const RTL = new Set(['fa', 'ar', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);

export function dirFor(code) {
  const known = LANGUAGES.find(l => l.code === code);
  if (known && known.dir) return known.dir;
  return RTL.has(String(code || '').split('-')[0]) ? 'rtl' : 'ltr';
}

let base = {};    /* en.json, flattened — the fallback for every key */
let active = {};  /* selected locale, flattened; falls back to base per key */
let current = 'en';

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
    return flatten(await r.json(), '', {});
  } catch { return null; }
}

/* Load English (fallback) plus the requested locale, then set <html lang/dir>.
   Falls back to English if the requested catalog is missing or fails to load. */
export async function initI18n(code) {
  code = code || 'en';
  base = (await fetchCatalog('en')) || {};
  const loaded = code === 'en' ? base : await fetchCatalog(code);
  active = loaded || base;
  current = (loaded && code !== 'en') ? code : 'en';
  const el = document.documentElement;
  el.setAttribute('lang', current);
  el.setAttribute('dir', dirFor(current));
  if (typeof document !== 'undefined' && document.querySelectorAll) translateDOM(document);
  return current;
}

export function getLang() { return current; }

/* Translate static markup in place. Elements opt in with attributes:
     data-i18n="key"       -> sets textContent
     data-i18n-ph="key"    -> sets the placeholder attribute
     data-i18n-al="key"    -> sets the aria-label attribute
   Safe to re-run; call it after rendering dynamically-inserted markup too. */
export function translateDOM(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  root.querySelectorAll('[data-i18n-al]').forEach(el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-al'))); });
}

/* Translate a dotted key, falling back to English then to the key itself.
   Interpolates {name} placeholders from the optional vars object. */
export function t(key, vars) {
  let s = (active[key] != null) ? active[key] : (base[key] != null ? base[key] : key);
  if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}
