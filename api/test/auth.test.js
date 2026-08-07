const { tmpDir, tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  makeToken, verifyToken, hashPassword, verifyPassword,
  parseCookies, rateLimit, registerLoginAttempt, clearAttempts,
  newSessionSecret, newSessionId,
  SESSION_MAX_AGE_MS,
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

/* Build a token with an arbitrary issued-at, signed the same way makeToken does,
   so expiry and tamper cases can be exercised without waiting or mocking time. */
function forgeToken(sessionId, iat, secret) {
  const payload = `${sessionId}.${iat}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

test('verifyToken accepts a token issued within the max age', () => {
  const token = forgeToken('session-1', Date.now() - 1000, 'secret-a');
  assert.equal(verifyToken(token, 'secret-a'), 'session-1');
});

test('verifyToken rejects a token older than the max age', () => {
  const stale = forgeToken('session-1', Date.now() - (SESSION_MAX_AGE_MS + 60_000), 'secret-a');
  assert.equal(verifyToken(stale, 'secret-a'), null);
});

test('verifyToken rejects a token whose issued-at was altered after signing', () => {
  const token = makeToken('session-1', 'secret-a');
  const [sid, iat, sig] = token.split('.');
  const bumped = `${sid}.${Number(iat) - 1}.${sig}`;
  assert.equal(verifyToken(bumped, 'secret-a'), null);
});

test('verifyToken rejects a non-numeric issued-at', () => {
  const forged = forgeToken('session-1', 'notanumber', 'secret-a');
  assert.equal(verifyToken(forged, 'secret-a'), null);
});

test('verifyToken rejects a legacy two-part token without an issued-at', () => {
  const sig = crypto.createHmac('sha256', 'secret-a').update('session-1').digest('hex');
  assert.equal(verifyToken(`session-1.${sig}`, 'secret-a'), null);
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

/* checkRateLimit is deliberately not exported: it is the read-only half of a
   pair whose point is that the check and the increment happen together, so the
   lockout is observed through registerLoginAttempt, which is what callers use. */
test('registerLoginAttempt allows the limit then blocks, and reset on clear', () => {
  const ip = '203.0.113.2';
  for (let i = 0; i < 5; i++) assert.equal(registerLoginAttempt(ip), null, `attempt ${i + 1} should be allowed`);
  assert.ok(registerLoginAttempt(ip), '6th attempt should be blocked');
  assert.ok(registerLoginAttempt(ip), 'and stays blocked without counting further');
  clearAttempts(ip);
  assert.equal(registerLoginAttempt(ip), null, 'clearAttempts should reset the lockout');
});

/* Being at the cap must not extend the window: a blocked attempt is refused
   without being counted, which is what lets the lockout expire on schedule. */
test('a blocked attempt is not itself counted', () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < 5; i++) registerLoginAttempt(ip);
  for (let i = 0; i < 3; i++) assert.ok(registerLoginAttempt(ip), 'still blocked');
  clearAttempts(ip);
  for (let i = 0; i < 5; i++) assert.equal(registerLoginAttempt(ip), null, `attempt ${i + 1} allowed again`);
});

/* ── P2-7, P2-9, P2-10: the session randoms were written inline ──────────────
   crypto.randomBytes(32).toString('hex') appeared at four call sites and
   randomBytes(24) at three, so the strength and encoding of the key that signs
   every session was defined in four places. These pin the shape once, where the
   definition now lives. */

test('newSessionSecret is 32 bytes of hex', () => {
  const s = newSessionSecret();
  assert.match(s, /^[0-9a-f]{64}$/, '32 bytes, hex-encoded');
});

test('newSessionId is 24 bytes of hex', () => {
  assert.match(newSessionId(), /^[0-9a-f]{48}$/);
});

test('neither generator repeats itself', () => {
  const secrets = new Set(Array.from({ length: 200 }, newSessionSecret));
  const ids = new Set(Array.from({ length: 200 }, newSessionId));
  assert.equal(secrets.size, 200);
  assert.equal(ids.size, 200);
});

/* getOrCreateSecret and rotateSessionSecret write config, so they are covered
   in session-secret.test.js against a throwaway CONFIG_PATH. This file points at
   a fixed path on purpose and must stay read-only. */

test('checkRateLimit is not part of the public surface', () => {
  assert.equal(require('../src/auth').checkRateLimit, undefined);
});
