import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { slotWeeks } from '../js/contribution-calendar.js';

const TZ = process.env.TZ;
after(() => {
  if (TZ === undefined) delete process.env.TZ;
  else process.env.TZ = TZ;
});

const at = (y, m, d, h) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);
const days = cal => cal.weeks.flatMap(w => w.contributionDays);

test('slots are summed per local day, and the grid runs Sunday-first weeks up to today', () => {
  process.env.TZ = 'UTC';
  const now = new Date(2026, 9, 24, 15);
  const cal = slotWeeks(
    [
      [at(2026, 10, 24, 9), 2],
      [at(2026, 10, 24, 10), 3],
      [at(2026, 10, 21, 12), 4],
      [at(2025, 1, 1, 12), 9],
      [at(2026, 10, 24, 11), 0],
      ['x', 1],
      null,
    ],
    now,
  );
  const all = days(cal);
  assert.equal(all.at(-1).date, '2026-10-24');
  assert.equal(all.at(-1).contributionCount, 5);
  assert.equal(all.find(d => d.date === '2026-10-21').contributionCount, 4);
  assert.equal(cal.totalContributions, 9);
  assert.equal(cal.weeks.length, 53);
  assert.ok(cal.weeks.every(w => new Date(`${w.contributionDays[0].date}T00:00:00Z`).getUTCDay() === 0));
});

test("a slot counts on the viewer's day, not the server's", () => {
  const t = Date.UTC(2026, 9, 24, 1) / 1000;
  process.env.TZ = 'America/Los_Angeles';
  const west = days(slotWeeks([[t, 1]], new Date(2026, 9, 24, 12)));
  assert.equal(west.find(d => d.contributionCount).date, '2026-10-23');
  process.env.TZ = 'UTC';
  const utc = days(slotWeeks([[t, 1]], new Date(2026, 9, 24, 12)));
  assert.equal(utc.find(d => d.contributionCount).date, '2026-10-24');
});

for (const zone of ['America/Santiago', 'Asia/Beirut', 'America/Havana']) {
  test(`today stays on the grid in ${zone}, where daylight saving starts at midnight`, () => {
    process.env.TZ = zone;
    const now = new Date();
    const cal = slotWeeks([[Math.floor(now.getTime() / 1000), 4]], now);
    const all = days(cal);
    assert.equal(all.length, 52 * 7 + now.getDay() + 1);
    assert.equal(new Set(all.map(d => d.date)).size, all.length);
    assert.equal(all.at(-1).contributionCount, 4);
    assert.equal(cal.totalContributions, 4);
  });
}
