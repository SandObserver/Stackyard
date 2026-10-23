const { test } = require('node:test');
const assert = require('node:assert/strict');
const { limitPerOrigin } = require('../src/origin-limit');

function gatedFetch() {
  const open = new Map();
  const calls = [];
  let peak = 0;
  const active = () => [...open.values()].filter(v => v.pending).length;
  const fetch = url => {
    const p = new Promise((resolve, reject) => {
      const entry = { pending: true, resolve, reject };
      open.set(calls.length, entry);
    });
    calls.push(url);
    peak = Math.max(peak, active());
    return p;
  };
  const settle = (id, ok = true) => {
    const e = open.get(id);
    e.pending = false;
    if (ok) e.resolve({ status: 200, url: calls[id] });
    else e.reject(new Error('down'));
  };
  return { fetch, calls, settle, peak: () => peak };
}

const tick = () => new Promise(r => setImmediate(r));

test('no more than the limit runs at once for one origin, the rest in order', async () => {
  const g = gatedFetch();
  const f = limitPerOrigin(g.fetch, 2);
  const all = ['a', 'b', 'c', 'd'].map(p => f(`http://pbs:8007/${p}`));
  await tick();
  assert.deepEqual(g.calls, ['http://pbs:8007/a', 'http://pbs:8007/b']);
  g.settle(0);
  await tick();
  assert.equal(g.calls[2], 'http://pbs:8007/c');
  g.settle(1, false);
  await tick();
  assert.equal(g.calls[3], 'http://pbs:8007/d');
  g.settle(2);
  g.settle(3);
  const out = await Promise.allSettled(all);
  assert.deepEqual(
    out.map(o => o.status),
    ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
  );
  assert.equal(g.peak(), 2);
});

test('each origin has its own limit', async () => {
  const g = gatedFetch();
  const f = limitPerOrigin(g.fetch, 1);
  f('http://a:1/x');
  f('http://a:2/x');
  f('https://a:1/x');
  f('http://a:1/y');
  await tick();
  assert.deepEqual(g.calls, ['http://a:1/x', 'http://a:2/x', 'https://a:1/x']);
});

test('a fetcher that throws at once frees its place', async () => {
  let n = 0;
  const f = limitPerOrigin(url => {
    if (n++ === 0) throw new Error('bad url');
    return Promise.resolve(url);
  }, 1);
  await assert.rejects(f('http://x/1'), /bad url/);
  assert.equal(await f('http://x/2'), 'http://x/2');
});

test('an address that is not a URL still goes through', async () => {
  const f = limitPerOrigin(async url => url, 1);
  assert.equal(await f('not a url'), 'not a url');
});
