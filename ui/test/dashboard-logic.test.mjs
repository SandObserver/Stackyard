/* The config poll compares the server's `_rev`, which it stamps on every write.
   A hand-picked fingerprint of a few fields leaves every other open dashboard
   showing stale content until someone reloads by hand. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  configChanged,
  desktopCols,
  desktopPages,
  landingAfterSetup,
  restorePage,
  wheelPager,
  fingerSpeed,
  rubberBand,
  swipeSettle,
  settleMs,
  FLICK_SPEED,
  PAGE_TURN_MS,
} from '../js/dashboard-logic.js';

const SPANS = { app: [1, 1], small: [1, 0], medium: [2, 0], large: [2, 2], xlarge: [2, 3] };
const pagesOf = (kinds, cols, rows) =>
  desktopPages(
    kinds.map((k, i) => ({ k, i })),
    t => SPANS[t.k],
    cols,
    rows,
  ).map(p => p.map(t => t.i));

test('a medium widget that wraps leaves a gap, so the page holds one tile fewer', () => {
  const kinds = [...Array(17).fill('app'), 'medium', ...Array(5).fill('app')];
  const pages = pagesOf(kinds, 6, 4);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].length, 1, 'the last tile would sit in a fifth row');
});

test('tiles that fill every cell stay on one page', () => {
  assert.equal(pagesOf(Array(24).fill('app'), 6, 4).length, 1);
  assert.equal(pagesOf(Array(25).fill('app'), 6, 4).length, 2);
});

test('a tall widget breaks the page when its rows run past the last', () => {
  const pages = pagesOf([...Array(12).fill('app'), 'large'], 6, 3);
  assert.deepEqual(pages[1], [12]);
});

test('a later tile never fills an earlier gap', () => {
  const pages = pagesOf(['app', 'app', 'app', 'medium', 'small'], 4, 2);
  assert.deepEqual(pages, [[0, 1, 2, 3, 4]]);
  assert.equal(pagesOf(['app', 'app', 'app', 'medium', 'medium', 'small'], 4, 2).length, 2);
});

test('a widget taller than the page still gets a page', () => {
  assert.deepEqual(pagesOf(['app', 'xlarge'], 6, 2), [[0], [1]]);
});

test('desktop columns follow the width, tiles keep their size', () => {
  assert.equal(desktopCols(1041), 6, 'the design width holds six');
  assert.equal(desktopCols(1040), 5);
  assert.equal(desktopCols(863), 5);
  assert.equal(desktopCols(862), 4);
  assert.equal(desktopCols(700), 4, 'never fewer than a large widget needs beside another tile');
  assert.equal(desktopCols(3000), 6);
});

const loaded = {
  _rev: 4,
  items: [{ id: 'a1', label: 'Radarr', href: 'https://r', iconUrl: '/i/old.png', color: 'dark', dock: false }],
  settings: {},
};
const withRev = (rev, edit) => {
  const c = JSON.parse(JSON.stringify(loaded));
  c._rev = rev;
  if (edit) edit(c);
  return c;
};

/* ── the revision ─────────────────────────────────────────────────────────── */

test('an unchanged config does not reload', () => {
  assert.equal(configChanged(loaded, withRev(4)), false);
});

test('a bumped revision reloads', () => {
  assert.equal(configChanged(loaded, withRev(5)), true);
});

/* Edits a fingerprint of id, label and href cannot see. */
test('every kind of edit is noticed, not just name and link', () => {
  const edits = {
    icon: c => {
      c.items[0].iconUrl = '/i/new.png';
    },
    colour: c => {
      c.items[0].color = 'blue';
    },
    'dock pin': c => {
      c.items[0].dock = true;
    },
    'hidden flag': c => {
      c.items[0].hidden = true;
    },
    'badge settings': c => {
      c.items[0].badge = { enabled: true, url: 'https://r/api' };
    },
    name: c => {
      c.items[0].label = 'Radarr 4K';
    },
    link: c => {
      c.items[0].href = 'https://new';
    },
  };
  for (const [what, edit] of Object.entries(edits)) {
    assert.equal(configChanged(loaded, withRev(5, edit)), true, `a changed ${what} should reload`);
  }
});

