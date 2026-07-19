/* Point config at a nonexistent path so loadConfig falls back to an empty
   config (no host IP, no port map), which keeps these tests hermetic. */
process.env.CONFIG_PATH = '/tmp/stackyard-proxy-test-nonexistent.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getHostIp, shouldSkipTls, PRIVATE_IP_RE, isPrivateAddress, embeddedIPv4, _internals } = require('../src/proxy');
/* guardSsrf/fetchJSON are private to proxy.js: routes go through the
   fetchChecked/fetchUnchecked boundary. Tests reach the primitives directly. */
const { guardSsrf, fetchJSON } = _internals;

test('PRIVATE_IP_RE classifies private ranges as private', () => {
  for (const ip of ['10.0.0.1', '172.16.5.4', '172.31.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '::1'])
    assert.ok(PRIVATE_IP_RE.test(ip), `${ip} should be private`);
});

test('PRIVATE_IP_RE treats public addresses as public', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34'])
    assert.ok(!PRIVATE_IP_RE.test(ip), `${ip} should be public`);
});

test('embeddedIPv4 extracts the IPv4 from IPv4-in-IPv6 wrappers', () => {
  assert.equal(embeddedIPv4('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(embeddedIPv4('::ffff:a9fe:a9fe'), '169.254.169.254');
  assert.equal(embeddedIPv4('64:ff9b::7f00:1'), '127.0.0.1');
  assert.equal(embeddedIPv4('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(embeddedIPv4('::ffff:0808:0808'), '8.8.8.8');
  assert.equal(embeddedIPv4('2001:db8::1'), null);
});

test('isPrivateAddress blocks hex-form IPv4-mapped and NAT64 private targets', () => {
  for (const a of ['::ffff:7f00:1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '::ffff:127.0.0.1'])
    assert.ok(isPrivateAddress(a), `${a} should be private`);
});

test('isPrivateAddress refuses an IPv4-in-IPv6 wrapper it cannot parse', () => {
  assert.ok(isPrivateAddress('::ffff:nonsense'));
  assert.ok(isPrivateAddress('64:ff9b::zz'));
});

test('isPrivateAddress leaves public addresses public', () => {
  for (const a of ['8.8.8.8', '::ffff:8.8.8.8', '::ffff:0808:0808', '2001:db8::1', '93.184.216.34'])
    assert.ok(!isPrivateAddress(a), `${a} should be public`);
});

test('isPrivateAddress agrees with PRIVATE_IP_RE on plain addresses', () => {
  for (const a of ['10.0.0.1', '127.0.0.1', '192.168.1.1', '::1', 'fd00::1'])
    assert.ok(isPrivateAddress(a), `${a} should be private`);
});

test('guardSsrf blocks IPv4-mapped and NAT64 loopback/metadata literals', async () => {
  for (const u of ['http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[64:ff9b::7f00:1]/', 'http://[::1]/']) {
    const r = await guardSsrf(u);
    assert.match(r.error || '', /private address/, `${u} should be blocked`);
  }
});

test('guardSsrf allows dotless Docker service names without pinning', async () => {
  assert.deepEqual(await guardSsrf('http://navidrome:4533'), { error: null, ip: null });
});

test('guardSsrf blocks private IP literals', async () => {
  const r = await guardSsrf('http://192.168.1.5:8080');
  assert.ok(r.error, 'should return a block message');
  assert.equal(r.ip, null);
});

test('guardSsrf blocks loopback literal', async () => {
  const r = await guardSsrf('http://127.0.0.1:3000');
  assert.ok(r.error);
  assert.equal(r.ip, null);
});

test('guardSsrf rejects an invalid URL', async () => {
  const r = await guardSsrf('not a url');
  assert.equal(r.error, 'Invalid URL');
  assert.equal(r.ip, null);
});

/* Integration: pinning must connect to the pinned IP while still sending the
   original hostname in the Host header (and, for TLS, as the SNI servername).
   Uses a loopback server so no external network is required. */
test('fetchJSON pins the IP and preserves the Host header', async () => {
  let seenHost;
  const server = http.createServer((req, res) => {
    seenHost = req.headers.host;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    /* The hostname is never resolved; we connect straight to the pinned IP. */
    const r = await fetchJSON(`http://pinned.example:${port}/x`, { pinIp: '127.0.0.1', timeout: 3000 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(seenHost, `pinned.example:${port}`, 'Host header should be the original hostname');
  } finally {
    server.close();
  }
});

/* ── guardSsrf DNS resolution: the DNS-rebind defense. A hostname is resolved
   once and the validated IP is returned to be pinned for the connection; a name
   that resolves to a private address is blocked even though the name itself
   looks public (which a stale re-resolution could otherwise exploit). ── */
const dns = require('node:dns').promises;

test('guardSsrf resolves a public hostname and returns the IP to pin', async (t) => {
  t.mock.method(dns, 'lookup', async () => ({ address: '93.184.216.34', family: 4 }));
  assert.deepEqual(await guardSsrf('http://example.com/path'), { error: null, ip: '93.184.216.34' });
});

test('guardSsrf blocks a public-looking name that resolves to a private IP', async (t) => {
  t.mock.method(dns, 'lookup', async () => ({ address: '192.168.1.50', family: 4 }));
  const r = await guardSsrf('http://sneaky.example.com/');
  assert.equal(r.ip, null);
  assert.match(r.error, /private IP/);
});

test('guardSsrf blocks a name that resolves to the link-local metadata IP', async (t) => {
  t.mock.method(dns, 'lookup', async () => ({ address: '169.254.169.254', family: 4 }));
  const r = await guardSsrf('http://rebind.example.com/');
  assert.equal(r.ip, null);
  assert.match(r.error, /private IP/);
});

test('guardSsrf blocks when the hostname cannot be resolved', async (t) => {
  t.mock.method(dns, 'lookup', async () => { throw new Error('ENOTFOUND'); });
  const r = await guardSsrf('http://nxdomain.example.com/');
  assert.equal(r.ip, null);
  assert.match(r.error, /could not be resolved/);
});

test('shouldSkipTls returns false unless skipTlsVerify is explicitly true', () => {
  for (const cfg of [{ settings: {} }, { settings: { server: {} } }, { settings: { server: { skipTlsVerify: 'true' } } }])
    assert.equal(shouldSkipTls('nas', cfg), false);
});

test('shouldSkipTls only bypasses internal hostnames when enabled', () => {
  const cfg = { settings: { server: { skipTlsVerify: true } } };
  for (const h of ['nas', 'socket-proxy', 'localhost', '192.168.1.10', '10.0.0.5', '127.0.0.1'])
    assert.equal(shouldSkipTls(h, cfg), true, `${h} should skip`);
  for (const h of ['example.com', 'api.github.com', '8.8.8.8'])
    assert.equal(shouldSkipTls(h, cfg), false, `${h} should not skip`);
});

test('getHostIp returns an empty string when no config file exists', () => {
  assert.equal(getHostIp(), '');
});
