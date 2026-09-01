// @ts-check
/* The language picks the words, the locale picks the digits. A number that
   identifies rather than counts is not passed through here. */

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

/* Ten entries, built once per locale from the same cached formatter. Formatting
   each character separately called Intl on every digit of every polled string. */
let digitMap = null;
let digitMapFor = null;

/** The digits of an already-formed string, for text built elsewhere.
    @param {string} text @returns {string} */
export function localiseDigits(text) {
  const loc = locale();
  if (!digitMap || digitMapFor !== loc) {
    digitMap = Array.from({ length: 10 }, (_, d) => formatNumber(d));
    digitMapFor = loc;
  }
  return String(text).replace(/\d/g, d => digitMap[Number(d)]);
}