/* A revision that went backwards still means "not what this page holds", which is
   what happens if the config is restored from a backup. */
test('a revision that moved either way reloads', () => {
  assert.equal(configChanged(loaded, withRev(3)), true);
  assert.equal(configChanged({ ...loaded, _rev: 0 }, withRev(0)), false);
});

/* ── the fallback ─────────────────────────────────────────────────────────── */

/* A page held open across an upgrade holds a copy that predates the server
   sending a revision, so the old comparison has to keep working. */
test('with no revision on either side, the fingerprint is used', () => {
  const before = { items: [{ id: 'a1', label: 'A', href: 'https://a' }], settings: {} };
  assert.equal(configChanged(before, { items: [{ id: 'a1', label: 'A', href: 'https://a' }], settings: {} }), false);
  assert.equal(configChanged(before, { items: [{ id: 'a1', label: 'B', href: 'https://a' }], settings: {} }), true);
  assert.equal(configChanged(before, { items: [], settings: {} }), true);
});

test('the fallback is used when only one side has a revision', () => {
  const before = { items: [{ id: 'a1', label: 'A', href: 'https://a' }], settings: {} };
  const after = { _rev: 9, items: [{ id: 'a1', label: 'A', href: 'https://a' }], settings: {} };
  assert.equal(configChanged(before, after), false, 'a new revision alone is not evidence of a change');
});

test('a settings change is noticed by the fallback too', () => {
  const before = { items: [], settings: { language: 'en' } };
  assert.equal(configChanged(before, { items: [], settings: { language: 'de' } }), true);
});

/* ── junk ─────────────────────────────────────────────────────────────────── */

/* A failed or malformed poll must not reload the page under the user. */
test('a missing or unusable response does not reload', () => {
  for (const v of [null, undefined, '', 5, 'nope']) {
    assert.equal(configChanged(loaded, v), false, `for ${JSON.stringify(v)}`);
  }
});

test('a missing loaded config does not throw', () => {
  assert.doesNotThrow(() => configChanged(null, withRev(5)));
  assert.doesNotThrow(() => configChanged(undefined, { items: [], settings: {} }));
});

/* ── the page index across a reload ───────────────────────────────────────── */

test('the page index survives a reload', () => {
  const stored = String(2);
  assert.equal(restorePage(stored, 4), 2);
});

test('a page that no longer exists falls back to the first one', () => {
  assert.equal(restorePage('5', 3), 2);
  assert.equal(restorePage('1', 1), 0);
  assert.equal(restorePage('0', 0), 0);
});

test('junk in storage lands on the first page', () => {
  for (const v of [null, undefined, '', 'two', '-1', '1.5', 'NaN', '{}']) {
    assert.equal(restorePage(v, 4), 0, `for ${JSON.stringify(v)}`);
  }
});

/* Where first-run setup leaves the browser. A fresh install is
   { items: [], settings: {} } and carries no placeholder items on purpose, so
   both paths send the user where items are added rather than onto an empty
   dashboard. */

test('a fresh install lands on Admin', () => {
  assert.equal(landingAfterSetup([]), '/admin');
});

test('an install that already has items stays where it is', () => {
  assert.equal(landingAfterSetup([{ id: 'a' }]), null);
  assert.equal(landingAfterSetup([{ id: 'a' }, { id: 'b' }]), null);
});

/* The caller passes whatever the config response held. A config that failed to
   parse, or one whose items is the wrong shape, must not redirect: the empty
   dashboard is the honest thing to show when the config is not understood. */
test('anything that is not a list leaves the browser alone', () => {
  for (const v of [undefined, null, 0, '', 'items', {}, { length: 0 }]) {
    assert.equal(landingAfterSetup(v), null, `should not redirect on ${JSON.stringify(v)}`);
  }
});

