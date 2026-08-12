/* Turning certificate checking off is scoped to your own network, wherever the
   request came from.

   The server-wide setting was already scoped this way. The per-app switch and the
   per-request flag were not: both were handed straight to the transport, so a
   badge pointed at a public HTTPS service could be polled with verification off,
   and that is the request that carries a stored credential.

   The config file is written before proxy.js is required, so the global-setting
   branch reads a real file rather than a stub. */
const fs = require('node:fs');
const { tmpPath } = require('../test-support/tmp');

const CONFIG_PATH = tmpPath('apps.json');
process.env.CONFIG_PATH = CONFIG_PATH;
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ items: [], settings: { server: { skipTlsVerify: true } } }));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { resolveSkipTls, SKIP_TLS_IGNORED_MESSAGE, _internals } = require('../src/proxy');

const INTERNAL = ['127.0.0.1', '192.168.1.10', '10.0.0.5', 'localhost', 'socket-proxy', '[::1]'];
const PUBLIC = ['api.github.com', 'example.com', '8.8.8.8', '1.1.1.1'];

test('an explicit request to skip is honoured only for an internal host', () => {
  for (const h of INTERNAL) {
    assert.deepEqual(resolveSkipTls(h, true), { skip: true, ignored: false }, h);
  }
  for (const h of PUBLIC) {
    assert.deepEqual(resolveSkipTls(h, true), { skip: false, ignored: true }, h);
  }
});

test('not asking to skip is never overridden into skipping', () => {
  for (const h of [...INTERNAL, ...PUBLIC]) {
    assert.deepEqual(resolveSkipTls(h, false), { skip: false, ignored: false }, h);
  }
});

/* No per-request answer, so the stored setting decides. It is on in this file's
   config, and is scoped the same way. */
test('the server-wide setting is scoped to internal hosts too', () => {
  assert.equal(resolveSkipTls('192.168.1.10', undefined).skip, true);
  assert.equal(resolveSkipTls('api.github.com', undefined).skip, false);
  assert.equal(resolveSkipTls('api.github.com', undefined).ignored, true);
});

/* The decision is only worth anything if it reaches the transport, so these read
   the options actually handed to https.request. */
function captureRequest(t) {
  const calls = [];
  const original = https.request;
  https.request = (opts, _cb) => {
    calls.push(opts);
    const req = new EventEmitter();
    req.end = () => {};
    req.write = () => {};
    req.destroy = () => {};
    setImmediate(() => req.emit('error', Object.assign(new Error('stub'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })));
    return req;
  };
  t.after(() => {
    https.request = original;
  });
  return calls;
}

test('fetchJSON keeps certificate checking on for a public host that asked to skip', async t => {
  const calls = captureRequest(t);
  await _internals.fetchJSON('https://api.github.com/x', { skipTls: true }).catch(() => {});
  assert.equal(calls[0].rejectUnauthorized, true);
});

test('fetchJSON turns certificate checking off for an internal host that asked to skip', async t => {
  const calls = captureRequest(t);
  await _internals.fetchJSON('https://192.168.1.10/x', { skipTls: true }).catch(() => {});
  assert.equal(calls[0].rejectUnauthorized, false);
});

test('a certificate failure on a public host explains that the skip did not apply', async t => {
  captureRequest(t);
  const err = await _internals.fetchJSON('https://api.github.com/x', { skipTls: true }).catch(e => e);
  /* Vouched rather than left on the message, because api-error.js replaces an
     unvouched message with a generic one. */
  assert.equal(err.vouchedMessage, SKIP_TLS_IGNORED_MESSAGE);
});

test('a certificate failure nobody asked to skip is not explained away', async t => {
  captureRequest(t);
  const err = await _internals.fetchJSON('https://api.github.com/x', { skipTls: false }).catch(e => e);
  assert.equal(err.vouchedMessage, undefined);
});

test('pingUrl scopes the flag the same way and says so on a certificate failure', async t => {
  const calls = captureRequest(t);
  const pub = await _internals.pingUrl('https://api.github.com/', 500, true);
  assert.equal(calls[0].rejectUnauthorized, true);
  assert.equal(pub.error, SKIP_TLS_IGNORED_MESSAGE);

  const internal = await _internals.pingUrl('https://192.168.1.10/', 500, true);
  assert.equal(calls[1].rejectUnauthorized, false);
  assert.notEqual(internal.error, SKIP_TLS_IGNORED_MESSAGE);
});
