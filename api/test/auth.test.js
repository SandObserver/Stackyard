process.env.CONFIG_PATH = '/tmp/stackyard-auth-test-nonexistent.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  makeToken, verifyToken, hashPassword, verifyPassword,
  parseCookies, rateLimit, checkRateLimit, recordFailedAttempt, clearAttempts,
} = require('../src/auth');

test('makeToken / verifyToken round-trips a session id', () => {
  const token = makeToken('session-1', 'secret-a');
  assert.equal(verifyToken(token, 'secret-a'), 'session-1');
});

test('verifyToken rejects a wrong secret', () => {
  const token = makeToken('session-1', 'secret-a');
  assert.equal(verifyToken(token, 'secret-b'), null);
});

test('verifyToken rejects a tampered signature', () => {
  const token = makeToken('session-1', 'secret-a');
  const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
  assert.equal(verifyToken(tampered, 'secret-a'), null);
});

test('verifyToken rejects a malformed token', () => {
  assert.equal(verifyToken('no-dot-here', 'secret-a'), null);
});

test('verifyPassword accepts the correct password', async () => {
  const hash = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horse', hash), true);
});

test('verifyPassword rejects a wrong password', async () => {
  const hash = await hashPassword('correct horse');
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('verifyPassword rejects a malformed hash', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-valid-hash'), false);
});

test('parseCookies parses the session cookie', () => {
  const c = parseCookies({ headers: { cookie: 'ds=abc123; other=x' } });
  assert.equal(c.ds, 'abc123');
  assert.equal(c.other, 'x');
});

test('rateLimit allows up to the max then blocks', () => {
  const ip = '203.0.113.1';
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(ip, 'k', 3, 60_000), null, `call ${i + 1} should pass`);
  assert.ok(rateLimit(ip, 'k', 3, 60_000), '4th call should be blocked');
});

test('login attempts lock out after the limit and reset on clear', () => {
  const ip = '203.0.113.2';
  for (let i = 0; i < 5; i++) recordFailedAttempt(ip);
  assert.ok(checkRateLimit(ip), 'should be locked out after 5 attempts');
  clearAttempts(ip);
  assert.equal(checkRateLimit(ip), null, 'clearAttempts should reset the lockout');
});
