import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENDS,
  finishParts,
  finishedToday,
  hoursMinutes,
  leftover,
  LEFTOVER_CHANCE,
  lidOpen,
  readerHourCycle,
  startOfDay,
  variations,
} from '../widgets/downloads/belt-logic.js';

const item = (name, state = 'run', eta = 60, progress = 0.3) => ({ name, state, eta, progress, size: 1, speed: 1000 });

test('neighbouring boxes never share a shade or a tape ending', () => {
  const names = Array.from({ length: 40 }, (_, i) => `file-${i}.iso`);
  const v = variations(names.map(n => item(n)));
  for (let i = 1; i < v.length; i++) {
    assert.notEqual(v[i].tone, v[i - 1].tone);
    assert.notEqual(v[i].end, v[i - 1].end);
    assert.ok(ENDS.includes(v[i].end));
  }
});

test('a download keeps its look from one reading to the next', () => {
  const list = [item('a.iso'), item('b.mkv'), item('c.zip')];
  assert.deepEqual(variations(list), variations(list.map(i => ({ ...i, progress: 0.9 }))));
});

test('a flap left ajar shuts once the tape passes the middle, and never on a problem', () => {
  const v = { ajar: true };
  assert.equal(lidOpen(v, item('x', 'run', 5, 0.49)), true);
  assert.equal(lidOpen(v, item('x', 'run', 5, 0.5)), false);
  assert.equal(lidOpen(v, item('x', 'stall', null, 0.1)), false);
  assert.equal(lidOpen({ ajar: false }, item('x')), false);
});

test('finished today counts from local midnight', () => {
  const now = new Date(2026, 9, 24, 14, 30).getTime();
  const midnight = startOfDay(now);
  const r = finishedToday([midnight + 1000, midnight - 1000, now - 60000], now);
  assert.deepEqual(r, { count: 2, last: now - 60000 });
  assert.deepEqual(finishedToday(undefined, now), { count: 0, last: null });
});

test('time left rounds up to whole minutes and never reads zero', () => {
  assert.deepEqual(hoursMinutes(1), { h: 0, m: 1 });
  assert.deepEqual(hoursMinutes(3600 * 1 + 23 * 60 + 5), { h: 1, m: 24 });
});

test('leftovers appear about one load in ten and stay inside the belt', () => {
  let seen = 0;
  const kinds = new Set();
  for (let seed = 0; seed < 5000; seed++) {
    const l = leftover(seed);
    if (!l) continue;
    seen++;
    kinds.add(l.kind);
    assert.ok(l.x >= 0 && l.x < 1);
  }
  assert.ok(Math.abs(seen / 5000 - LEFTOVER_CHANCE) < 0.02, `${seen} in 5000`);
  assert.deepEqual([...kinds].sort(), ['cutter', 'roll']);
  assert.deepEqual(leftover(42), leftover(42));
});

test('a finish time names the day in the interface language and keeps the reader clock', () => {
  const now = new Date(2026, 9, 27, 9, 0).getTime();
  const fri = new Date(2026, 9, 30, 13, 5).getTime();
  const us = readerHourCycle('en-US');
  assert.deepEqual(finishParts(fri, now, 'de', us), { time: 'Fr. 1:05', half: 'pm' });
  assert.deepEqual(finishParts(fri, now, 'en', readerHourCycle('de-DE')), { time: 'Fri 13:05', half: '' });
  assert.match(finishParts(fri, now, 'fa', us).time, /^جمعه /);
});

test('a finish time today shows only the clock, and a week out only the date', () => {
  const now = new Date(2026, 9, 27, 9, 0).getTime();
  const us = readerHourCycle('en-US');
  assert.deepEqual(finishParts(new Date(2026, 9, 27, 9, 30).getTime(), now, 'en', us), { time: '9:30', half: 'am' });
  assert.deepEqual(finishParts(new Date(2026, 10, 9, 9, 30).getTime(), now, 'de', us), { time: '9. Nov.', half: '' });
});
