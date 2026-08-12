/* The shortened session is an idle window, not a fixed one.

   Shortening the lifetime on its own would sign people out mid-task, so a
   session still in use is reissued once it is past halfway. What the lifetime
   then bounds is how long a token nobody is using stays valid, which is the
   thing that matters when one leaks. */
const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  makeToken,
  readToken,
  verifyToken,
  refreshSession,
  newSessionId,
  newSessionSecret,
  SESSION_MAX_AGE_MS,
  RENEW_AFTER_MS,
} = require('../src/auth');
const { saveConfig } = require('../src/config');

const HOURS = 60 * 60 * 1000;

test('the default idle window is hours, not the month it used to be', () => {
  assert.equal(SESSION_MAX_AGE_MS, 12 * HOURS);
  assert.equal(RENEW_AFTER_MS, SESSION_MAX_AGE_MS / 2);
});

test('readToken reports when a session was issued', () => {
  const secret = newSessionSecret();
  const id = newSessionId();
  const before = Date.now();
  const read = readToken(makeToken(id, secret), secret);
  assert.equal(read.sessionId, id);
  assert.ok(read.iat >= before && read.iat <= Date.now());
});

test('readToken refuses a token signed with another secret', () => {
  const token = makeToken(newSessionId(), newSessionSecret());
  assert.equal(readToken(token, newSessionSecret()), null);
  assert.equal(verifyToken(token, newSessionSecret()), null);
});

/* Signed, so it cannot be backdated by the holder: this builds one the way the
   server would have at that moment. */
function tokenAgedBy(ms, secret, id) {
  const real = Date.now;
  Date.now = () => real() - ms;
  try {
    return makeToken(id, secret);
  } finally {
    Date.now = real;
  }
}

test('a token past its window no longer verifies', () => {
  const secret = newSessionSecret();
  const old = tokenAgedBy(SESSION_MAX_AGE_MS + 1000, secret, newSessionId());
  assert.equal(readToken(old, secret), null);
});

function reqRes(cookie) {
  const req = { headers: cookie ? { cookie: `ds=${cookie}` } : {}, socket: {} };
  const res = Object.assign(new EventEmitter(), {
    headers: {},
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
  });
  return { req, res };
}

function authOn() {
  const secret = newSessionSecret();
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: 'x', secret } } });
  return secret;
}

test('a fresh session is left alone', () => {
  const secret = authOn();
  const { req, res } = reqRes(makeToken(newSessionId(), secret));
  assert.equal(refreshSession(req, res), false);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('a session past halfway is reissued under the same identifier', () => {
  const secret = authOn();
  const id = newSessionId();
  const { req, res } = reqRes(tokenAgedBy(RENEW_AFTER_MS + 1000, secret, id));
  assert.equal(refreshSession(req, res), true);
  const issued = /ds=([^;]+)/.exec(res.headers['set-cookie'])[1];
  const read = readToken(issued, secret);
  assert.equal(read.sessionId, id, 'renewal must extend the session, not start a new one');
  assert.ok(Date.now() - read.iat < 1000, 'the reissued token must carry a fresh issued-at');
});

test('the reissued cookie keeps the flags the original was set with', () => {
  const secret = authOn();
  const { req, res } = reqRes(tokenAgedBy(RENEW_AFTER_MS + 1000, secret, newSessionId()));
  refreshSession(req, res);
  const cookie = res.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});

test('an expired session is not renewed back to life', () => {
  const secret = authOn();
  const { req, res } = reqRes(tokenAgedBy(SESSION_MAX_AGE_MS + 1000, secret, newSessionId()));
  assert.equal(refreshSession(req, res), false);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('nothing is renewed when there is no session to renew', () => {
  authOn();
  const { req, res } = reqRes(null);
  assert.equal(refreshSession(req, res), false);
});

test('nothing is renewed while authentication is off', () => {
  const secret = newSessionSecret();
  saveConfig({ items: [], settings: { auth: { enabled: false, secret } } });
  const { req, res } = reqRes(tokenAgedBy(RENEW_AFTER_MS + 1000, secret, newSessionId()));
  assert.equal(refreshSession(req, res), false);
});
