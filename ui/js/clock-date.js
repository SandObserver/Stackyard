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
    A blank timeZone is the browser's.
    @param {string} lang @param {'long'|'short'} width @param {boolean} [withYear] @param {string} [timeZone]
    @returns {(date: Date) => { full: string, weekday: string, date: string }} */
export function clockDateParts(lang, width, withYear = true, timeZone = '') {
  lang = canonical(lang);
  const zone = timeZone || undefined;
  /** @type {Intl.DateTimeFormatOptions} */
  const opts = { weekday: width, month: width, day: 'numeric', timeZone: zone };
  if (String(lang).split('-')[0] !== 'fa') {
    const full = format(lang, opts);
    const weekday = format(lang, { weekday: width, timeZone: zone });
    const dayMonth = format(lang, { month: width, day: 'numeric', timeZone: zone });
    return date => ({ full: full.format(date), weekday: weekday.format(date), date: dayMonth.format(date) });
  }
  const names = new Intl.DateTimeFormat(lang, { ...opts, calendar: 'persian' });
  const year = new Intl.DateTimeFormat('en-u-nu-latn', { calendar: 'persian', year: 'numeric', timeZone: zone });
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

/** @param {string} lang @param {'long'|'short'} width @param {string} [timeZone]
    @returns {(date: Date) => string} */
export function clockDateFormatter(lang, width, timeZone = '') {
  const parts = clockDateParts(lang, width, true, timeZone);
  return date => parts(date).full;
}

/** Day, month and year, without the weekday.
    @param {string} lang @param {string} [timeZone] @returns {(date: Date) => string} */
export function clockDateWithYear(lang, timeZone = '') {
  lang = canonical(lang);
  if (lang.split('-')[0] === 'fa') {
    const parts = clockDateParts(lang, 'long', true, timeZone);
    return date => parts(date).date;
  }
  const f = format(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone || undefined });
  return date => f.format(date);
}

/** The hour, minute and second on a zone's wall clock. A blank zone is the
    browser's. Throws on an unknown zone.
    @param {string} [timeZone] @returns {(date: Date) => { hours: number, minutes: number, seconds: number }} */
export function zoneTime(timeZone = '') {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  return date => {
    const part = Object.fromEntries(f.formatToParts(date).map(p => [p.type, Number(p.value)]));
    return { hours: part.hour % 24, minutes: part.minute, seconds: part.second };
  };
}

/** False for a zone this browser does not know. Every zone formatter throws on
    one, so a clock must check before it draws. A blank zone is the browser's.
    @param {string} [timeZone] @returns {boolean} */
export function zoneOk(timeZone = '') {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined }).resolvedOptions();
    return true;
  } catch {
    return false;
  }
}

/** @param {Date} [date] @returns {number} */
export function msToNextMinute(date = new Date()) {
  return 60000 - (((date.getTime() % 60000) + 60000) % 60000);
}

/** @param {string} lang @returns {(n: number) => string} */
export function twoDigits(lang) {
  const opts = { minimumIntegerDigits: 2, useGrouping: false };
  let f;
  try {
    f = new Intl.NumberFormat(lang, opts);
  } catch {
    f = new Intl.NumberFormat('en', opts);
  }
  return n => f.format(n);
}

/** The zone and date setting from the widget config. A failed read gives the
    defaults.
    @param {() => Promise<any>} getConfig @returns {Promise<{ timeZone: string, showDate: boolean }>} */
export async function clockSettings(getConfig) {
  const reply = await getConfig().catch(() => null);
  const wc = reply?.widgetConfig || {};
  return { timeZone: wc.clockTimezone || '', showDate: wc.clockShowDate !== false };
}

/** @param {{ loadStrings(): Promise<void>, wt(key: string, fallback: string): string,
      errorState(opts: object): { empty(text: string): void } }} toolbox
    @param {HTMLElement} root */
export async function showUnknownZone(toolbox, root) {
  await toolbox.loadStrings();
  const line = toolbox.wt('ui.unknownZone', 'Unknown timezone');
  toolbox.errorState({ root, place: 'center' }).empty(line);
  root.setAttribute('aria-label', line);
}
