const { test } = require('node:test');
const assert = require('node:assert/strict');

const { errorBody, safeMessage, SAFE_MESSAGES, KIND, KINDS } = require('../src/api-error');

/* Things a real failure names that a browser has no business seeing. */
const REVEALING = [
  /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/ /* an IP address */,
  /\b[a-z0-9-]+\.(?:lan|local|internal|home)\b/i /* an internal hostname */,
  /\/(?:data|app|etc|home|root|var)\// /* a server path */,
  /\bE[A-Z]{3,}\b/ /* a raw errno in prose */,
];

const REAL_ERRORS = [
  Object.assign(new Error('connect ECONNREFUSED 172.17.0.2:8181'), { code: 'ECONNREFUSED' }),
  Object.assign(new Error('getaddrinfo ENOTFOUND nas.internal.lan'), { code: 'ENOTFOUND' }),
  Object.assign(new Error('connect ETIMEDOUT 10.0.0.4:443'), { code: 'ETIMEDOUT' }),
  new Error("ENOENT: no such file or directory, open '/data/apps.json'"),
  new Error("EACCES: permission denied, open '/data/apps.json'"),
  Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
  new Error('Blocked: 192.168.1.5 is a private address.'),
  new Error('Blocked: nas.lan resolves to private IP 10.0.0.4.'),
];

/* ── nothing internal reaches the browser ─────────────────────────────────── */

test('no real error message reaches the response', () => {
  for (const e of REAL_ERRORS) {
    const body = errorBody(e);
    assert.notEqual(body.error, e.message, `the original text was returned for: ${e.message}`);
    for (const pattern of REVEALING) {
      assert.doesNotMatch(body.error, pattern, `${pattern} leaked via: ${e.message}`);
    }
  }
});

/* The SSRF case specifically: naming the address confirms what was probed. */
test('a blocked request does not name what it was blocked from reaching', () => {
  const body = errorBody(new Error('Blocked: 192.168.1.5 is a private address.'));
  assert.doesNotMatch(body.error, /192\.168/);
});

test('every message the API can produce is one of the composed set', () => {
  const allowed = new Set(Object.values(SAFE_MESSAGES));
  for (const e of REAL_ERRORS) {
    assert.ok(allowed.has(errorBody(e).error), `${errorBody(e).error} is not a composed message`);
  }
});

/* ── the UI still has what it needs ───────────────────────────────────────── */

/* The kind is what the frontend branches on, so it must survive unchanged. */
test('the kind is unaffected', () => {
  assert.equal(errorBody(REAL_ERRORS[0]).kind, KIND.NETWORK);
  assert.equal(errorBody(REAL_ERRORS[3]).kind, KIND.INTERNAL);
});

test('every kind has a message of its own', () => {
  for (const kind of KINDS) {
    assert.ok(SAFE_MESSAGES[kind], `${kind} has no message`);
    assert.equal(safeMessage(kind), SAFE_MESSAGES[kind]);
  }
});

test('an unknown kind degrades rather than returning nothing', () => {
  assert.equal(safeMessage('something-new'), SAFE_MESSAGES[KIND.INTERNAL]);
  assert.ok(safeMessage(undefined));
});

/* detail carries server-derived values only: a status code or an errno, never
   anything naming a host. It is what lets the UI say something specific. */
test('detail still carries the code', () => {
  assert.deepEqual(errorBody(REAL_ERRORS[0]).detail, { code: 'ECONNREFUSED' });
});

/* ── deliberate messages survive ──────────────────────────────────────────── */

/* An explicit override is text the code chose and can vouch for. Composing must
   not throw those away, or every validation message becomes "not valid". */
test('a message the code chose is kept', () => {
  const body = errorBody(new Error('connect ECONNREFUSED 1.2.3.4:80'), {
    error: 'Set a password before turning authentication on.',
    kind: KIND.INVALID,
  });
  assert.equal(body.error, 'Set a password before turning authentication on.');
});

test('an override does not have to supply a kind', () => {
  assert.equal(errorBody(new Error('x'), { error: 'Chosen text.' }).error, 'Chosen text.');
});

/* ── a ping is returned to the browser directly ───────────────────────────── */

/* /api/ping returns the ping result as-is, so it never passes through
   errorBody and had to be handled at its own source. */
test('a failed ping does not name the host it could not reach', async () => {
  process.env.ALLOW_PRIVATE_IPS = 'true';
  const { pingUnchecked } = require('../src/proxy');

  const r = await pingUnchecked('http://127.0.0.1:59999/', 1000);
  assert.equal(r.ok, false);
  for (const pattern of REVEALING) {
    assert.doesNotMatch(r.error, pattern, `${pattern} leaked via a ping: ${r.error}`);
  }
  assert.equal(r.code, 'ECONNREFUSED', 'the code is kept, since it names no address');
});

test('a ping to a host that does not exist says so without naming it', async () => {
  const { pingUnchecked } = require('../src/proxy');
  const r = await pingUnchecked('http://stackyard-nx-host.invalid/', 3000);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /stackyard-nx-host/);
});
