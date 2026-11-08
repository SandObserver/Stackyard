const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');
process.env.TRUST_PROXY = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { isSecureRequest, setSessionCookie, clearSessionCookie } = require('../src/auth');

const request = (headers = {}, encrypted = false) => ({ headers, socket: { encrypted } });

function cookieSetBy(fn) {
  const res = {
    setHeader(_, v) {
      this.cookie = v;
    },
  };
  fn(res);
  return res.cookie;
}

test('a TLS connection is secure', () => {
  assert.equal(isSecureRequest(request({}, true)), true);
});

test('a trusted proxy reporting https is secure', () => {
  assert.equal(isSecureRequest(request({ 'x-forwarded-proto': 'https' })), true);
  assert.equal(isSecureRequest(request({ 'x-forwarded-proto': 'HTTPS, http' })), true);
});

test('plain http is not secure', () => {
  assert.equal(isSecureRequest(request()), false);
  assert.equal(isSecureRequest(request({ 'x-forwarded-proto': 'http, https' })), false);
});

test('X-Forwarded-Proto is ignored unless TRUST_PROXY is true', () => {
  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `console.log(require('./src/auth').isSecureRequest({ headers: { 'x-forwarded-proto': 'https' }, socket: {} }))`,
    ],
    { cwd: `${__dirname}/..`, env: { ...process.env, TRUST_PROXY: '' }, encoding: 'utf8' },
  );
  assert.equal(out.trim(), 'false');
});

test('the session cookie is Secure only on a secure request', () => {
  assert.match(
    cookieSetBy(res => setSessionCookie(res, 't', true)),
    /; Secure;/,
  );
  assert.doesNotMatch(
    cookieSetBy(res => setSessionCookie(res, 't', false)),
    /Secure/,
  );
});

test('clearing the cookie keeps its flags and expires it at once', () => {
  const cleared = cookieSetBy(res => clearSessionCookie(res, true));
  assert.match(cleared, /^ds=;/);
  assert.match(cleared, /; Secure;/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Max-Age=0$/);
});

test('a page loaded over https is secure, by its Origin or its Referer', () => {
  assert.equal(isSecureRequest(request({ origin: 'https://dash.example.com' })), true);
  assert.equal(isSecureRequest(request({ referer: 'https://dash.example.com/admin/' })), true);
  assert.equal(isSecureRequest(request({ origin: 'http://192.168.1.10:8700' })), false);
  assert.equal(isSecureRequest(request({ referer: 'http://192.168.1.10:8700/' })), false);
  assert.equal(isSecureRequest(request({ origin: 'null' })), false);
});

test('a page over http is not made secure by a Referer it does not send', () => {
  assert.equal(
    isSecureRequest(request({ origin: 'http://192.168.1.10', referer: 'https://elsewhere.example/' })),
    false,
    'Origin wins: it names this request’s page',
  );
});

test('a proxy named in TRUSTED_PROXY reporting https is secure, through this nginx only', () => {
  const via = (peer, value) => ({ headers: { 'x-stackyard-https': value }, socket: { remoteAddress: peer } });
  assert.equal(isSecureRequest(via('127.0.0.1', '1')), true);
  assert.equal(isSecureRequest(via('127.0.0.1', '0')), false);
  assert.equal(isSecureRequest(via('172.18.0.5', '1')), false);
});
