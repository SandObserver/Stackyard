/* Point config at a nonexistent path so loadConfig falls back to an empty
   config (no host IP, no port map) — keeps these tests hermetic. */
process.env.CONFIG_PATH = '/tmp/stackyard-proxy-test-nonexistent.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { guardSsrf, fetchJSON, PRIVATE_IP_RE, parsePrometheus } = require('../src/proxy');

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
