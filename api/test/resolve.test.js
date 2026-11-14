const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const dns = require('node:dns');
const crypto = require('node:crypto');
const { resolveAll, lookupWithin, fromHosts } = require('../src/resolve');

async function deadDnsServer(t) {
  const sock = dgram.createSocket('udp4');
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  t.after(() => sock.close());
  return `127.0.0.1:${sock.address().port}`;
}

async function dnsServer(t, delay) {
  const sock = dgram.createSocket('udp4');
  const pending = new Set();
  sock.on('message', (msg, peer) => {
    let end = 12;
    while (msg[end]) end += msg[end] + 1;
    const qtype = msg.readUInt16BE(end + 1);
    const ms = qtype === 1 ? delay.a : qtype === 28 ? delay.aaaa : null;
    if (ms == null) return;
    const header = Buffer.from(msg.subarray(0, 12));
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(1, 6);
    header.writeUInt32BE(0, 8);
    const data = qtype === 1 ? Buffer.from([10, 0, 0, 7]) : Buffer.from('fd000000000000000000000000000007', 'hex');
    const answer = Buffer.concat([Buffer.from([0xc0, 0x0c, 0, qtype, 0, 1, 0, 0, 0, 60, 0, data.length]), data]);
    const reply = Buffer.concat([header, msg.subarray(12, end + 5), answer]);
    const timer = setTimeout(() => {
      pending.delete(timer);
      sock.send(reply, peer.port, peer.address);
    }, ms);
    pending.add(timer);
  });
  await new Promise(r => sock.bind(0, '127.0.0.1', r));
  t.after(() => {
    for (const timer of pending) clearTimeout(timer);
    sock.close();
  });
  return `127.0.0.1:${sock.address().port}`;
}

const A = { address: '10.0.0.7', family: 4 };
const AAAA = { address: 'fd00::7', family: 6 };

test('a DNS server that never answers AAAA still resolves well within the budget', async t => {
  const server = await dnsServer(t, { a: 0, aaaa: null });
  const t0 = Date.now();
  assert.deepEqual(await resolveAll('svc.example.test', 3000, { servers: [server] }), [A]);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

test('a DNS server that never answers A still resolves from AAAA well within the budget', async t => {
  const server = await dnsServer(t, { a: null, aaaa: 0 });
  const t0 = Date.now();
  assert.deepEqual(await resolveAll('svc.example.test', 1000, { servers: [server] }), [AAAA]);
  assert.ok(Date.now() - t0 < 800, `${Date.now() - t0} ms`);
});

test('an A answer well after an AAAA answer is still returned, IPv4 first', async t => {
  const server = await dnsServer(t, { a: 150, aaaa: 0 });
  assert.deepEqual(await resolveAll('svc.example.test', 3000, { servers: [server] }), [A, AAAA]);
});

test('an AAAA answer first still waits briefly for A and lists IPv4 first', async t => {
  const server = await dnsServer(t, { a: 20, aaaa: 0 });
  assert.deepEqual(await resolveAll('svc.example.test', 3000, { servers: [server] }), [A, AAAA]);
});

test('both answers are returned, IPv4 first', async t => {
  const server = await dnsServer(t, { a: 0, aaaa: 0 });
  assert.deepEqual(await resolveAll('svc.example.test', 3000, { servers: [server] }), [A, AAAA]);
});

test('an answer later than the resolution delay is left out', async t => {
  const server = await dnsServer(t, { a: 0, aaaa: 400 });
  const t0 = Date.now();
  assert.deepEqual(await resolveAll('svc.example.test', 3000, { servers: [server] }), [A]);
  assert.ok(Date.now() - t0 < 300, `${Date.now() - t0} ms`);
});

test('a lookup leaves no timer or query behind', async t => {
  const server = await dnsServer(t, { a: 0, aaaa: null });
  const ended = [];
  const Resolver = dns.promises.Resolver;
  dns.promises.Resolver = class extends Resolver {
    resolve6(host) {
      const query = super.resolve6(host);
      query.catch(e => ended.push(e.code));
      return query;
    }
  };
  t.after(() => {
    dns.promises.Resolver = Resolver;
  });
  const timers = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
  const before = timers();
  await resolveAll('svc.example.test', 3000, { servers: [server] });
  await new Promise(r => setImmediate(r));
  assert.equal(timers(), before);
  assert.deepEqual(ended, [dns.CANCELLED]);
});

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
