/* Invented contribution calendar for the public demo. Seeded from a fixed
   constant and built once, so the grid is identical on every poll rather than
   reshuffling under the visitor. */

let _cal = null;

function githubCalendar() {
  const COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  let seed = 1337, total = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const weeks = [];
  const start = new Date(); start.setDate(start.getDate() - 52 * 7);
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const r = rnd();
      const count = r < 0.45 ? 0 : Math.floor(rnd() * 14) + 1;
      total += count;
      const lvl = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
      days.push({ contributionCount: count, date: date.toISOString().slice(0, 10), color: COLORS[lvl] });
    }
    weeks.push({ contributionDays: days });
  }
  return { view: 'contributions', weeks, totalContributions: total };
}

module.exports = function githubDemo() {
  if (!_cal) _cal = githubCalendar();
  return _cal;
};
