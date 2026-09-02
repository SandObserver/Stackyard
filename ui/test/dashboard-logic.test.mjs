/* The config poll compares the server's `_rev`, which it stamps on every write.
   A hand-picked fingerprint of a few fields leaves every other open dashboard
   showing stale content until someone reloads by hand. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  configChanged,
  landingAfterSetup,
  readWallpaperCache,
  writeWallpaperCache,
  restorePage,
} from '../js/dashboard-logic.js';

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

/* ── the wallpaper across a reload ────────────────────────────────────────── */

/* Every admin save reloads every open dashboard. Asking Unsplash for a fresh
   random photo on each reload changes the wallpaper on every screen after an
   unrelated edit. */

const BG = { type: 'unsplash', collection: '1234' };
const T0 = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

test('a reload inside the cache window keeps the same photo', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0), 'https://images/a.jpg');
  assert.equal(readWallpaperCache(stored, BG, T0 + DAY - 1), 'https://images/a.jpg');
});

test('the photo is replaced once the window has passed', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0 + DAY), null);
});

test('changing the background settings picks a new photo', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, { ...BG, collection: '9999' }, T0), null);
  assert.equal(readWallpaperCache(stored, { type: 'color' }, T0), null);
});

/* A clock that moved backwards would otherwise hold one photo indefinitely. */
test('an entry stamped in the future is discarded', () => {
  const stored = writeWallpaperCache('https://images/a.jpg', BG, T0);
  assert.equal(readWallpaperCache(stored, BG, T0 - 1000), null);
});

test('a missing or unusable entry asks for a new photo', () => {
  for (const v of [null, undefined, '', 'not json', '{}', '{"url":"","key":"unsplash|1234","at":0}', '[]']) {
    assert.equal(readWallpaperCache(v, BG, T0), null, `for ${JSON.stringify(v)}`);
  }
  assert.equal(readWallpaperCache(JSON.stringify({ url: 'https://i/a.jpg', key: 'unsplash|1234' }), BG, T0), null);
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
