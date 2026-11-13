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

const BIDI_MARKS = /[\u200e\u200f\u061c]/g;

/** @type {{ group: string, decimal: string, minus: string } | null} */
let symbols = null;
let symbolsFor = '';

/** The group, decimal and minus signs formatNumber writes, without bidi marks.
    @returns {{ group: string, decimal: string, minus: string }} */
export function numberSymbols() {
  const loc = locale();
  const key = `${loc}|${language}`;
  if (!symbols || symbolsFor !== key) {
    const parts = { group: '', decimal: '.', minus: '-' };
    try {
      const nu = numberingSystem(loc);
      const fmt = new Intl.NumberFormat(loc, nu ? { numberingSystem: nu } : undefined);
      for (const part of fmt.formatToParts(-12345.6)) {
        const value = part.value.replace(BIDI_MARKS, '');
        if (part.type === 'group') parts.group = value;
        else if (part.type === 'decimal') parts.decimal = value;
        else if (part.type === 'minusSign') parts.minus = value;
      }
    } catch {}
    symbols = parts;
    symbolsFor = key;
  }
  return symbols;
}

/** Join items the way the interface language writes a list.
    @param {string[]} items @param {'conjunction'|'plain'} [type]
    @returns {string} */
export function formatList(items, type = 'conjunction') {
  const list = items.map(String);
  try {
    return new Intl.ListFormat(language || 'en', {
      type: 'conjunction',
      style: type === 'plain' ? 'narrow' : 'long',
    }).format(list);
  } catch {
    return list.join(', ');
  }
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

/** @typedef {'byte'|'kilobyte'|'megabyte'|'gigabyte'|'terabyte'|'petabyte'} ByteUnit */
/** @typedef {{ min?: ByteUnit, max?: ByteUnit, digits?: (value: number, unit: ByteUnit) => number, fixed?: boolean }} ByteOptions */

/** @type {ByteUnit[]} */
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'];

/** @param {number} _value @param {ByteUnit} unit */
const byteDigits = (_value, unit) => (unit === 'byte' || unit === 'kilobyte' ? 0 : 1);

/** The unit and figure for a byte count, in decimal steps of 1000.
    @param {number} bytes @param {ByteOptions} [options]
    @returns {{ value: number, unit: ByteUnit, digits: number }} */
export function byteScale(bytes, options = {}) {
  const lo = Math.max(0, BYTE_UNITS.indexOf(options.min ?? 'byte'));
  const top = BYTE_UNITS.indexOf(options.max ?? 'petabyte');
  const hi = top < 0 ? BYTE_UNITS.length - 1 : Math.max(lo, top);
  const digitsFor = options.digits ?? byteDigits;
  const at = step => {
    const value = bytes / 1000 ** step;
    return { value, unit: BYTE_UNITS[step], digits: digitsFor(Math.abs(value), BYTE_UNITS[step]) };
  };
  let k = lo;
  while (k < hi && Math.abs(bytes) >= 1000 ** (k + 1)) k++;
  let scaled = at(k);
  if (k < hi && Math.abs(Number(scaled.value.toFixed(scaled.digits))) >= 1000) scaled = at(k + 1);
  return scaled;
}

/** @param {number} n @param {ByteOptions} options @param {string} per */
function formatScaled(n, options, per) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  const { value, unit, digits } = byteScale(n, options);
  return formatNumber(value, {
    style: 'unit',
    unit: unit + per,
    maximumFractionDigits: digits,
    minimumFractionDigits: options.fixed ? digits : 0,
  });
}

/** A size such as "1.5 GB", in the reader's digits and unit words.
    @param {number} bytes @param {ByteOptions} [options] @returns {string} */
export function formatBytes(bytes, options = {}) {
  return formatScaled(bytes, options, '');
}

/** A transfer rate such as "1.5 MB/s", in the reader's digits and unit words.
    @param {number} bytesPerSecond @param {ByteOptions} [options] @returns {string} */
export function formatByteRate(bytesPerSecond, options = {}) {
  return formatScaled(bytesPerSecond, options, '-per-second');
}
