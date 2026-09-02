/* One module answers whether to show the mobile layout, for the dashboard and
   for Admin. Deciding once at load from a stored innerWidth keeps a desktop
   window dragged narrower than the breakpoint on the desktop layout until it is
   reloaded. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMobileLayout, onLayoutChange, MOBILE_QUERY } from '../js/layout.js';

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/** A matchMedia whose answers can be changed, with listeners that fire. */
function stubMedia({ narrow = false, portrait = false, ua = DESKTOP } = {}) {
  const state = { narrow, portrait };
  const lists = new Map();
  const listFor = query => {
    const isWidth = query === MOBILE_QUERY;
    if (!lists.has(query)) {
      const listeners = new Set();
      lists.set(query, {
        get matches() {
          return isWidth ? state.narrow : state.portrait;
        },
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
        listeners,
      });
    }
    return lists.get(query);
  };
  globalThis.window = { matchMedia: listFor };
  /* Node's own navigator is getter-only. */
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  return {
    set(next) {
      Object.assign(state, next);
      for (const list of lists.values()) for (const fn of list.listeners) fn();
    },
    listenerCount: () => [...lists.values()].reduce((n, l) => n + l.listeners.size, 0),
  };
}

test('a narrow window is the mobile layout, whatever the device', () => {
  stubMedia({ narrow: true, ua: DESKTOP });
  assert.equal(isMobileLayout(), true);
});

test('a wide desktop window is not', () => {
  stubMedia({ narrow: false, ua: DESKTOP });
  assert.equal(isMobileLayout(), false);
});

/* Some phones report a CSS viewport wider than the breakpoint. Held upright,
   that is still a phone. */
test('a phone in portrait is mobile even when it reports a wide viewport', () => {
  stubMedia({ narrow: false, portrait: true, ua: PHONE });
  assert.equal(isMobileLayout(), true);
});

test('the same phone sideways gets the layout it has room for', () => {
  stubMedia({ narrow: false, portrait: false, ua: PHONE });
  assert.equal(isMobileLayout(), false);
});

/* A desktop window is portrait whenever it is taller than it is wide, which is
   not a reason to give it a phone layout. */
test('a tall desktop window is not treated as a phone', () => {
  stubMedia({ narrow: false, portrait: true, ua: DESKTOP });
  assert.equal(isMobileLayout(), false);
});

test('crossing the breakpoint reports the change, once', () => {
  const media = stubMedia({ narrow: false });
  const seen = [];
  onLayoutChange(m => seen.push(m));

  media.set({ narrow: true });
  media.set({ narrow: true });
  assert.deepEqual(seen, [true], 'a resize that changes nothing must not rebuild the page');

  media.set({ narrow: false });
  assert.deepEqual(seen, [true, false]);
});

test('a rotation that does not change the answer reports nothing', () => {
  const media = stubMedia({ narrow: true, portrait: true, ua: PHONE });
  const seen = [];
  onLayoutChange(m => seen.push(m));
  media.set({ portrait: false });
  assert.deepEqual(seen, [], 'still narrow, so still the mobile layout');
});

/* The page builds its layout, then registers. A window resized in between must
   not be read as the baseline, or the listener believes the new size is already
   on screen and never reports it. */
test('a change between building and registering is reported at once', () => {
  const media = stubMedia({ narrow: true });
  const seen = [];
  onLayoutChange(m => seen.push(m), false);
  assert.deepEqual(seen, [true], 'the caller shows the desktop layout but the window is narrow');
  media.set({ narrow: false });
  assert.deepEqual(seen, [true, false]);
});

test('a baseline that already matches reports nothing', () => {
  stubMedia({ narrow: true });
  const seen = [];
  onLayoutChange(m => seen.push(m), true);
  assert.deepEqual(seen, [], 'nothing changed, so nothing should rebuild');
});

test('the returned function detaches every listener', () => {
  const media = stubMedia({ narrow: false });
  const stop = onLayoutChange(() => {});
  assert.ok(media.listenerCount() > 0);
  stop();
  assert.equal(media.listenerCount(), 0);
});

/* Rendering must not depend on matchMedia existing. */
test('a browser without matchMedia gets the desktop layout instead of an error', () => {
  globalThis.window = {};
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: DESKTOP }, configurable: true, writable: true });
  assert.equal(isMobileLayout(), false);
  assert.doesNotThrow(() => onLayoutChange(() => {})());
});
