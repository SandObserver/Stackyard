process.env.ALLOW_PRIVATE_IPS = 'true';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns').promises;

const { fetchChecked, fetchUnchecked, pingChecked, pingUnchecked } = require('../src/proxy');
const { errorBody } = require('../src/api-error');

const BUDGET = 1000;
const TOLERANCE = 900;

const servers = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections?.();
    s.close();
  }
});

const listen = s =>
  new Promise(r => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () => r(s.address().port));
  });

function streamingServer(status, headers = {}) {
  let onClose;
  const closed = new Promise(r => {
    onClose = r;
  });
  const srv = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    res.writeHead(status, headers);
    const timer = setInterval(() => res.write('x'.repeat(1024)), 10);
    res.on('close', () => {
      clearInterval(timer);
      onClose();
    });
  });
  return { srv, closed };
}

const within = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} not within ${ms} ms`)), ms))]);

test('a ping closes a GET body that never ends', { timeout: 5000 }, async () => {
  const { srv, closed } = streamingServer(200);
  const port = await listen(srv);
  const r = await pingUnchecked(`http://127.0.0.1:${port}/`, BUDGET);
  assert.deepEqual({ ok: r.ok, status: r.status }, { ok: true, status: 200 });
  await within(closed, 1000, 'connection close');
});

test('a refused redirect closes a body that never ends', { timeout: 5000 }, async () => {
  const { srv, closed } = streamingServer(302, { Location: '/elsewhere' });
  const port = await listen(srv);
  await assert.rejects(fetchUnchecked(`http://127.0.0.1:${port}/`, { timeout: BUDGET }), /Redirect blocked/);
  await within(closed, 1000, 'connection close');
});

test('a reply cut off mid-body fails at once as a network error', { timeout: 5000 }, async () => {
  const srv = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"a":');
    setTimeout(() => res.socket?.destroy(), 50);
  });
  const port = await listen(srv);
  const t0 = Date.now();
  const err = await fetchUnchecked(`http://127.0.0.1:${port}/`, { timeout: 5000 }).catch(e => e);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.equal(err.code, 'ECONNRESET');
  assert.deepEqual({ kind: errorBody(err).kind, code: errorBody(err).code }, { kind: 'network', code: 'network' });
});

test('a refused connection is not labelled as a certificate problem', { timeout: 5000 }, async () => {
  const probe = await listen(net.createServer());
  servers.pop().close();
  const err = await fetchUnchecked(`http://127.0.0.1:${probe}/`, { timeout: BUDGET }).catch(e => e);
  assert.equal(err.code, 'ECONNREFUSED');
  assert.equal(errorBody(err).code, 'network');
});

/* Keep the timer. A pending mocked lookup holds no handle and the run exits early. */
async function withHungLookup(t, fn) {
  t.mock.method(dns, 'lookup', () => new Promise(() => {}));
  const keepAlive = setTimeout(() => {}, 10_000);
  try {
    return await fn();
  } finally {
    clearTimeout(keepAlive);
  }
}

test('a fetch whose DNS lookup hangs stops at its budget', { timeout: 5000 }, async t => {
  const t0 = Date.now();
  const err = await withHungLookup(t, () =>
    fetchChecked('http://hung.example.com/', { timeout: BUDGET }).catch(e => e),
  );
  const ms = Date.now() - t0;
  assert.equal(err.message, 'Timed out');
  assert.equal(errorBody(err).kind, 'timeout');
  assert.ok(ms < BUDGET + TOLERANCE, `took ${ms} ms against a ${BUDGET} ms budget`);
});

test('a ping whose DNS lookup hangs stops at its budget', { timeout: 5000 }, async t => {
  const t0 = Date.now();
  const r = await withHungLookup(t, () => pingChecked('http://hung.example.com/', BUDGET));
  const ms = Date.now() - t0;
  assert.deepEqual(r, { ok: false, status: 0, error: 'Timed out' });
  assert.ok(ms < BUDGET + TOLERANCE, `took ${ms} ms against a ${BUDGET} ms budget`);
});

async function pinnedServer(t) {
  const seen = { host: '', lookups: [] };
  t.mock.method(dns, 'lookup', async host => {
    seen.lookups.push(host);
    return { address: '127.0.0.1', family: 4 };
  });
  const srv = http.createServer((req, res) => {
    seen.host = req.headers.host || '';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  const port = await listen(srv);
  return { port, seen };
}

test('fetchChecked connects to the address it checked', { timeout: 5000 }, async t => {
  const { port, seen } = await pinnedServer(t);
  const r = await fetchChecked(`http://pinned.invalid:${port}/`, { timeout: BUDGET });
  assert.deepEqual(r.data, { ok: true });
  assert.equal(seen.host, `pinned.invalid:${port}`);
  assert.deepEqual(seen.lookups, ['pinned.invalid']);
});

test('pingChecked connects to the address it checked', { timeout: 5000 }, async t => {
  const { port, seen } = await pinnedServer(t);
  const r = await pingChecked(`http://pinned.invalid:${port}/`, BUDGET);
  assert.deepEqual({ ok: r.ok, status: r.status }, { ok: true, status: 200 });
  assert.equal(seen.host, `pinned.invalid:${port}`);
  assert.deepEqual(seen.lookups, ['pinned.invalid']);
});
