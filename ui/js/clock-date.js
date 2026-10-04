// @ts-check
/* Persian dates use the Shahanshahi year: the Solar Hijri year plus 1180. */

const SHAHANSHAHI_OFFSET = 1180;

/** @param {string} lang @param {'long'|'short'} width
    @returns {(date: Date) => string} */
export function clockDateFormatter(lang, width) {
  /** @type {Intl.DateTimeFormatOptions} */
  const opts = { weekday: width, month: width, day: 'numeric' };
  if (String(lang).split('-')[0] !== 'fa') {
    let fmt;
    try {
      fmt = new Intl.DateTimeFormat(lang, opts);
    } catch {
      fmt = new Intl.DateTimeFormat('en', opts);
    }
    return date => fmt.format(date);
  }
  const names = new Intl.DateTimeFormat(lang, { ...opts, calendar: 'persian' });
  const year = new Intl.DateTimeFormat('en-u-nu-latn', { calendar: 'persian', year: 'numeric' });
  const digits = new Intl.NumberFormat(lang, { useGrouping: false });
  return date => {
    const part = Object.fromEntries(names.formatToParts(date).map(p => [p.type, p.value]));
    const solar = Number.parseInt(year.formatToParts(date).find(p => p.type === 'year')?.value ?? '', 10);
    return `${part.weekday} ${part.day} ${part.month} ${digits.format(solar + SHAHANSHAHI_OFFSET)}`;
  };
}
