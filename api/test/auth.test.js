const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  makeToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  parseCookies,
  rateLimit,
  registerLoginAttempt,
  clearAttempts,
  newSessionSecret,
  newSessionId,
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

/* There is no way to ask about the limit without counting the attempt: that
   split is the check-then-increment race, so the lockout is observed through
   registerLoginAttempt, which is what callers use. */
test('registerLoginAttempt allows the limit then blocks, and reset on clear', () => {
  const ip = '203.0.113.2';
  for (let i = 0; i < 5; i++) assert.equal(registerLoginAttempt(ip), null, `attempt ${i + 1} should be allowed`);
  assert.ok(registerLoginAttempt(ip), '6th attempt should be blocked');
  assert.ok(registerLoginAttempt(ip), 'and stays blocked without counting further');
  clearAttempts(ip);
  assert.equal(registerLoginAttempt(ip), null, 'clearAttempts should reset the lockout');
});

/* ── the counting both limiters share ─────────────────────────────────────────

   The window arithmetic is written once and used by two surfaces, so these are
   the properties neither surface may lose. They are exercised through the two
   public functions rather than the internal counter, since that is what callers
   reach and there is deliberately no way to count without being told the answer.

   The two surfaces are checked against each other where it matters: the same
   sequence of hits has to be allowed or refused identically, whatever the
   wording differs to. */

test('the two surfaces agree on where the cap falls', () => {
  const ip = '203.0.113.20';
  /* Five is the login cap, so the polling limiter is asked for the same. */
  const login = [];
  const poll = [];
  for (let i = 0; i < 7; i++) {
    login.push(registerLoginAttempt(ip) === null);
    poll.push(rateLimit(ip, 'agree', 5, 15 * 60 * 1000) === null);
  }
  assert.deepEqual(poll, login, 'the same hits should be allowed or refused the same way');
  assert.deepEqual(login, [true, true, true, true, true, false, false]);
  clearAttempts(ip);
});

test('each key is counted on its own', () => {
  const a = '203.0.113.21',
    b = '203.0.113.22';
  for (let i = 0; i < 3; i++) rateLimit(a, 'k', 3, 60_000);
  assert.ok(rateLimit(a, 'k', 3, 60_000), 'the exhausted key is refused');
  assert.equal(rateLimit(a, 'other', 3, 60_000), null, 'a different route is unaffected');
  assert.equal(rateLimit(b, 'k', 3, 60_000), null, 'a different client is unaffected');

  for (let i = 0; i < 5; i++) registerLoginAttempt(a);
  assert.ok(registerLoginAttempt(a), 'the locked-out address is refused');
  assert.equal(registerLoginAttempt(b), null, 'another address can still log in');
  clearAttempts(a);
  clearAttempts(b);
});

/* The window opens on the first hit of a series, and that hit counts. A window
   that opened without counting would give every key one free request. */
test('the hit that opens a window is counted', () => {
  const ip = '203.0.113.23';
  assert.equal(rateLimit(ip, 'first', 1, 60_000), null, 'the first is allowed');
  assert.ok(rateLimit(ip, 'first', 1, 60_000), 'and it used the only slot');
});

/* A ceiling of zero has no callers today. It is guarded because the opening of
   a window counts the hit that opened it, so the natural reading of the code
   would hand out one request against a limit that means none. */
test('a ceiling below one refuses everything', () => {
  const ip = '203.0.113.24';
  assert.ok(rateLimit(ip, 'zero', 0, 60_000), 'zero allows nothing');
  assert.ok(rateLimit(ip, 'zero', 0, 60_000), 'and stays that way');
  assert.ok(rateLimit(ip, 'neg', -1, 60_000), 'so does a negative ceiling');
});

test('the wait is reported in the unit each surface uses', () => {
  const ip = '203.0.113.25';
  for (let i = 0; i < 5; i++) registerLoginAttempt(ip);
  assert.match(
    registerLoginAttempt(ip),
    /Try again in 15 minutes\./,
    'a fifteen-minute lockout counted in seconds reads as a stopwatch',
  );
  clearAttempts(ip);

  for (let i = 0; i < 2; i++) rateLimit(ip, 'unit', 2, 60_000);
  assert.match(rateLimit(ip, 'unit', 2, 60_000), /Try again in 60s\./);
});

test('being refused does not push the window out', async () => {
  const ip = '203.0.113.27';
  const WINDOW = 60;
  assert.equal(rateLimit(ip, 'slide', 1, WINDOW), null, 'the first hit opens the window');
  assert.ok(rateLimit(ip, 'slide', 1, WINDOW), 'the second is refused');

  await new Promise(r => setTimeout(r, WINDOW * 0.6));
  assert.ok(rateLimit(ip, 'slide', 1, WINDOW), 'still inside the window, still refused');

  await new Promise(r => setTimeout(r, WINDOW * 0.8));
  assert.equal(
    rateLimit(ip, 'slide', 1, WINDOW),
    null,
    'the window is measured from its first hit, not from the last refusal',
  );
});

/* One minute left reads as "1 minute", not "1 minutes". */
test('the lockout message agrees with itself about the plural', () => {
  const ip = '203.0.113.26';
  for (let i = 0; i < 5; i++) registerLoginAttempt(ip);
  const msg = registerLoginAttempt(ip);
  assert.doesNotMatch(msg, /\b1 minutes\b/);
  clearAttempts(ip);
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

test('nothing exported reads a limit without counting the attempt', () => {
  const mod = require('../src/auth');
  for (const name of ['checkRateLimit', 'peekRateLimit', 'hit']) {
    assert.equal(mod[name], undefined, `${name} would reintroduce the race`);
  }
});
