/* Point config at a nonexistent path so loadConfig falls back to an empty
   config (no host IP, no port map) — keeps these tests hermetic. */
process.env.CONFIG_PATH = '/tmp/stackyard-proxy-test-nonexistent.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getHostIp, shouldSkipTls, PRIVATE_IP_RE, parsePrometheus, parseXml, _internals } = require('../src/proxy');
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
    /* The hostname is never resolved — we connect straight to the pinned IP. */
    const r = await fetchJSON(`http://pinned.example:${port}/x`, { pinIp: '127.0.0.1', timeout: 3000 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
    assert.equal(seenHost, `pinned.example:${port}`, 'Host header should be the original hostname');
  } finally {
    server.close();
  }
});

test('parsePrometheus extracts numeric metric lines', () => {
  const out = parsePrometheus('# HELP x\nmetric_a 42\nmetric_b 3.5\n# comment\nbad_line');
  assert.equal(out['metric_a'], 42);
  assert.equal(out['metric_b'], 3.5);
  assert.ok(!('bad_line' in out));
});

/* ── parseXml: general nested shape, matching the JSON shape widgets already read ── */

test('parseXml maps root attributes with lossless numeric coercion', () => {
  assert.deepEqual(parseXml('<MediaContainer size="3" title="Library"/>'),
    { MediaContainer: { size: 3, title: 'Library' } });
});

test('parseXml nests elements and turns repeated tags into arrays', () => {
  const xml = '<MediaContainer size="2">'
    + '<Metadata title="The Matrix" duration="8160000"><Player state="playing"/></Metadata>'
    + '<Metadata title="Ep1" type="episode"><Player state="paused"/></Metadata>'
    + '</MediaContainer>';
  const p = parseXml(xml);
  assert.equal(p.MediaContainer.size, 2);
  assert.ok(Array.isArray(p.MediaContainer.Metadata));
  assert.equal(p.MediaContainer.Metadata[0].title, 'The Matrix');
  assert.equal(p.MediaContainer.Metadata[0].duration, 8160000);
  assert.equal(p.MediaContainer.Metadata[0].Player.state, 'playing'); /* nested element attribute */
  assert.equal(p.MediaContainer.Metadata[1].Player.state, 'paused');
});

test('parseXml keeps a single occurrence as one object, not an array', () => {
  const p = parseXml('<MediaContainer><Metadata title="Solo"/></MediaContainer>');
  assert.equal(p.MediaContainer.Metadata.title, 'Solo');
  assert.ok(!Array.isArray(p.MediaContainer.Metadata));
});

test('parseXml collapses text-only elements to their coerced value', () => {
  assert.deepEqual(parseXml('<stats><total>14203</total><blocked>1876</blocked><name>home</name></stats>'),
    { stats: { total: 14203, blocked: 1876, name: 'home' } });
});

test('parseXml leaves IDs, version strings, exponents and huge integers as strings', () => {
  assert.deepEqual(parseXml('<r id="007" ver="1.10" exp="1e3" big="9007199254740993"/>'),
    { r: { id: '007', ver: '1.10', exp: '1e3', big: '9007199254740993' } });
});

test('parseXml decodes entities, handles both quote styles and CDATA', () => {
  assert.deepEqual(parseXml("<r a='x &amp; y' b=\"&lt;ok&gt;\"/>"), { r: { a: 'x & y', b: '<ok>' } });
  assert.deepEqual(parseXml('<note><![CDATA[<b>hi & bye</b>]]></note>'), { note: '<b>hi & bye</b>' });
});

test('parseXml ignores declaration, comments and DOCTYPE, and is safe on junk', () => {
  assert.deepEqual(parseXml('<?xml version="1.0"?><!DOCTYPE x><!-- c --><r v="1"/>'), { r: { v: 1 } });
  assert.deepEqual(parseXml('not xml'), {});
  assert.deepEqual(parseXml(''), {});
  assert.deepEqual(parseXml(null), {});
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
