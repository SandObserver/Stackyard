/* The frontend half of the structured error contract. ui/js/admin-error.js
   decides what the admin UI shows, keying off the `code` the API sends rather
   than any words inside its message.

   The backend half lives in api/test/api-error.test.js. The vocabulary check
   below is the seam between them: a kind added on one side and forgotten on the
   other fails here rather than shipping.

   Assertions are about keys. The API's `error` prose is written for a log and
   is never rendered, so nothing here asserts on English. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { badgeErrorAdvice, optionsErrorAdvice, readError, KIND, TONE } from '../js/admin-error.js';

/* api/src/api-error.js is CommonJS (the server half of the codebase is), so it
   needs createRequire rather than a plain import. */
const require = createRequire(import.meta.url);
const { KINDS } = require('../../api/src/api-error.js');

const en = JSON.parse(fs.readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8'));
const lookup = key => key.split('.').reduce((o, part) => (o == null ? o : o[part]), en);

test('frontend and backend agree on the exact set of kinds', () => {
  assert.deepEqual(Object.values(KIND).sort(), [...KINDS].sort());
});

/* A key that does not resolve renders as the key itself, which is how an
   untranslated string reaches a user. A placeholder mismatch drops the variable
   or shows the brace. */
test('every advice the module can produce names a real key with matching placeholders', () => {
  const cases = [
    ...KINDS.map(kind => ({ kind })),
    { kind: KIND.AUTH },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 401 } },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 403 } },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 404 } },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 405 } },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 407 } },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 503 } },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 418 } },
    { kind: KIND.UPSTREAM, code: 'upstream.redirect', detail: { status: 301 } },
    { kind: KIND.BLOCKED, code: 'blocked.private-address' },
    { kind: KIND.INVALID, code: 'invalid.retype' },
    { kind: KIND.NETWORK, code: 'network.tls-ignored' },
    { kind: KIND.NETWORK, code: 'network.tls-untrusted' },
    { kind: 'quota-exceeded', code: 'quota-exceeded.hourly' },
    new Error('something odd'),
    null,
  ];
  for (const e of cases) {
    for (const advice of [badgeErrorAdvice(e), optionsErrorAdvice(e)]) {
      const where = `${JSON.stringify(e)} -> ${JSON.stringify(advice)}`;
      const value = lookup(advice.key);
      assert.equal(typeof value, 'string', `no such key: ${where}`);
      const wanted = (value.match(/\{(\w+)\}/g) || []).sort();
      const given = Object.keys(advice.vars || {})
        .map(k => `{${k}}`)
        .sort();
      assert.deepEqual(
        given.filter(v => wanted.includes(v)),
        wanted,
        `placeholder not filled: ${where}`,
      );
    }
  }
});

test('an unknown kind degrades to internal and an absent code to the kind', () => {
  assert.deepEqual(readError({ kind: 'quota-exceeded' }), {
    kind: KIND.INTERNAL,
    code: KIND.INTERNAL,
    detail: null,
  });
  assert.equal(readError({ kind: KIND.BLOCKED }).code, KIND.BLOCKED, 'a missing code falls back to the kind');
});

test('a code this frontend has never heard of still gets its kind s wording', () => {
  const a = badgeErrorAdvice({ kind: KIND.UPSTREAM, code: 'upstream.rate-limited' });
  assert.equal(a.key, 'adminError.genericUpstream');
  assert.equal(a.tone, TONE.ERROR);
});

test('an error with no kind at all does not throw', () => {
  const a = badgeErrorAdvice(new Error('something odd'));
  assert.equal(a.key, 'adminError.genericInternal');
  assert.equal(a.openAuth, false);
});

test('a network failure and a timeout both suggest the container name', () => {
  for (const kind of [KIND.NETWORK, KIND.TIMEOUT]) {
    const a = badgeErrorAdvice({ kind });
    assert.equal(a.key, 'adminError.unreachable');
    assert.equal(a.tone, TONE.WARN);
    assert.equal(a.openAuth, false);
  }
});

test('an upstream 401 or 403 opens the Authentication section', () => {
  for (const status of [401, 403]) {
    const a = badgeErrorAdvice({ kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status } });
    assert.equal(a.openAuth, true, String(status));
    assert.equal(a.key, 'adminError.authRequired');
    assert.equal(a.tone, TONE.WARN);
  }
});

test('an upstream 500 does not suggest credentials', () => {
  const a = badgeErrorAdvice({ kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 500 } });
  assert.equal(a.openAuth, false);
  assert.equal(a.key, 'adminError.statusServer');
});

/* Matching on 'Unauthori' caught this project's own session-expiry error, so an
   expired admin session advised the user to add an upstream API key. */
test('our own expired session does not offer an upstream API key', () => {
  const a = badgeErrorAdvice({ kind: KIND.AUTH });
  assert.equal(a.openAuth, false, 'must not tick the Authentication toggle');
  assert.equal(a.sessionExpired, true);
  assert.equal(a.key, 'adminError.sessionExpired');
});

/* A private address is what most homelab installs point a badge at, and one
   setting unblocks it. It is a fixable setting, not a hard error. */
test('a blocked private address names the setting that allows it', () => {
  const a = badgeErrorAdvice({ kind: KIND.BLOCKED, code: 'blocked.private-address' });
  assert.equal(a.key, 'adminError.privateAddress');
  assert.equal(a.tone, TONE.WARN);
  assert.equal(a.openAuth, false);
  assert.equal(a.sessionExpired, false);
});

test('a block with no reason code gets no private-address advice', () => {
  const a = badgeErrorAdvice({ kind: KIND.BLOCKED });
  assert.equal(a.key, 'adminError.genericBlocked');
  assert.equal(a.tone, TONE.ERROR);
});

test('the widget options Fetch gives the same wording and tone as the badge test', () => {
  const cases = [
    { kind: KIND.BLOCKED, code: 'blocked.private-address' },
    { kind: KIND.NETWORK },
    { kind: KIND.INVALID, code: 'invalid.retype' },
    { kind: KIND.UPSTREAM, code: 'upstream.status', detail: { status: 404 } },
  ];
  for (const e of cases) {
    const badge = badgeErrorAdvice(e);
    const options = optionsErrorAdvice(e);
    assert.equal(options.key, badge.key, JSON.stringify(e));
    assert.equal(options.tone, badge.tone, JSON.stringify(e));
    assert.deepEqual(options.vars, badge.vars, JSON.stringify(e));
  }
});

/* `error` is written for a log and is never translated. Advice that carried it
   would put English on a translated screen. */
test('advice never carries the server s message', () => {
  const e = { kind: KIND.BLOCKED, code: 'blocked.private-address', error: 'The request was blocked.' };
  for (const a of [badgeErrorAdvice(e), optionsErrorAdvice(e)]) {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(a).sort());
    for (const field of ['error', 'message', 'raw', 'msg']) {
      assert.equal(a[field], undefined, `${field} must not travel with advice`);
    }
  }
});
