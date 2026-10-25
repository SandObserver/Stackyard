// @ts-check

/** @typedef {{ kind: string, title: string, at: string|null, day: string, ends: string }} Item */

/** A local calendar day as YYYY-MM-DD. @param {Date} d @returns {string} */
export function localDay(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole local days from `now` to `d`: 0 today, 1 tomorrow.
    @param {Date} d @param {Date} now @returns {number} */
export function dayOffset(d, now) {
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

/** Items still to come in the reader's own time zone, soonest first. A timed
    item goes once it ends; a day item stays for its whole local day and sorts at
    its local start. The server sorts day items at UTC midnight.
    @param {unknown} items @param {Date} now @returns {Item[]} */
export function visibleItems(items, now) {
  if (!Array.isArray(items)) return [];
  const today = localDay(now);
  const when = (/** @type {Item} */ i) => (i.at ? Date.parse(i.at) : new Date(i.day + 'T00:00:00').getTime());
  const kept = items.filter(i => {
    if (!i || typeof i !== 'object' || typeof i.title !== 'string') return false;
    if (typeof i.at === 'string' && i.at) {
      const ends = Date.parse(i.ends);
      return Number.isFinite(ends) ? ends > now.getTime() : Date.parse(i.at) > now.getTime();
    }
    return typeof i.day === 'string' && i.day >= today;
  });
  return kept.sort((a, b) => when(a) - when(b));
}

/** @param {Item} i @returns {string} */
export function kindClass(i) {
  return i.kind === 'film' || i.kind === 'album' ? i.kind : 'episode';
}
