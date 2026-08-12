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

/* ── switching off discards the password ──────────────────────────────────── */

/* A disabled password that stays on disk is its own dead end: set-password
   refuses while a hash exists unless the caller holds a session, and no session
   can be obtained with auth off, so a forgotten password could only be replaced
   by hand-editing the config. */

test('switching auth off clears the stored password and secret', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);

  assert.equal(
    (await req('POST', '/api/auth/toggle', { enabled: false }, 'ds=' + makeToken('s1', SECRET))).status,
    200,
  );

  const stored = loadConfig().settings.auth;
  assert.equal(stored.passwordHash, undefined);
  assert.equal(stored.secret, undefined);
  assert.equal((await req('GET', '/api/auth/check')).body.passwordSet, false);
});

test('an orphaned hash left by an earlier version is cleared on the next switch off', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: false, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);

  assert.equal((await req('POST', '/api/auth/toggle', { enabled: true })).status, 200, 'the old password still works');
  /* Auth is in force from here, so switching back off goes through the gate the
     same way the admin would, with a session. The stored secret is untouched by
     the enable, so a token signed with it is valid. */
  const cookie = 'ds=' + makeToken('s1', SECRET);
  assert.equal((await req('POST', '/api/auth/toggle', { enabled: false }, cookie)).status, 200);
  assert.equal(loadConfig().settings.auth.passwordHash, undefined);

  const r = await req('POST', '/api/auth/toggle', { enabled: true });
  assert.equal(r.status, 400, 're-enabling now needs a new password rather than reviving the cleared one');
  assert.match(r.body.error, /password/i);
});

test('a session token from before the switch off is not honoured again', async () => {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') };
  saveConfig(cfg);
  const cookie = 'ds=' + makeToken('s1', SECRET);

  await req('POST', '/api/auth/toggle', { enabled: false }, cookie);
  await req('POST', '/api/auth/set-password', { password: 'a-brand-new-one' });

  assert.equal((await req('GET', '/api/config', null, cookie)).status, 401);
});

test('switching off with no password stored is not an error', async () => {
  const r = await req('POST', '/api/auth/toggle', { enabled: false });
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

/* ── the switch only answers to a real true or false ──────────────────────── */

for (const [label, body] of [
  ['an empty body', {}],
  ['a null flag', { enabled: null }],
  ['a zero', { enabled: 0 }],
  ['a string', { enabled: 'false' }],
  ['the string "true"', { enabled: 'true' }],
  ['a missing key with other fields', { enable: false }],
]) {
  test(`${label} changes nothing rather than clearing the password`, async () => {
    const cfg = loadConfig();
    const hash = await hashPassword('correct-horse');
    cfg.settings.auth = { enabled: true, secret: SECRET, passwordHash: hash };
    saveConfig(cfg);

    const r = await req('POST', '/api/auth/toggle', body, 'ds=' + makeToken('s1', SECRET));
    assert.equal(r.status, 400, 'refused');

    const stored = loadConfig().settings.auth;
    assert.equal(stored.passwordHash, hash, 'the password survives');
    assert.equal(stored.secret, SECRET, 'the secret survives');
    assert.equal(stored.enabled, true, 'the flag is untouched');
  });
}
