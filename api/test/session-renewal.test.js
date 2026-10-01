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
  SESSION_ABSOLUTE_MS,
  RENEW_AFTER_MS,
} = require('../src/auth');
const crypto = require('node:crypto');
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
function tokenAgedBy(ms, secret, id, createdAt) {
  const real = Date.now;
  Date.now = () => real() - ms;
  try {
    return makeToken(id, secret, createdAt);
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

const DAYS = 24 * HOURS;

test('a session ends 30 days after sign-in, however often it was renewed', () => {
  assert.equal(SESSION_ABSOLUTE_MS, 30 * DAYS);
  const secret = authOn();
  const signedIn = Date.now() - SESSION_ABSOLUTE_MS - 1000;
  const justRenewed = makeToken(newSessionId(), secret, signedIn);
  assert.equal(readToken(justRenewed, secret), null);
  const { req, res } = reqRes(tokenAgedBy(RENEW_AFTER_MS + 1000, secret, newSessionId(), signedIn));
  assert.equal(refreshSession(req, res), false);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('renewal keeps the sign-in time', () => {
  const secret = authOn();
  const signedIn = Date.now() - 3 * DAYS;
  const { req, res } = reqRes(tokenAgedBy(RENEW_AFTER_MS + 1000, secret, newSessionId(), signedIn));
  assert.equal(refreshSession(req, res), true);
  const issued = /ds=([^;]+)/.exec(res.headers['set-cookie'])[1];
  assert.equal(readToken(issued, secret).createdAt, signedIn);
});

test('a renewal near the end is not given more time than the session has left', () => {
  const secret = authOn();
  const signedIn = Date.now() - SESSION_ABSOLUTE_MS + HOURS;
  const { req, res } = reqRes(tokenAgedBy(RENEW_AFTER_MS + 1000, secret, newSessionId(), signedIn));
  assert.equal(refreshSession(req, res), true);
  const maxAge = Number(/Max-Age=(\d+)/.exec(res.headers['set-cookie'])[1]);
  assert.ok(maxAge <= HOURS / 1000 && maxAge > HOURS / 1000 - 5, `Max-Age was ${maxAge}`);
});

/* Built the way the release before the sign-in time signed it. */
test('a token from before the sign-in time still verifies and renews into the new format', () => {
  const secret = authOn();
  const id = newSessionId();
  const payload = `${id}.${Date.now() - RENEW_AFTER_MS - 1000}`;
  const legacy = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  assert.equal(verifyToken(legacy, secret), id);
  const { req, res } = reqRes(legacy);
  assert.equal(refreshSession(req, res), true);
  const issued = /ds=([^;]+)/.exec(res.headers['set-cookie'])[1];
  assert.equal(issued.split('.').length, 4);
  assert.equal(readToken(issued, secret).sessionId, id);
});

test('a token with a tampered sign-in time is refused', () => {
  const secret = newSessionSecret();
  const [id, createdAt, iat, sig] = makeToken(newSessionId(), secret).split('.');
  assert.equal(readToken([id, Number(createdAt) + 1, iat, sig].join('.'), secret), null);
});
