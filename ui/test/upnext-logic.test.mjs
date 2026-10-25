import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOffset, kindClass, localDay, visibleItems } from '../widgets/upnext/upnext-logic.js';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

test('dayOffset counts local calendar days, not 24-hour spans', () => {
  const now = at(2026, 10, 25, 23, 30);
  assert.equal(dayOffset(at(2026, 10, 25, 0, 5), now), 0);
  assert.equal(dayOffset(at(2026, 10, 26, 0, 5), now), 1);
  assert.equal(dayOffset(at(2026, 11, 1, 9), now), 7);
});

test('a timed item stays until it ends; a day item for its whole local day', () => {
  const now = at(2026, 10, 25, 21, 30);
  const items = [
    {
      kind: 'episode',
      title: 'Airing',
      at: at(2026, 10, 25, 21).toISOString(),
      day: '',
      ends: at(2026, 10, 25, 21, 50).toISOString(),
    },
    {
      kind: 'episode',
      title: 'Over',
      at: at(2026, 10, 25, 20).toISOString(),
      day: '',
      ends: at(2026, 10, 25, 20, 50).toISOString(),
    },
    { kind: 'film', title: 'Today', at: null, day: localDay(now), ends: '' },
    { kind: 'album', title: 'Yesterday', at: null, day: localDay(at(2026, 10, 24)), ends: '' },
    { kind: 'film', title: 'Later', at: null, day: '2026-11-02', ends: '' },
    null,
    { title: 3 },
  ];
  assert.deepEqual(
    visibleItems(items, now).map(i => i.title),
    ['Today', 'Airing', 'Later'],
  );
  assert.deepEqual(visibleItems('nope', now), []);
});

test('kindClass maps every kind to a bar colour class', () => {
  assert.equal(kindClass({ kind: 'film' }), 'film');
  assert.equal(kindClass({ kind: 'album' }), 'album');
  assert.equal(kindClass({ kind: 'episode' }), 'episode');
  assert.equal(kindClass({ kind: 'other' }), 'episode');
});

test('rows sort in local time: tonight’s episode comes before tomorrow’s film', () => {
  const now = at(2026, 10, 25, 19);
  const fromServer = [
    { kind: 'film', title: 'Tomorrow', at: null, day: localDay(at(2026, 10, 26)), ends: '' },
    {
      kind: 'episode',
      title: 'Tonight',
      at: at(2026, 10, 25, 21).toISOString(),
      day: '',
      ends: at(2026, 10, 25, 22).toISOString(),
    },
    { kind: 'album', title: 'Today', at: null, day: localDay(now), ends: '' },
  ];
  assert.deepEqual(
    visibleItems(fromServer, now).map(i => i.title),
    ['Today', 'Tonight', 'Tomorrow'],
  );
});
