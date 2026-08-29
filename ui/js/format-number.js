// @ts-check
/* Digit shape follows the reader's locale, not the interface language.

   Apple's guidance is explicit that numerals take "the correct localized digits
   for the user's locale and preferences", and that neither Arabic nor Persian
   always uses native digits: it depends on the country, and the reader can
   choose. An iPhone in Arabic with a Latin-numeral region shows Latin digits in
   its badges. So the language setting picks the words and the locale picks the
   digits.

   A number that identifies rather than counts, such as a version or a port, is
   not passed through here: those are the same string in every language. */

/** @type {Intl.NumberFormat|null} */
let cached = null;
let cachedFor = '';

/** The reader's locale, or 'en' where the runtime will not say. */
function locale() {
  try {
    return navigator.language || 'en';
  } catch {
    return 'en';
  }
}

/** @param {number} value @param {Intl.NumberFormatOptions} [options]
    @returns {string} */
export function formatNumber(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  const loc = locale();
  if (options) {
    try {
      return new Intl.NumberFormat(loc, options).format(value);
    } catch {
      return String(value);
    }
  }
  /* One formatter for the common case: this runs per badge on every poll. */
  if (!cached || cachedFor !== loc) {
    try {
      cached = new Intl.NumberFormat(loc);
      cachedFor = loc;
    } catch {
      return String(value);
    }
  }
  return cached.format(value);
}

/** The digits of an already-formed string, for text built elsewhere.
    @param {string} text @returns {string} */
export function localiseDigits(text) {
  return String(text).replace(/\d/g, d => formatNumber(Number(d)));
}
