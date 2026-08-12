const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('revoke'), 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, saveConfig } = require('../src/config');
const { hashPassword, makeToken, verifyToken, rotateSessionSecret } = require('../src/auth');

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

async function enableAuth() {
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, secret: 'a'.repeat(64), passwordHash: await hashPassword('correct-horse') } },
  });
}
beforeEach(() => saveConfig({ items: [], settings: {} }));

function req(method, pathname, cookie) {
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2, Origin: base, Cookie: cookie || '' },
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
          resolve({ status: res.statusCode, body: j, setCookie: res.headers['set-cookie'] || [] });
        });
      },
    );
    r.on('error', reject);
    r.end('{}');
  });
}

const secret = () => loadConfig().settings?.auth?.secret;
const cookieFor = s => 'ds=' + makeToken('session-abc', s);
const tokenFrom = setCookie => (setCookie.find(c => c.startsWith('ds=')) || '').slice(3).split(';')[0];

/* ── the helper ───────────────────────────────────────────────────────────── */

test('rotating changes the secret, so existing tokens stop verifying', async () => {
  await enableAuth();
  const before = secret();
  const token = makeToken('session-abc', before);
  assert.equal(verifyToken(token, before), 'session-abc');

  const after = rotateSessionSecret();
  assert.notEqual(after, before);
  assert.equal(secret(), after, 'the new secret must be stored');
  assert.equal(verifyToken(token, after), null, 'a token signed with the old secret must not verify');
});

test('rotating works even when no auth block exists yet', () => {
  saveConfig({ items: [], settings: {} });
  const s = rotateSessionSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(secret(), s);
});

/* ── the endpoint ─────────────────────────────────────────────────────────── */

test('a session from before the call no longer works', async () => {
  await enableAuth();
  const old = cookieFor(secret());
  assert.equal((await req('GET', '/api/config', old)).status, 200, 'precondition: the session works');

  assert.equal((await req('POST', '/api/auth/revoke-sessions', old)).status, 200);
  assert.equal((await req('GET', '/api/config', old)).status, 401, 'the old session must be dead');
});

test('the caller is handed a working replacement session', async () => {
  await enableAuth();
  const r = await req('POST', '/api/auth/revoke-sessions', cookieFor(secret()));
  const fresh = tokenFrom(r.setCookie);
  assert.ok(fresh, 'the response must set a new session cookie');
  assert.equal(
    (await req('GET', '/api/config', 'ds=' + fresh)).status,
    200,
    'the person who pressed the button must stay signed in',
  );
});

test('the replacement session is a different one, not the old token reissued', async () => {
  await enableAuth();
  const old = cookieFor(secret());
  const r = await req('POST', '/api/auth/revoke-sessions', old);
  assert.notEqual('ds=' + tokenFrom(r.setCookie), old);
});

test('every other device is signed out, not just one', async () => {
  await enableAuth();
  const s = secret();
  const devices = ['a', 'b', 'c'].map(id => 'ds=' + makeToken(`session-${id}`, s));
  for (const d of devices) assert.equal((await req('GET', '/api/config', d)).status, 200);

  await req('POST', '/api/auth/revoke-sessions', devices[0]);
  for (const d of devices) {
    assert.equal((await req('GET', '/api/config', d)).status, 401, `${d} should be signed out`);
  }
});

test('the password is unchanged, which is the point of having this separately', async () => {
  await enableAuth();
  const before = loadConfig().settings.auth.passwordHash;
  await req('POST', '/api/auth/revoke-sessions', cookieFor(secret()));
  assert.equal(loadConfig().settings.auth.passwordHash, before);
});

test('auth stays enabled', async () => {
  await enableAuth();
  await req('POST', '/api/auth/revoke-sessions', cookieFor(secret()));
  assert.equal(loadConfig().settings.auth.enabled, true);
});

/* ── who may call it ──────────────────────────────────────────────────────── */

test('an unauthenticated caller cannot revoke', async () => {
  await enableAuth();
  const before = secret();
  assert.equal((await req('POST', '/api/auth/revoke-sessions', '')).status, 401);
  assert.equal(secret(), before, 'the secret must not have been rotated');
});

test('a cross-origin request cannot revoke', async () => {
  await enableAuth();
  const before = secret();
  const u = new URL(base + '/api/auth/revoke-sessions');
  const r = await new Promise((resolve, reject) => {
    const q = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 2,
          Origin: 'http://evil.example',
          Cookie: cookieFor(before),
        },
      },
      res => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode }));
      },
    );
    q.on('error', reject);
    q.end('{}');
  });
  assert.equal(r.status, 403);
  assert.equal(secret(), before);
});

/* Nothing to revoke, and rotating would only churn the stored secret. */
test('revoking is refused when auth is not enabled', async () => {
  saveConfig({ items: [], settings: {} });
  const r = await req('POST', '/api/auth/revoke-sessions', '');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not enabled/i);
});

test('revoking is refused when auth is on but no password is set', async () => {
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: 'a'.repeat(64) } } });
  const before = secret();
  assert.equal((await req('POST', '/api/auth/revoke-sessions', '')).status, 400);
  assert.equal(secret(), before);
});

/* ── the existing route that rotates as a side effect ─────────────────────── */

test('changing the password still signs other devices out', async () => {
  await enableAuth();
  const old = cookieFor(secret());
  const u = new URL(base + '/api/auth/set-password');
  const data = JSON.stringify({ password: 'a-new-password' });
  await new Promise((resolve, reject) => {
    const q = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Origin: base,
          Cookie: old,
        },
      },
      res => {
        res.resume();
        res.on('end', resolve);
      },
    );
    q.on('error', reject);
    q.end(data);
  });
  assert.equal((await req('GET', '/api/config', old)).status, 401);
});
