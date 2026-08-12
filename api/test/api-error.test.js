const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIND, ApiError, classify, errorBody } = require('../src/api-error');

/* ── classify ─────────────────────────────────────────────────────────────── */

test('a socket error is classified as network and carries its errno', () => {
  const e = Object.assign(new Error('connect ECONNREFUSED 172.17.0.2:8181'), { code: 'ECONNREFUSED' });
  assert.deepEqual(classify(e), { kind: KIND.NETWORK, detail: { code: 'ECONNREFUSED' } });
});

test('a DNS failure is classified as network', () => {
  const e = Object.assign(new Error('getaddrinfo ENOTFOUND nope.invalid'), { code: 'ENOTFOUND' });
  assert.equal(classify(e).kind, KIND.NETWORK);
});

test('a TLS failure is network, with the certificate code in detail', () => {
  const e = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
  assert.deepEqual(classify(e), { kind: KIND.NETWORK, detail: { code: 'CERT_HAS_EXPIRED' } });
});

test('the fetch deadline is classified as timeout', () => {
  assert.equal(classify(new Error('Timed out')).kind, KIND.TIMEOUT);
  const e = Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' });
  assert.equal(classify(e).kind, KIND.TIMEOUT);
});

test('an SSRF block is classified as blocked, by name not instanceof', () => {
  const { SsrfBlockedError } = require('../src/proxy');
  const e = new SsrfBlockedError('Blocked: localhost is a private address.');
  assert.equal(classify(e).kind, KIND.BLOCKED);
  assert.equal(e.status, 403);
});

test('a malformed request body is classified as invalid', () => {
  let thrown;
  try {
    JSON.parse('{nope');
  } catch (e) {
    thrown = e;
  }
  assert.equal(classify(thrown).kind, KIND.INVALID);
});

test('an unrecognised failure falls back to internal, it does not throw', () => {
  assert.equal(classify(new Error('something odd')).kind, KIND.INTERNAL);
  assert.equal(classify(null).kind, KIND.INTERNAL);
  assert.equal(classify(undefined).kind, KIND.INTERNAL);
  assert.equal(classify('a bare string').kind, KIND.INTERNAL);
});

test('an explicit kind on the error wins over inference', () => {
  const e = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:80'), {
    code: 'ECONNREFUSED',
    kind: KIND.BLOCKED,
  });
  assert.equal(classify(e).kind, KIND.BLOCKED);
});

test('a kind that is not in the vocabulary is ignored, not passed through', () => {
  const e = Object.assign(new Error('x'), { kind: 'wat' });
  assert.equal(classify(e).kind, KIND.INTERNAL);
});

test('ApiError carries kind, status and detail', () => {
  const e = new ApiError('nope', { kind: KIND.UPSTREAM, status: 502, detail: { status: 401 } });
  assert.deepEqual(classify(e), { kind: KIND.UPSTREAM, detail: { status: 401 } });
  assert.equal(e.status, 502);
});

/* ── errorBody ────────────────────────────────────────────────────────────── */

test('errorBody replaces the original message with one chosen by kind', () => {
  const e = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:80'), { code: 'ECONNREFUSED' });
  assert.deepEqual(errorBody(e), {
    error: 'Could not reach the service.',
    kind: KIND.NETWORK,
    detail: { code: 'ECONNREFUSED' },
  });
});

test('errorBody omits detail entirely rather than sending an empty object', () => {
  const body = errorBody(new Error('Timed out'));
  assert.equal(body.kind, KIND.TIMEOUT);
  assert.ok(!('detail' in body), 'detail should be absent, not {}');
});
