process.env.ALLOW_PRIVATE_IPS = 'true';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');

const { pingUnchecked, fetchUnchecked, _internals } = require('../src/proxy');
const { withDeadline } = _internals;

const BUDGET = 1000;
/* Generous, so a slow machine cannot fail this on timing noise alone. What is
   being tested is that the budget is honoured once rather than twice. */
const TOLERANCE = 900;

const servers = [];
after(() => {
  for (const s of servers) {
    try {
      s.close();
    } catch {}
  }
});

const listen = s =>
  new Promise(r => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () => r(s.address().port));
  });

/* Accepts the connection and then says nothing at all. Asked for over https,
   the TLS handshake never completes, which is the phase the socket timer does
   not cover. */
const stalledPort = () => listen(net.createServer(() => {}));

async function timed(fn) {
  const t0 = Date.now();
  const result = await fn().catch(e => ({ error: e.message }));
  return { result, ms: Date.now() - t0 };
}

/* ── the finding ──────────────────────────────────────────────────────────── */

test('a ping against a stalled handshake stops at its budget', async () => {
  const port = await stalledPort();
  const { result, ms } = await timed(() => pingUnchecked(`https://127.0.0.1:${port}/`, BUDGET));
  assert.equal(result.ok, false);
  assert.match(result.error, /Timed out/);
  assert.ok(ms < BUDGET + TOLERANCE, `took ${ms}ms against a ${BUDGET}ms budget`);
});

test('a fetch against a stalled handshake stops at its budget', async () => {
  const port = await stalledPort();
  const { result, ms } = await timed(() => fetchUnchecked(`https://127.0.0.1:${port}/`, { timeout: BUDGET }));
  assert.match(result.error, /Timed out/);
  assert.ok(ms < BUDGET + TOLERANCE, `took ${ms}ms against a ${BUDGET}ms budget`);
});

/* Both make outbound requests, so both must treat a budget the same way. They
   differing is the bug. */
test('both honour the same budget', async () => {
  const port = await stalledPort();
  const ping = await timed(() => pingUnchecked(`https://127.0.0.1:${port}/`, BUDGET));
  const fetch = await timed(() => fetchUnchecked(`https://127.0.0.1:${port}/`, { timeout: BUDGET }));
  assert.ok(
    Math.abs(ping.ms - fetch.ms) < TOLERANCE,
    `ping took ${ping.ms}ms and fetch took ${fetch.ms}ms for the same budget`,
  );
});

/* A HEAD answered with 405 is retried as GET. A per-request timer would let a
   stalled host spend the budget twice. */
test('a HEAD that is refused does not buy a second budget', async () => {
  const srv = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(405);
      res.end();
    }
    /* GET: never answer. */
  });
  const port = await listen(srv);
  const { result, ms } = await timed(() => pingUnchecked(`http://127.0.0.1:${port}/`, BUDGET));
  assert.equal(result.ok, false);
  assert.ok(ms < BUDGET + TOLERANCE, `405 then stall took ${ms}ms against a ${BUDGET}ms budget`);
});

/* ── the paths that must still work ───────────────────────────────────────── */

test('a healthy server answers immediately', async () => {
  const port = await listen(
    http.createServer((_, res) => {
      res.writeHead(200);
      res.end();
    }),
  );
  const { result, ms } = await timed(() => pingUnchecked(`http://127.0.0.1:${port}/`, BUDGET));
  assert.deepEqual({ ok: result.ok, status: result.status }, { ok: true, status: 200 });
  assert.ok(ms < BUDGET, 'a healthy ping must not wait for the deadline');
});

test('a server that refuses HEAD is still reached with GET', async () => {
  const srv = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end();
  });
  const port = await listen(srv);
  const { result } = await timed(() => pingUnchecked(`http://127.0.0.1:${port}/`, BUDGET));
  assert.deepEqual({ ok: result.ok, status: result.status }, { ok: true, status: 200 });
});

test('a server error is reported rather than treated as healthy', async () => {
  const port = await listen(
    http.createServer((_, res) => {
      res.writeHead(503);
      res.end();
    }),
  );
  const { result } = await timed(() => pingUnchecked(`http://127.0.0.1:${port}/`, BUDGET));
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('a closed port fails fast rather than waiting out the budget', async () => {
  const port = await listen(net.createServer(() => {}));
  servers.pop().close();
  const { result, ms } = await timed(() => pingUnchecked(`http://127.0.0.1:${port}/`, BUDGET));
  assert.equal(result.ok, false);
  assert.ok(ms < BUDGET, `a refused connection took ${ms}ms`);
});

test('a deadline delivers one result when the timer and the response both fire', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delivered = [];
  const dl = withDeadline(BUDGET, () => dl.settle(v => delivered.push(v), 'timeout'));
  t.mock.timers.tick(BUDGET);
  dl.settle(v => delivered.push(v), 'response');
  dl.settle(v => delivered.push(v), 'response again');
  assert.deepEqual(delivered, ['timeout']);
  assert.equal(dl.expired(), true);
});

test('a settled deadline never expires', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let expired = false;
  const dl = withDeadline(BUDGET, () => {
    expired = true;
  });
  dl.settle(() => {});
  t.mock.timers.tick(BUDGET * 2);
  assert.equal(expired, false);
});
