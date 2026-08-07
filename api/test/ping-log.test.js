/* What a failed ping writes to the log.

   The line read `${opts.protocol}//${opts.hostname}${opts.path}`, but the
   request options pingUrl builds carry neither a protocol nor a port, so every
   failure logged `url=undefined//host/path`. An operator reading the log could
   not tell http from https, and could not tell two services on the same host
   apart. It is built from the parsed URL now.

   Asserted through the logger rather than by mocking process.stdout. The test
   runner writes its own progress to stdout, so a mock held across an awaited
   ping starves it: the test hangs, and the runner then reports a green summary
   with that test silently missing from the count. Swapping log.warn is precise
   and has no such interaction.

   ALLOW_PRIVATE_IPS because the target is a closed port on loopback, which the
   outbound guard blocks by default. Set before requiring proxy.js, which reads
   it once at load. */

process.env.ALLOW_PRIVATE_IPS = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const log = require('../src/log');
const { _internals } = require('../src/proxy');
const { pingUrl } = _internals;

/* Record what log.warn is given. The runner restores it after each test. */
function warnings(t) {
  const seen = [];
  t.mock.method(log, 'warn', (msg, data) => { seen.push({ msg, data }); });
  return seen;
}

/* A port nothing listens on, found by opening and immediately closing one. */
async function closedPort() {
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise(r => srv.close(r));
  return port;
}

const pingFailure = seen => seen.find(w => w.msg === 'ping failed');

test('a failed ping logs a usable URL', async (t) => {
  const port = await closedPort();
  const seen = warnings(t);
  await pingUrl(`http://127.0.0.1:${port}/health`, 2000);

  const w = pingFailure(seen);
  assert.ok(w, 'the failure should be logged');
  assert.equal(w.data.url, `http://127.0.0.1:${port}/health`);
  assert.ok(!String(w.data.url).includes('undefined'), 'no part of the URL may be undefined');
});

/* The port is the half that made two services on one host indistinguishable. */
test('the logged URL names the scheme and the port', async (t) => {
  const port = await closedPort();
  const seen = warnings(t);
  await pingUrl(`http://127.0.0.1:${port}/`, 2000);

  const { url } = pingFailure(seen).data;
  assert.match(url, /^http:\/\//, 'the scheme distinguishes http from https');
  assert.ok(url.includes(`:${port}/`), `the port must be named: ${url}`);
});

/* A URL may carry an API key in its query string and credentials in its
   authority. u.origin excludes both, and the query is deliberately left off. */
test('the logged URL carries neither credentials nor query string', async (t) => {
  const port = await closedPort();
  const seen = warnings(t);
  await pingUrl(`http://user:hunter2@127.0.0.1:${port}/api?token=SECRET`, 2000);

  const { url } = pingFailure(seen).data;
  assert.ok(!url.includes('hunter2'), `credentials must not be logged: ${url}`);
  assert.ok(!url.includes('SECRET'), `the query string must not be logged: ${url}`);
  assert.equal(url, `http://127.0.0.1:${port}/api`);
});

/* The error text is logged in full, since the response no longer carries it. */
test('the underlying error message is logged', async (t) => {
  const port = await closedPort();
  const seen = warnings(t);
  await pingUrl(`http://127.0.0.1:${port}/`, 2000);

  assert.match(pingFailure(seen).data.error, /ECONNREFUSED/);
});

/* The result the caller gets is unchanged: this was a logging fix. */
test('the ping still reports the failure to its caller', async () => {
  const port = await closedPort();
  const r = await pingUrl(`http://127.0.0.1:${port}/`, 2000);
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(r.code, 'ECONNREFUSED');
  assert.ok(!/127\.0\.0\.1/.test(r.error), 'and it still names no address');
});
