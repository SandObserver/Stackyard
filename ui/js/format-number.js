// @ts-check
/* The interface language picks the digits, the reader's locale picks the
   separators. A locale that names its own numbering system wins. A number that
   identifies rather than counts is not passed through here. */

/** @type {Intl.NumberFormat|null} */
let cached = null;
let cachedFor = '';
let language = '';

/** @param {string} code */
export function setNumberLanguage(code) {
  language = String(code || '');
}

/** The reader's locale, or 'en' where the runtime will not say. */
function locale() {
  try {
    return navigator.language || 'en';
  } catch {
    return 'en';
  }
}

/** @param {string} loc @returns {string|undefined} */
function numberingSystem(loc) {
  if (!language) return undefined;
  try {
    if (new Intl.Locale(loc).numberingSystem) return undefined;
    return new Intl.NumberFormat(language).resolvedOptions().numberingSystem;
  } catch {
    return undefined;
  }
}

/** @param {number} value @param {Intl.NumberFormatOptions} [options]
    @returns {string} */
export function formatNumber(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const loc = locale();
  const nu = numberingSystem(loc);
  if (options) {
    try {
      return new Intl.NumberFormat(loc, nu ? { numberingSystem: nu, ...options } : options).format(value);
    } catch {
      return String(value);
    }
  }
  /* One formatter for the common case: this runs per badge on every poll. */
  const key = `${loc}|${nu || ''}`;
  if (!cached || cachedFor !== key) {
    try {
      cached = new Intl.NumberFormat(loc, nu ? { numberingSystem: nu } : undefined);
      cachedFor = key;
    } catch {
      return String(value);
    }
  }
  return cached.format(value);
}

/* Ten entries, built once per locale from the same cached formatter. Formatting
   each character separately called Intl on every digit of every polled string. */
let digitMap = null;
let digitMapFor = null;

/** The digits of an already-formed string, for text built elsewhere.
    @param {string} text @returns {string} */
export function localiseDigits(text) {
  const key = `${locale()}|${language}`;
  if (!digitMap || digitMapFor !== key) {
    digitMap = Array.from({ length: 10 }, (_, d) => formatNumber(d));
    digitMapFor = key;
  }
  return String(text).replace(/\d/g, d => digitMap[Number(d)]);
}
