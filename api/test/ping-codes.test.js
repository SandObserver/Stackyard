/* A ping that gets no HTTP answer reports why as an API code. The Settings
   Health Check Test translates the code; it never shows Node's syscall name or
   the server's English text. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { SKIP_TLS_IGNORED_MESSAGE, pingChecked, _internals } = require('../src/proxy');

const { pingUrl, PING_CODES } = _internals;

function failWith(t, lib, code) {
  const original = lib.request;
  lib.request = () => {
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    setImmediate(() => req.emit('error', Object.assign(new Error('stub'), { code })));
    return req;
  };
  t.after(() => {
    lib.request = original;
  });
}

const CASES = [
  ['http', 'ECONNREFUSED', 'network.refused'],
  ['http', 'ENOTFOUND', 'network.not-found'],
  ['http', 'EAI_AGAIN', 'network.not-found'],
  ['http', 'EHOSTUNREACH', 'network.unreachable'],
  ['http', 'ENETUNREACH', 'network.unreachable'],
  ['http', 'ECONNRESET', 'network.reset'],
  ['https', 'EPROTO', 'network.not-http'],
  ['https', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'network.self-signed'],
  ['https', 'SELF_SIGNED_CERT_IN_CHAIN', 'network.self-signed'],
  ['https', 'CERT_HAS_EXPIRED', 'network.tls-expired'],
  ['https', 'ERR_TLS_CERT_ALTNAME_INVALID', 'network.tls-untrusted'],
  ['http', 'HPE_INVALID_CONSTANT', 'network.not-http'],
  ['http', 'EWHATEVER', 'network'],
];

for (const [scheme, nodeCode, apiCode] of CASES) {
  test(`a ping that fails with ${nodeCode} reports ${apiCode}`, async t => {
    failWith(t, scheme === 'https' ? https : http, nodeCode);
    const r = await pingUrl(`${scheme}://192.168.1.10/`, 500);
    assert.deepEqual([r.ok, r.status, r.kind, r.code], [false, 0, 'network', apiCode]);
  });
}

test('every mapped code is one the cases above check', () => {
  const checked = new Set(CASES.map(([, nodeCode]) => nodeCode));
  for (const nodeCode of Object.keys(PING_CODES)) assert.ok(checked.has(nodeCode), nodeCode);
});

test('a certificate failure on a public host whose skip was ignored says so', async t => {
  failWith(t, https, 'DEPTH_ZERO_SELF_SIGNED_CERT');
  const r = await pingUrl('https://example.com/', 500, true);
  assert.equal(r.code, 'network.tls-ignored');
  assert.equal(r.error, SKIP_TLS_IGNORED_MESSAGE);
});

test('a self-signed certificate on a public host does not suggest the switch', async t => {
  failWith(t, https, 'DEPTH_ZERO_SELF_SIGNED_CERT');
  const r = await pingUrl('https://example.com/', 500);
  assert.equal(r.code, 'network.self-signed-public');
});

test('a ping that gets no answer in time reports a timeout code', async t => {
  const srv = http.createServer(() => {});
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    srv.close();
  });
  const r = await pingUrl(`http://127.0.0.1:${srv.address().port}/`, 200);
  assert.deepEqual([r.ok, r.status, r.kind, r.code], [false, 0, 'timeout', 'timeout.no-answer']);
});

test('an address that is not a URL reports invalid.url', async () => {
  const r = await pingUrl('not a url', 500);
  assert.deepEqual([r.kind, r.code], ['invalid', 'invalid.url']);
});

for (const url of ['192.168.1.10:8080', 'nas.local:8080', 'ftp://nas/', 'http://']) {
  test(`the Health Check Test reports ${url} as invalid.url`, async () => {
    const r = await pingChecked(url, 500, false);
    assert.deepEqual([r.ok, r.status, r.kind, r.code], [false, 0, 'invalid', 'invalid.url']);
  });
}
