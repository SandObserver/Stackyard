const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { resolveAll, lookupWithin, fromHosts } = require('../src/resolve');

async function deadDnsServer(t) {
  const sock = dgram.createSocket('udp4');
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  t.after(() => sock.close());
  return `127.0.0.1:${sock.address().port}`;
}

test('a hosts file entry resolves without DNS', () => {
  const text = '127.0.0.1 localhost\n# 10.0.0.9 commented\n10.0.0.5  nas NAS.lan  # the box\n::1 ip6-localhost\n';
  assert.deepEqual(fromHosts('nas.lan', text), [{ address: '10.0.0.5', family: 4 }]);
  assert.deepEqual(fromHosts('NAS', text), [{ address: '10.0.0.5', family: 4 }]);
  assert.deepEqual(fromHosts('commented', text), []);
  assert.deepEqual(fromHosts('ip6-localhost', text), [{ address: '::1', family: 6 }]);
});

test('localhost resolves even when the hosts file does not list it', () => {
  assert.deepEqual(fromHosts('localhost', ''), [
    { address: '127.0.0.1', family: 4 },
    { address: '::1', family: 6 },
  ]);
});

test('an address literal resolves to itself', async () => {
  assert.deepEqual(await resolveAll('10.1.2.3', 100), [{ address: '10.1.2.3', family: 4 }]);
  assert.deepEqual(await resolveAll('fd00::1', 100), [{ address: 'fd00::1', family: 6 }]);
});

test('a dead DNS server fails the lookup as a timeout within its budget', async t => {
  const server = await deadDnsServer(t);
  const t0 = Date.now();
  await assert.rejects(resolveAll('svc.example.test', 300, { servers: [server] }), /Timed out/);
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});

test('lookups stuck on a dead DNS server leave the worker threads free', async t => {
  const server = await deadDnsServer(t);
  const stuck = Array.from({ length: 8 }, (_, i) =>
    resolveAll(`svc${i}.example.test`, 1500, { servers: [server] }).catch(() => {}),
  );
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 4 }, () => new Promise(r => crypto.pbkdf2('x', 's', 1, 32, 'sha256', r))));
  assert.ok(Date.now() - t0 < 500, `thread pool work took ${Date.now() - t0} ms`);
  await Promise.all(stuck);
});

test('the lookup option answers in the shape http.request asks for', async () => {
  const lookup = lookupWithin(500);
  const one = await new Promise((r, j) => lookup('localhost', { family: 4 }, (e, a, f) => (e ? j(e) : r([a, f]))));
  assert.deepEqual(one, ['127.0.0.1', 4]);
  const all = await new Promise((r, j) => lookup('localhost', { all: true }, (e, list) => (e ? j(e) : r(list))));
  assert.deepEqual(all, [
    { address: '127.0.0.1', family: 4 },
    { address: '::1', family: 6 },
  ]);
});
