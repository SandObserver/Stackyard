/* /api/docker/test answers whether the address is usable, and separates an
   address that is wrong from one that is merely not answering yet. Only the
   first refuses the save. */

const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('docker-test'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');

let server, base, proxy, proxyBase, dead, deadBase, hang, hangPort;
let reply = { status: 200, body: JSON.stringify({ ApiVersion: '1.43' }) };

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  proxy = http.createServer((_, res) => {
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(reply.body);
  });
  proxyBase = await listen(proxy);

  /* Bound only to learn a port nothing is listening on, then closed. */
  dead = http.createServer(() => {});
  deadBase = await listen(dead);
  await close(dead);

  /* Accepts the connection and never answers, which is how a dropped packet
     looks to the prober. */
  hang = http.createServer(() => {});
  hangPort = new URL(await listen(hang)).port;

  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(proxy);
  await close(hang);
});

function probe(url, { origin = true } = {}) {
  const u = new URL(base + '/api/docker/test');
  const body = JSON.stringify({ url });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (origin) headers.Origin = base;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers }, res => {
      let b = '';
      res.on('data', c => {
        b += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('a Docker socket proxy is accepted', async () => {
  reply = { status: 200, body: JSON.stringify({ ApiVersion: '1.43' }) };
  const r = await probe(proxyBase);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.version, '1.43');
});

test('a trailing slash on the address is not fatal', async () => {
  reply = { status: 200, body: JSON.stringify({ ApiVersion: '1.43' }) };
  assert.equal((await probe(`${proxyBase}/`)).body.ok, true);
});

/* Something answers, so a plain reachability check passes, but it is not a
   Docker API. */
test('another service on that port is refused', async () => {
  reply = { status: 200, body: JSON.stringify({ hello: 'world' }) };
  const r = await probe(proxyBase);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.fatal, true);
});

test('a proxy that refuses the request is refused', async () => {
  reply = { status: 403, body: '{}' };
  const r = await probe(proxyBase);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.fatal, true);
});

test('an address with nothing listening is refused', async () => {
  const r = await probe(deadBase);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.fatal, true, 'a refused connection means the address is wrong');
});

test('a name that resolves nowhere is refused', async () => {
  const r = await probe('http://no-such-host.invalid:2375');
  assert.equal(r.body.ok, false);
  assert.equal(r.body.fatal, true);
});

test('a scheme that cannot be requested is refused before any connection', async () => {
  const r = await probe('tcp://socket-proxy:2375');
  assert.equal(r.body.ok, false);
  assert.equal(r.body.fatal, true);
});

/* The hint carries the address shape, and the UI turns it into advice. */
test('a service name that fails is told to share a network', async () => {
  const r = await probe('http://socket-proxy-nonexistent:2375');
  assert.equal(r.body.ok, false);
  assert.equal(r.body.hint, 'shared-network');
});

test('an address that fails is told to publish the port', async () => {
  const r = await probe(deadBase);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.hint, 'publish-port');
});

/* A proxy published on the host's loopback drops packets from inside a
   container rather than refusing them, so it arrives as a timeout. */
test('a literal address that never answers is refused, not merely warned about', async () => {
  const r = await probe(`http://127.0.0.1:${hangPort}`);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.fatal, true, 'a timeout on a literal address is not a proxy still starting');
  assert.equal(r.body.hint, 'publish-port');
});

test('a missing address is rejected', async () => {
  const r = await probe('');
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
});

test('the probe needs an origin, like every other request that acts', async () => {
  const r = await probe(proxyBase, { origin: false });
  assert.equal(r.status, 403);
});
