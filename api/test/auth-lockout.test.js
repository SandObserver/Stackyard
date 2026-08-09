/* Regression tests for P2-2: enabling auth with no password locked the install.

   /api/auth/toggle accepted enabled:true with no password stored. After that
   every route was gated except login, health and the auth check. Login refused
   because there was nothing to check against, and its message told the user to
   go to Admin, which was now behind the gate. Setting a password and switching
   auth back off were both gated too, so there was no way back in over HTTP: the
   only fix was editing apps.json on the data volume.

   Two halves here. The toggle now refuses to create that state, and an install
   already in it is treated as not authenticated, so the admin is reachable and a
   password can be set. Nothing is rewritten on disk; the stored flag is simply
   not honoured on its own, and starts being honoured again the moment a password
   exists. */

const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('lockout');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, saveConfig } = require('../src/config');
const { hashPassword, authActive, makeToken } = require('../src/auth');

const SECRET = 'a'.repeat(64);
let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});
beforeEach(() => {
  saveConfig({ items: [], settings: {} });
});

function req(method, pathname, body, cookie) {
  const data = body ? JSON.stringify(body) : '';
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Origin: base,
          Cookie: cookie || '',
        },
      },
      res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(b);
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    r.end(data);
  });
}

/* Put an install into the state that used to be a dead end. */
function saveLockedState() {
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: SECRET } } });
}

/* ── authActive ───────────────────────────────────────────────────────────── */

test('auth counts as active only with both the flag and a password', () => {
  assert.equal(authActive({ settings: { auth: { enabled: true, passwordHash: 'x' } } }), true);
  assert.equal(authActive({ settings: { auth: { enabled: true } } }), false);
  assert.equal(authActive({ settings: { auth: { enabled: false, passwordHash: 'x' } } }), false);
  assert.equal(authActive({ settings: {} }), false);
  assert.equal(authActive({}), false);
  assert.equal(authActive(null), false);
});

/* ── the toggle refuses to create the trap ────────────────────────────────── */

test('auth cannot be switched on with no password', async () => {
  const r = await req('POST', '/api/auth/toggle', { enabled: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /password/i);
  assert.ok(!loadConfig().settings.auth?.enabled, 'the flag must not have been written');
});

test('auth can be switched on once a password exists', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: false, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);

  const r = await req('POST', '/api/auth/toggle', { enabled: true });
  assert.equal(r.status, 200);
  assert.equal(loadConfig().settings.auth.enabled, true);
});

test('auth can always be switched off', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);

  const r = await req('POST', '/api/auth/toggle', { enabled: false }, 'ds=' + makeToken('s1', SECRET));
  assert.equal(r.status, 200);
  assert.equal(loadConfig().settings.auth.enabled, false);
});

/* ── an install already locked recovers itself ────────────────────────────── */

test('a locked install reports auth as off, matching how it behaves', async () => {
  saveLockedState();
  const r = await req('GET', '/api/auth/check');
  assert.equal(r.body.enabled, false);
  assert.equal(r.body.passwordSet, false);
});

test('a locked install lets the admin back in', async () => {
  saveLockedState();
  assert.equal((await req('GET', '/api/config')).status, 200, 'admin must be reachable');
});

test('a locked install accepts a password, and auth then takes effect', async () => {
  saveLockedState();
  assert.equal((await req('POST', '/api/auth/set-password', { password: 'correct-horse' })).status, 200);
  assert.equal((await req('GET', '/api/config')).status, 401, 'auth should apply again immediately');
});

test('recovery does not rewrite the stored flag', async () => {
  saveLockedState();
  await req('GET', '/api/config');
  await req('GET', '/api/auth/check');
  assert.equal(loadConfig().settings.auth.enabled, true, 'nothing on disk should change on its own');
});

/* The state is unusable either way, so treating it as off grants nothing that
   was previously withheld: there is no password to present and no session to
   verify against. This pins that a real password still gates everything. */
test('treating the locked state as off is not a way past a real password', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);
  assert.equal((await req('GET', '/api/config')).status, 401);
  assert.equal((await req('POST', '/api/auth/toggle', { enabled: false })).status, 401);
});

/* ── login ────────────────────────────────────────────────────────────────── */

test('login on a locked install passes rather than giving impossible advice', async () => {
  saveLockedState();
  const r = await req('POST', '/api/auth/login', { password: 'anything' });
  assert.equal(r.status, 200, 'auth is not in force, so there is nothing to log in to');
});

test('login still refuses a wrong password when one is set', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);
  assert.equal((await req('POST', '/api/auth/login', { password: 'nope' })).status, 401);
  assert.equal((await req('POST', '/api/auth/login', { password: 'correct-horse' })).status, 200);
});
