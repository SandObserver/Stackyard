// @ts-check
/* Persian dates use the Shahanshahi year: the Solar Hijri year plus 1180. */

const SHAHANSHAHI_OFFSET = 1180;

/** @param {string} lang @param {Intl.DateTimeFormatOptions} opts */
function format(lang, opts) {
  try {
    return new Intl.DateTimeFormat(lang, opts);
  } catch {
    return new Intl.DateTimeFormat('en', opts);
  }
}

/** @param {string} lang @returns {string} */
function canonical(lang) {
  try {
    return Intl.getCanonicalLocales(lang)[0] || 'en';
  } catch {
    return 'en';
  }
}

/** The whole date, and its weekday and day-month parts for a two-line layout.
    @param {string} lang @param {'long'|'short'} width @param {boolean} [withYear]
    @returns {(date: Date) => { full: string, weekday: string, date: string }} */
export function clockDateParts(lang, width, withYear = true) {
  lang = canonical(lang);
  /** @type {Intl.DateTimeFormatOptions} */
  const opts = { weekday: width, month: width, day: 'numeric' };
  if (String(lang).split('-')[0] !== 'fa') {
    const full = format(lang, opts);
    const weekday = format(lang, { weekday: width });
    const dayMonth = format(lang, { month: width, day: 'numeric' });
    return date => ({ full: full.format(date), weekday: weekday.format(date), date: dayMonth.format(date) });
  }
  const names = new Intl.DateTimeFormat(lang, { ...opts, calendar: 'persian' });
  const year = new Intl.DateTimeFormat('en-u-nu-latn', { calendar: 'persian', year: 'numeric' });
  const digits = new Intl.NumberFormat(lang, { useGrouping: false });
  return date => {
    const part = Object.fromEntries(names.formatToParts(date).map(p => [p.type, p.value]));
    let dayMonth = `${part.day} ${part.month}`;
    if (withYear) {
      const solar = Number.parseInt(year.formatToParts(date).find(p => p.type === 'year')?.value ?? '', 10);
      dayMonth += ` ${digits.format(solar + SHAHANSHAHI_OFFSET)}`;
    }
    return { full: `${part.weekday} ${dayMonth}`, weekday: part.weekday, date: dayMonth };
  };
}

/** @param {string} lang @param {'long'|'short'} width
    @returns {(date: Date) => string} */
export function clockDateFormatter(lang, width) {
  const parts = clockDateParts(lang, width);
  return date => parts(date).full;
}

/** Day, month and year, without the weekday.
    @param {string} lang @returns {(date: Date) => string} */
export function clockDateWithYear(lang) {
  lang = canonical(lang);
  if (lang.split('-')[0] === 'fa') {
    const parts = clockDateParts(lang, 'long');
    return date => parts(date).date;
  }
  const f = format(lang, { day: 'numeric', month: 'long', year: 'numeric' });
  return date => f.format(date);
}
