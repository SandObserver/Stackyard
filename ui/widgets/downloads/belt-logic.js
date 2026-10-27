// @ts-check

/** @typedef {{ name: string, size: number, progress: number, speed: number,
    eta: number|null, state: 'run'|'stall'|'error', reason?: string }} Item */

/** @param {string} s @returns {number} */
function hash(s) {
  let h = 7;
  for (const c of String(s)) h = (h * 31 + (c.codePointAt(0) || 0)) >>> 0;
  return h;
}

const TONE_COUNT = 3;
export const ENDS = Object.freeze(['torn', 'cut', 'angled', 'tab']);
const EXTRA_HEIGHT = Object.freeze([0, 3, 6]);

/** Shade, extra height, tape ending and a lid left ajar per box, picked from the name so a
    download keeps its look. Neighbours never share a shade or an ending.
    @param {Item[]} items @returns {{ tone: number, extra: number, end: string, ajar: boolean }[]} */
export function variations(items) {
  /** @type {{ tone: number, extra: number, end: string, ajar: boolean }[]} */
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    let tone = hash(it.name) % TONE_COUNT;
    if (prev && prev.tone === tone) tone = (tone + 1) % TONE_COUNT;
    let end = hash(it.name + 'e') % ENDS.length;
    if (prev && ENDS[end] === prev.end) end = (end + 1) % ENDS.length;
    const ajar = hash(it.name + 'a') % 3 === 0;
    out.push({ tone, extra: EXTRA_HEIGHT[hash(it.name + 'h') % EXTRA_HEIGHT.length], end: ENDS[end], ajar });
  }
  return out;
}

/** Midnight at the start of `now`'s day, in this runtime's time zone.
    @param {number} now @returns {number} */
export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The 12- or 24-hour clock the reader's own locale uses.
    @param {string} [locale] @returns {string|undefined} */
export function readerHourCycle(locale) {
  try {
    return new Intl.DateTimeFormat(locale || 'en', { hour: 'numeric' }).resolvedOptions().hourCycle;
  } catch {
    return undefined;
  }
}

/** A finish time in the interface language, without its day period. `half` is
    'am' or 'pm' when the clock has one, so the caller names it from its catalog.
    @param {number} ms @param {number} now @param {string} lang @param {string|undefined} hourCycle
    @returns {{ time: string, half: ''|'am'|'pm' }} */
export function finishParts(ms, now, lang, hourCycle) {
  const days = (startOfDay(ms) - startOfDay(now)) / 86400000;
  /** @type {Intl.DateTimeFormatOptions} */
  const opts =
    days < 1
      ? { hour: 'numeric', minute: '2-digit', hourCycle }
      : days < 7
        ? { weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle }
        : { month: 'short', day: 'numeric' };
  const parts = new Intl.DateTimeFormat(lang, opts).formatToParts(ms);
  const time = parts
    .filter(p => p.type !== 'dayPeriod')
    .map(p => p.value)
    .join('')
    .trim();
  if (!parts.some(p => p.type === 'dayPeriod')) return { time, half: '' };
  return { time, half: new Date(ms).getHours() < 12 ? 'am' : 'pm' };
}

/** How many finished today, and the newest.
    @param {number[]} finished epoch ms @param {number} now
    @returns {{ count: number, last: number|null }} */
export function finishedToday(finished, now) {
  const from = startOfDay(now);
  const today = (Array.isArray(finished) ? finished : []).filter(
    t => Number.isFinite(t) && t >= from && t <= now + 60000,
  );
  return { count: today.length, last: today.length ? Math.max(...today) : null };
}

/** Whole hours and minutes, rounded up to the next minute so "0 min" never shows.
    @param {number} seconds @returns {{ h: number, m: number }} */
export function hoursMinutes(seconds) {
  const total = Math.max(1, Math.ceil(seconds / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

/** @param {number} seed @returns {() => number} */
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LEFTOVER_CHANCE = 0.1;
const ROLL_KINDS = Object.freeze(['packing', 'clear', 'blue', 'masking', 'yellow']);
const CUTTER_KINDS = Object.freeze(['yellow', 'orange', 'blue', 'grey']);

/** Something left on an empty belt about one load in ten, or null. `x` is a
    fraction of the free width, so the caller keeps it inside the card.
    @param {number} seed
    @returns {null | { kind: 'roll', tape: string, fill: number, tail: number, at: number, x: number }
      | { kind: 'cutter', colour: string, open: boolean, angle: number, x: number }} */
export function leftover(seed) {
  const r = rng(seed);
  if (r() >= LEFTOVER_CHANCE) return null;
  const x = r();
  if (r() < 0.65) {
    return {
      kind: 'roll',
      tape: ROLL_KINDS[Math.floor(r() * ROLL_KINDS.length)],
      fill: r(),
      tail: r(),
      at: r(),
      x,
    };
  }
  return {
    kind: 'cutter',
    colour: CUTTER_KINDS[Math.floor(r() * CUTTER_KINDS.length)],
    open: r() < 0.6,
    angle: -22 + r() * 30,
    x,
  };
}

/** The untaped flap stays slightly open until the tape reaches the middle of the lid.
    @param {{ ajar: boolean }} v @param {Item} item @returns {boolean} */
export function lidOpen(v, item) {
  return !!v.ajar && item.state === 'run' && item.progress < 0.5;
}
