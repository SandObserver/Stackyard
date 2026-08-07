/* Regression tests for P3-1: the outbound guard ignored the URL scheme.

   guardSsrf never looked at u.protocol, so file:, javascript:, data:, ftp: and
   gopher: all passed. file: got through by an unlucky route: its hostname is
   empty, and an empty hostname is dotless, so it matched the branch that treats
   a dotless name as a trusted Docker service name and returned "allowed" before
   any range check ran.

   What made that reachable rather than merely untidy is the transport. It picks
   the https module for 'https:' and the plain http module for everything else,
   so an unknown scheme did not fail, it became an HTTP request. Node's http
   module treats an empty hostname as localhost. So file:///etc/passwd became a
   request to localhost, defeating the explicit localhost block three lines above
   it in the same function.

   Checked in two places on purpose. fetchUnchecked and pingUnchecked skip the
   guard by design and carry URLs from saved config, which can arrive by import,
   so the rule also sits where the connection is opened. */
const path = require('node:path');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

const { _internals, urlPolicyError, fetchUnchecked, pingUnchecked, ALLOWED_PROTOCOLS } = require('../src/proxy');

const BAD_SCHEMES = [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,hi',
  'ftp://example.com/x',
  'gopher://example.com/x',
  'ws://example.com/x',
  'chrome://settings',
];

/* ── the policy itself ────────────────────────────────────────────────────── */

test('only http and https are allowed', () => {
  assert.deepEqual([...ALLOWED_PROTOCOLS].sort(), ['http:', 'https:']);
});

test('urlPolicyError rejects every non-http scheme', () => {
  for (const raw of BAD_SCHEMES) {
    assert.ok(urlPolicyError(new URL(raw)), `${raw} should be rejected`);
  }
});

test('urlPolicyError rejects a URL with no host', () => {
  /* The scheme check catches every real empty-host URL first, because the URL
     parser requires a host for http and https and refuses to parse 'http://'
     at all. The host check is belt and braces: it states the requirement
     independently, so loosening ALLOWED_PROTOCOLS later cannot quietly bring
     the localhost path back. Exercised directly, since no parsable URL can
     reach it. */
  assert.throws(() => new URL('http://'), /Invalid URL/);
  assert.match(urlPolicyError({ protocol: 'http:', hostname: '' }), /no host/);
  assert.equal(urlPolicyError({ protocol: 'http:', hostname: 'svc' }), null);
});

test('urlPolicyError accepts ordinary http and https URLs', () => {
  for (const raw of ['http://svc:8080/x', 'https://example.com/x', 'http://192.168.1.5/x', 'http://[fd00::1]/x']) {
    assert.equal(urlPolicyError(new URL(raw)), null, `${raw} should be allowed`);
  }
});

test('the rejection names the scheme without echoing the rest of the URL', () => {
  const msg = urlPolicyError(new URL('ftp://example.com/secret/path?token=abc'));
  assert.match(msg, /ftp/);
  assert.ok(!msg.includes('token=abc'), 'the message must not carry the URL back');
});

/* ── guardSsrf ────────────────────────────────────────────────────────────── */

test('guardSsrf blocks every non-http scheme', async () => {
  for (const raw of BAD_SCHEMES) {
    const g = await _internals.guardSsrf(raw);
    assert.ok(g.error, `${raw} should be blocked, got ${JSON.stringify(g)}`);
  }
});

/* The specific route in: empty host matched the dotless service-name branch. */
test('an empty hostname no longer passes as a Docker service name', async () => {
  const g = await _internals.guardSsrf('file:///etc/passwd');
  assert.ok(g.error);
  assert.equal(g.ip, null);
});

test('guardSsrf still allows a dotless service name over http', async () => {
  const g = await _internals.guardSsrf('http://qbittorrent:8080/api/v2');
  assert.equal(g.error, null);
});

/* ── the transport, which the unchecked paths reach directly ──────────────── */

test('fetchUnchecked refuses a non-http scheme', async () => {
  await assert.rejects(() => fetchUnchecked('file:///etc/passwd'), /http/);
});

test('pingUnchecked refuses a non-http scheme', async () => {
  const r = await pingUnchecked('file:///etc/passwd', 500);
  assert.equal(r.ok, false);
  assert.match(r.error, /http/);
});

/* The end of the chain, and the reason this mattered: an empty hostname was
   silently resolved to localhost by Node's http module, so the request went out
   before anything could object. Asserting on a listener would not show this,
   since the old code aimed at port 80 rather than at any port a test can bind.
   Assert instead that no connection is attempted at all. */
test('a rejected URL opens no connection', async () => {
  const attempts = [];
  const realHttp = http.request;
  const realHttps = https.request;
  http.request = (...args) => { attempts.push(args[0]); return realHttp.apply(http, args); };
  https.request = (...args) => { attempts.push(args[0]); return realHttps.apply(https, args); };
  try {
    await fetchUnchecked('file:///etc/passwd', { timeout: 500 }).catch(() => {});
    await pingUnchecked('file:///etc/passwd', 500).catch(() => {});
    await fetchUnchecked('gopher://example.com/x', { timeout: 500 }).catch(() => {});
    assert.deepEqual(attempts, [], 'the request must be refused before any socket is opened');
  } finally {
    http.request = realHttp;
    https.request = realHttps;
  }
});

test('an ordinary http request still works', async () => {
  const srv = http.createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await fetchUnchecked(`http://127.0.0.1:${srv.address().port}/x`, { timeout: 2000 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { ok: true });
  } finally {
    await new Promise(r => { srv.closeAllConnections?.(); srv.close(r); });
  }
});
