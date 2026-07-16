/* The outbound boundary's contract: fetchChecked guards, fetchUnchecked does not,
   and neither lets a caller separate the check from the connection.

   Point config at a nonexistent path so loadConfig falls back to an empty config
   (no host IP, no port map) and ALLOW_PRIVATE_IPS stays off, so 127.0.0.1 is a
   private address the guard is expected to block. */
process.env.CONFIG_PATH = '/tmp/stackyard-boundary-test-nonexistent.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchChecked, fetchUnchecked, pingChecked, pingUnchecked, SsrfBlockedError } = require('../src/proxy');

function server(t, handler = (_, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }) {
  return new Promise(resolve => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => {
      t.after(() => s.close());
      resolve(s.address().port);
    });
  });
}

/* ── fetchChecked: guarded ──────────────────────────────────────────────── */

test('fetchChecked blocks a private address', async (t) => {
  const port = await server(t);
  await assert.rejects(
    () => fetchChecked(`http://127.0.0.1:${port}/x`, { timeout: 3000 }),
    (e) => e instanceof SsrfBlockedError && e.status === 403,
  );
});

test('fetchChecked blocks a private address even with a path and query', async (t) => {
  const port = await server(t);
  await assert.rejects(
    () => fetchChecked(`http://127.0.0.1:${port}/api/v2.0/pool?a=b`, { timeout: 3000 }),
    (e) => e instanceof SsrfBlockedError,
  );
});

test('SsrfBlockedError carries the status a route should return', async () => {
  await assert.rejects(
    () => fetchChecked('http://192.168.1.99:8080/', { timeout: 3000 }),
    (e) => e.status === 403 && /private address/.test(e.message),
  );
});

test('fetchChecked rejects an unresolvable host rather than connecting', async () => {
  await assert.rejects(
    () => fetchChecked('http://nx.invalid/', { timeout: 3000 }),
    (e) => e instanceof SsrfBlockedError,
  );
});

/* ── fetchUnchecked: not guarded, by design ─────────────────────────────── */

test('fetchUnchecked reaches a private address', async (t) => {
  /* The whole point of the split: config-supplied urls are normal homelab
     targets on private IPs, and must not be blocked. */
  const port = await server(t);
  const r = await fetchUnchecked(`http://127.0.0.1:${port}/x`, { timeout: 3000 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
});

/* ── ping ───────────────────────────────────────────────────────────────── */

test('pingChecked blocks a private address', async (t) => {
  const port = await server(t);
  await assert.rejects(
    () => pingChecked(`http://127.0.0.1:${port}/`, 3000, false),
    (e) => e instanceof SsrfBlockedError && e.status === 403,
  );
});

test('pingUnchecked reaches a private address', async (t) => {
  const port = await server(t);
  const r = await pingUnchecked(`http://127.0.0.1:${port}/`, 3000, false);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
});

/* ── the invariant the refactor exists to protect ──────────────────────── */

test('the guard sees the url that is actually connected to', async (t) => {
  /* fetchChecked resolves and pins internally, so a caller cannot hand it one
     url to check and a different one to fetch. If a redirect-style host swap or
     a new rewrite step is ever introduced upstream of the connection, it must
     sit above the guard. This test fails loudly if the connection lands
     somewhere the guard would have rejected. */
  let hit = false;
  const port = await server(t, (_, res) => { hit = true; res.writeHead(200); res.end('{}'); });
  await assert.rejects(() => fetchChecked(`http://127.0.0.1:${port}/`, { timeout: 3000 }));
  assert.equal(hit, false, 'blocked request must never reach the socket');
});
