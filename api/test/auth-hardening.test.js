/* Regression tests for P2-1 and P5-2, which are one chain.

   verifyPassword fed the stored hash straight to timingSafeEqual.
   Buffer.from(x, 'hex') silently drops anything that is not a hex pair, so a
   malformed stored hash produced a short buffer and timingSafeEqual threw on the
   length mismatch. That throw happened inside the scrypt callback, on a later
   tick, where the surrounding Promise could not see it: not catchable by await,
   it escaped as an uncaughtException and killed the process. With no restart,
   the API stayed down.

   The way in was the config write path. It merged settings.auth field by field
   and only when auth already existed, so before a password was ever set an
   unauthenticated caller could POST a config carrying its own passwordHash.

   Fixing only the crash would have left the injection open, so both are here. */

const path = require('node:path');

const { tmpDir, tmpPath } = require('../test-support/tmp');
const _tmp = tmpDir('auth');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, saveConfig } = require('../src/config');
const { hashPassword, verifyPassword, makeToken } = require('../src/auth');

/* ── verifyPassword ───────────────────────────────────────────────────────── */

test('a correct password still verifies', async () => {
  assert.equal(await verifyPassword('correct-horse', await hashPassword('correct-horse')), true);
});

test('a wrong password does not verify', async () => {
  assert.equal(await verifyPassword('nope', await hashPassword('correct-horse')), false);
});

/* The finding. Each of these used to reach timingSafeEqual with a buffer of the
   wrong length and take the process down. */
test('a malformed stored hash resolves false instead of crashing', async () => {
  const cases = [
    'somesalt:not-valid-hex',
    'somesalt:' + 'a'.repeat(127),  /* odd length, one byte short after decode */
    'somesalt:' + 'a'.repeat(130),  /* too long */
    'somesalt:',
    'zz:' + 'a'.repeat(128),        /* non-hex salt */
    ':' + 'a'.repeat(128),
    'nocolon',
    '',
  ];
  for (const h of cases) {
    assert.equal(await verifyPassword('anything', h), false, `should be false for ${JSON.stringify(h)}`);
  }
});

test('verifyPassword tolerates a missing or non-string hash', async () => {
  for (const h of [null, undefined, 0, {}, []]) {
    assert.equal(await verifyPassword('anything', h), false);
  }
});

/* The throw was uncatchable because it happened on a later tick. If that ever
   regresses, the assertions above would not fail, the whole run would die. This
   makes the property explicit: nothing escapes to the process. */
test('a malformed hash raises no uncaught exception', async () => {
  const seen = [];
  const onErr = e => seen.push(e);
  process.on('uncaughtException', onErr);
  try {
    await verifyPassword('anything', 'somesalt:not-valid-hex');
    await new Promise(r => setTimeout(r, 50)); /* let a stray callback land */
  } finally {
    process.off('uncaughtException', onErr);
  }
  assert.deepEqual(seen, []);
});

/* ── the config write path ────────────────────────────────────────────────── */

let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise(r => { server.closeAllConnections?.(); server.close(r); }); });

beforeEach(() => { saveConfig({ items: [], settings: {} }); });

/* Once auth is enabled the config route requires a session, so these tests must
   send one. Without it the write 401s and the assertions below pass for the
   wrong reason. */
function sessionCookie() {
  const secret = loadConfig().settings?.auth?.secret;
  return secret ? 'ds=' + makeToken('test-session', secret) : '';
}

function post(pathname, body, opts = {}) {
  const data = JSON.stringify(body);
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Origin: base,
        Cookie: opts.cookie || '',
      },
    }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    r.end(data);
  });
}

/* The way in: no password set yet, so nothing required a session. */
test('a config write cannot plant a password hash before one is set', async () => {
  const r = await post('/api/config', {
    items: [],
    settings: { auth: { enabled: true, passwordHash: 'x:zz', secret: 'attacker-chosen' } },
  });
  assert.equal(r.status, 200, 'the write itself is still accepted');
  assert.equal(loadConfig().settings.auth, undefined, 'but settings.auth must not have been created');
});

test('a config write cannot replace an existing password hash', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, passwordHash: await hashPassword('correct-horse'), secret: 'real-secret' };
  saveConfig(cfg);

  const r = await post('/api/config', {
    items: [],
    settings: { auth: { enabled: false, passwordHash: 'x:zz', secret: 'attacker-chosen' } },
  }, { cookie: sessionCookie() });
  assert.equal(r.status, 200, 'the write must actually be accepted, or this proves nothing');

  const after = loadConfig().settings.auth;
  assert.equal(after.secret, 'real-secret');
  assert.equal(after.enabled, true, 'auth must not be switched off through a config write');
  assert.equal(await verifyPassword('correct-horse', after.passwordHash), true);
});

/* A field added to settings.auth later must be covered without anyone
   remembering to update the write path. */
test('a config write cannot add a new field to settings.auth', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: 'real-secret' };
  saveConfig(cfg);

  const r = await post('/api/config', {
    items: [],
    settings: { auth: { enabled: true, secret: 'real-secret', somethingNew: 'injected' } },
  }, { cookie: sessionCookie() });
  assert.equal(r.status, 200, 'the write must actually be accepted, or this proves nothing');
  assert.ok(!('somethingNew' in loadConfig().settings.auth));
});

test('an ordinary config write is unaffected', async () => {
  const r = await post('/api/config', { items: [{ id: 'a1', type: 'app', name: 'App' }], settings: { language: 'en' } });
  assert.equal(r.status, 200);
  const cfg = loadConfig();
  assert.equal(cfg.settings.language, 'en');
  assert.ok(cfg.items.some(i => i.id === 'a1'));
});

/* The chain end to end: plant a hash, then log in. This used to kill the run. */
test('a config write cannot make a later login crash the server', async () => {
  await post('/api/config', { items: [], settings: { auth: { enabled: true, passwordHash: 'x:zz' } } });
  const r = await post('/api/auth/login', { password: 'anything' });
  assert.ok(r.status === 200 || r.status === 401, `unexpected status ${r.status}`);
});
