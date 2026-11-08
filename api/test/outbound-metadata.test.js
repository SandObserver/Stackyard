const { tmpDir } = require('../test-support/tmp');
const path = require('node:path');
const fs = require('node:fs');
process.env.CONFIG_PATH = path.join(tmpDir('metadata'), 'apps.json');
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ items: [], settings: { server: { hostIp: 'myhost' } } }));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const resolver = require('../src/resolve');
const localNetworks = require('../src/local-networks');
const proxmox = require('../src/proxmox');
const { errorBody } = require('../src/api-error');
const {
  fetchUnchecked,
  jsonRpcUnchecked,
  pingUnchecked,
  pingChecked,
  isMetadataAddress,
  SsrfBlockedError,
  _internals: { guardSsrf },
} = require('../src/proxy');

const METADATA_URLS = [
  'http://169.254.169.254/latest/meta-data',
  'http://[fd00:ec2::254]/',
  'http://100.100.100.200/',
  'http://[::ffff:a9fe:a9fe]/',
  'http://[64:ff9b::a9fe:a9fe]/',
  'http://[fe80::1]/',
];

/** Answers every connect-time lookup with `addresses`. */
function answer(t, addresses) {
  t.mock.method(resolver, 'lookupWithin', () => resolver.lookupFrom(addresses));
}

/** A server that fails the test if anything connects to it. */
async function untouched(t) {
  const server = http.createServer(() => assert.fail('connected to a refused address'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  return server.address().port;
}

test('isMetadataAddress covers link-local and the cloud metadata addresses only', () => {
  for (const a of ['169.254.169.254', '169.254.0.1', 'fe80::1', 'fd00:ec2::254', '100.100.100.200', '::ffff:a9fe:a9fe'])
    assert.ok(isMetadataAddress(a), a);
  for (const a of ['100.100.100.100', '192.168.1.10', '10.0.0.1', '127.0.0.1', 'fd00::1', 'fd00:ec2::253', '8.8.8.8'])
    assert.ok(!isMetadataAddress(a), a);
});

test('fetchUnchecked refuses a metadata literal before connecting', async () => {
  for (const url of METADATA_URLS) {
    const e = await fetchUnchecked(url, { timeout: 2000 }).catch(err => err);
    assert.ok(e instanceof SsrfBlockedError, url);
    assert.equal(errorBody(e).code, 'blocked.link-local', url);
  }
});

test('fetchUnchecked refuses a name that resolves to a metadata address', async t => {
  await untouched(t);
  answer(t, [{ address: '169.254.169.254', family: 4 }]);
  await assert.rejects(fetchUnchecked('http://metadata.google.internal/', { timeout: 2000 }), SsrfBlockedError);
});

test('fetchUnchecked refuses a name with one metadata address among others', async t => {
  const port = await untouched(t);
  answer(t, [
    { address: 'fd00:ec2::254', family: 6 },
    { address: '127.0.0.1', family: 4 },
  ]);
  await assert.rejects(fetchUnchecked(`http://mixed.example:${port}/`, { timeout: 2000 }), SsrfBlockedError);
});

test('fetchUnchecked still reaches a private address', async t => {
  const server = http.createServer((_, res) => res.end('{"ok":true}'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  answer(t, [{ address: '127.0.0.1', family: 4 }]);
  const r = await fetchUnchecked(`http://nas.example:${server.address().port}/`, { timeout: 2000 });
  assert.deepEqual(r.data, { ok: true });
});

test('jsonRpcUnchecked refuses a metadata address', async t => {
  await assert.rejects(
    jsonRpcUnchecked('http://169.254.169.254/api/current', { timeout: 2000 }, s => s.call('x')),
    SsrfBlockedError,
  );
  answer(t, [{ address: '169.254.169.254', family: 4 }]);
  await assert.rejects(
    jsonRpcUnchecked('http://truenas.example/api/current', { timeout: 2000 }, s => s.call('x')),
    SsrfBlockedError,
  );
});

test('pingUnchecked refuses every metadata address', async () => {
  for (const url of METADATA_URLS) assert.equal((await pingUnchecked(url, 1000)).code, 'blocked.link-local', url);
});

test('the Proxmox connection test refuses a metadata address', async () => {
  const conn = {
    url: 'http://169.254.169.254',
    tokenId: 'root@pam!probe',
    secret: '00000000-0000-0000-0000-000000000000',
    skipTlsVerify: false,
  };
  await assert.rejects(proxmox.listGuests(conn, 2000), SsrfBlockedError);
});

test('a bare name may resolve only to a network this container is on', async t => {
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '192.168.1.10', family: 4 }));
  t.mock.method(localNetworks, 'onLocalNetwork', () => false);
  assert.equal((await guardSsrf('http://nas/')).reason, 'private-address');
  t.mock.method(localNetworks, 'onLocalNetwork', () => true);
  assert.deepEqual(await guardSsrf('http://nas/'), { error: null, ip: '192.168.1.10' });
});

test('a bare name resolving to a public address is checked like any name', async t => {
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '93.184.215.14', family: 4 }));
  const onLocal = t.mock.method(localNetworks, 'onLocalNetwork', () => false);
  assert.deepEqual(await guardSsrf('http://intranet/'), { error: null, ip: '93.184.215.14' });
  assert.equal(onLocal.mock.callCount(), 0);
});

test('a host name in the host IP setting gets no exemption', async t => {
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '127.0.0.1', family: 4 }));
  const r = await guardSsrf('http://myhost:3000/');
  assert.equal(r.reason, 'private-address');
  assert.equal(r.ip, null);
});

test('pingChecked reports a metadata address as blocked', async () => {
  await assert.rejects(pingChecked('http://169.254.169.254/', 1000, false), SsrfBlockedError);
});

test('the Google IPv6 and local-use NAT64 metadata forms are metadata addresses', () => {
  assert.equal(isMetadataAddress('fd20:ce::254'), true);
  assert.equal(isMetadataAddress('64:ff9b:1::a9fe:a9fe'), true);
  assert.equal(isMetadataAddress('64:ff9b:1::808:808'), false);
});