/* A trackpad swipe: about 30 events, 16 ms apart, with momentum fading out. */
const swipe = (step, t0, dx = 1) =>
  Array.from({ length: 30 }, (_, i) => step(dx * Math.max(1, 30 - i), 0, t0 + i * 16)).filter(Boolean);

test('one sideways swipe turns exactly one page', () => {
  const step = wheelPager();
  assert.deepEqual(swipe(step, 0), [1]);
});

test('the swipe direction picks the page', () => {
  assert.deepEqual(swipe(wheelPager(), 0, -1), [-1]);
});

test('a second swipe after a pause turns the next page', () => {
  const step = wheelPager();
  assert.deepEqual([...swipe(step, 0), ...swipe(step, 30 * 16 + 300)], [1, 1]);
});

test('vertical scrolling and a small sideways nudge turn nothing', () => {
  const step = wheelPager();
  assert.equal(step(30, 80, 0), 0, 'mostly vertical');
  assert.equal(step(10, 0, 16), 0);
  assert.equal(step(10, 0, 32), 0);
  assert.equal(step(5, 0, 600), 0, 'the nudge was forgotten after the pause');
});

/* A finger drag on the page strip. Offsets and speeds are physical: negative is
   towards the left of the screen. */
const W = 390;
const settle = (offset, speed, { page = 1, total = 3, dir = 1 } = {}) =>
  swipeSettle({ page, total, offset, speed, width: W, dir });

test('a slow release goes to the nearest page', () => {
  assert.equal(settle(-0.4 * W, 0), 1);
  assert.equal(settle(-0.6 * W, 0), 2);
  assert.equal(settle(0.6 * W, 0), 0);
});

test('a short flick turns the page by speed alone', () => {
  assert.equal(settle(-35, -(FLICK_SPEED + 0.05)), 2);
  assert.equal(settle(35, FLICK_SPEED + 0.05), 0);
  assert.equal(settle(-35, -(FLICK_SPEED - 0.05)), 1, 'too slow to count as a flick');
});

test('a flick back against the drag returns to the page it left', () => {
  assert.equal(settle(-0.7 * W, 0.5), 1);
});

test('a flick turns one page at most', () => {
  assert.equal(settle(-0.2 * W, -5), 2);
});

test('the first and last pages hold', () => {
  assert.equal(settle(80, 2, { page: 0 }), 0);
  assert.equal(settle(-80, -2, { page: 2 }), 2);
});

/* In a right-to-left page the next page is on the left, so a drag to the right
   moves forward. */
test('a right-to-left page mirrors the drag', () => {
  assert.equal(settle(-35, -1, { dir: -1 }), 0);
  assert.equal(settle(35, 1, { dir: -1 }), 2);
  assert.equal(settle(0.6 * W, 0, { dir: -1 }), 2);
});

test('the edge gives less the further it is pulled, and never a whole page', () => {
  const a = rubberBand(50, W),
    b = rubberBand(100, W),
    c = rubberBand(10_000, W);
  assert.ok(a < 50 && b < 100);
  assert.ok(b - a < a, 'the second 50px moves less than the first');
  assert.ok(c < W);
});

test('the finger speed comes from the last moments of the drag', () => {
  const s = fingerSpeed();
  s.add(0, 0);
  s.add(-100, 50);
  s.add(-200, 100);
  assert.equal(s.speed(100), -2);
});

test('a finger that stopped before lifting has no speed', () => {
  const s = fingerSpeed();
  s.add(0, 0);
  s.add(-100, 50);
  assert.equal(s.speed(400), 0);
});

test('the settle starts at the finger speed and never outlasts a page turn', () => {
  assert.equal(settleMs(300, 0), PAGE_TURN_MS);
  assert.equal(settleMs(300, -1), PAGE_TURN_MS, 'moving away from the page');
  assert.equal(settleMs(300, 0.5), PAGE_TURN_MS);
  const fast = settleMs(200, 3);
  assert.ok(fast < PAGE_TURN_MS && fast >= 120, `${fast}`);
  assert.equal(fast, Math.round((0.72 / 0.32) * (200 / 3)));
});
