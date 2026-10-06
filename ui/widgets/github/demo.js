/* Seeded from a fixed constant and built once, so the grid is identical on
   every poll. */

let _cal = null;

function githubCalendar() {
  let seed = 1337,
    total = 0;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const weeks = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(today);
  day.setDate(day.getDate() - 52 * 7 - today.getDay());
  const iso = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  while (day <= today) {
    if (day.getDay() === 0) weeks.push({ contributionDays: [] });
    const r = rnd();
    const count = r < 0.45 ? 0 : Math.floor(rnd() * 14) + 1;
    total += count;
    weeks[weeks.length - 1].contributionDays.push({ contributionCount: count, date: iso(day) });
    day.setDate(day.getDate() + 1);
  }
  return { view: 'contributions', weeks, totalContributions: total };
}

module.exports = function githubDemo() {
  if (!_cal) _cal = githubCalendar();
  return _cal;
};
