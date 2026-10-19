import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=w1' };
const { fetchData, readingTime } = await import('../js/widget-toolbox.js');

const reply = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Headers(headers),
  json: async () => body,
});

/* Settles `promise` while advancing mocked timers one second at a time. */
async function drive(t, promise) {
  let done = false;
  const settled = promise.finally(() => {
    done = true;
  });
  settled.catch(() => {});
  for (let i = 0; i < 100 && !done; i++) {
    await new Promise(r => setImmediate(r));
    t.mock.timers.tick(1000);
  }
  return settled;
}

test('a pending reply is fetched again until the data arrives', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const replies = [reply(202, { pending: true }), reply(202, { pending: true }), reply(200, { n: 1 })];
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    return replies.shift();
  };
  assert.deepEqual(await drive(t, fetchData('stats')), { n: 1 });
  assert.equal(urls.length, 3);
  assert.ok(urls.every(u => u === '/api/widget-data/w1?endpoint=stats'));
});

test('a reply that stays pending ends as a timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return reply(202, { pending: true });
  };
  await assert.rejects(drive(t, fetchData()), { kind: 'timeout' });
  assert.ok(calls > 1 && calls < 50, `${calls} fetches`);
});

test('a reply the server held back is dated by its Age', async () => {
  globalThis.fetch = async () => reply(200, { n: 1 }, { Age: '600' });
  const before = Date.now();
  const data = await fetchData('stats');
  assert.ok(Math.abs(readingTime(data) - (before - 600_000)) < 1000);
});

test('a fresh reply is dated now', async () => {
  globalThis.fetch = async () => reply(200, { n: 1 }, { Age: '0' });
  const data = await fetchData('stats');
  assert.ok(Date.now() - readingTime(data) < 1000);
  assert.ok(Date.now() - readingTime({ other: true }) < 1000);
});
