function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** @param {unknown} slots [unix seconds, count] pairs @param {Date} [now]
    @returns {{ weeks: { contributionDays: { contributionCount: number, date: string }[] }[], totalContributions: number }} */
export function slotWeeks(slots, now = new Date()) {
  const perDay = new Map();
  for (const s of Array.isArray(slots) ? slots : []) {
    const t = Number(Array.isArray(s) ? s[0] : NaN);
    const c = Number(Array.isArray(s) ? s[1] : NaN);
    if (!Number.isFinite(t) || !Number.isFinite(c) || c <= 0) continue;
    const day = isoDay(new Date(t * 1000));
    perDay.set(day, (perDay.get(day) || 0) + c);
  }
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = now.getDate();
  const weeks = [];
  let total = 0;
  /* Noon, not midnight. Midnight does not exist on some daylight-saving days. */
  for (let d = today - 52 * 7 - now.getDay(); d <= today; d++) {
    const day = new Date(y, m, d, 12);
    if (day.getDay() === 0 || !weeks.length) weeks.push({ contributionDays: [] });
    const date = isoDay(day);
    const count = perDay.get(date) || 0;
    total += count;
    weeks[weeks.length - 1].contributionDays.push({ contributionCount: count, date });
  }
  return { weeks, totalContributions: total };
}
