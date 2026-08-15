import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWakeLock } from '../js/wake-lock.js';

function fakeDoc(visibilityState = 'visible') {
  const listeners = [];
  return {
    visibilityState,
    addEventListener: (type, fn) => type === 'visibilitychange' && listeners.push(fn),
    removeEventListener: (type, fn) => {
      const i = listeners.indexOf(fn);
      if (type === 'visibilitychange' && i >= 0) listeners.splice(i, 1);
    },
    fire() {
      for (const fn of [...listeners]) fn();
    },
    count: () => listeners.length,
  };
}

function fakeNav({ fail = false } = {}) {
  const sentinels = [];
  return {
    sentinels,
    requests: 0,
    wakeLock: {
      request(type) {
        this._owner.requests++;
        assert.equal(type, 'screen');
        if (fail) return Promise.reject(new Error('refused'));
        const s = {
          released: false,
          _onRelease: null,
          addEventListener: (t, fn) => t === 'release' && (s._onRelease = fn),
          release: () => {
            s.released = true;
            s._onRelease?.();
            return Promise.resolve();
          },
        };
        sentinels.push(s);
        return Promise.resolve(s);
      },
    },
  };
}

function nav(opts) {
  const n = fakeNav(opts);
  n.wakeLock._owner = n;
  return n;
}

const settle = () => new Promise(r => setTimeout(r, 0));

test('a lock is taken on start', async () => {
  const n = nav();
  const lock = startWakeLock({ nav: n, doc: fakeDoc() });
  await settle();
  assert.equal(n.requests, 1);
  assert.ok(lock.held());
});

test('a lock released while hidden is taken again when the document returns', async () => {
  const n = nav();
  const d = fakeDoc();
  const lock = startWakeLock({ nav: n, doc: d });
  await settle();
  n.sentinels[0]._onRelease();
  d.visibilityState = 'hidden';
  d.fire();
  await settle();
  assert.equal(n.requests, 1, 'a hidden document cannot hold a lock');
  d.visibilityState = 'visible';
  d.fire();
  await settle();
  assert.equal(n.requests, 2);
  assert.ok(lock.held());
});

test('a browser without the API is left alone', async () => {
  const lock = startWakeLock({ nav: {}, doc: fakeDoc() });
  await settle();
  assert.equal(lock.supported(), false);
  assert.equal(lock.held(), false);
});

test('a refused request does not throw and does not report a lock', async () => {
  const lock = startWakeLock({ nav: nav({ fail: true }), doc: fakeDoc() });
  await settle();
  assert.equal(lock.held(), false);
});

test('stop releases the lock and detaches the listener', async () => {
  const n = nav();
  const d = fakeDoc();
  const lock = startWakeLock({ nav: n, doc: d });
  await settle();
  lock.stop();
  await settle();
  assert.equal(n.sentinels[0].released, true);
  assert.equal(d.count(), 0);
  d.fire();
  await settle();
  assert.equal(n.requests, 1);
});

test('a lock arriving after stop is released, not kept', async () => {
  const n = nav();
  const lock = startWakeLock({ nav: n, doc: fakeDoc() });
  lock.stop();
  await settle();
  assert.equal(lock.held(), false);
  assert.equal(n.sentinels[0].released, true);
});
