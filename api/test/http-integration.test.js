/* Boots the real request pipeline (router.dispatch + all registered routes)
   against a temp config, and exercises it over real HTTP. Env must be set
   before the app modules are required, since config/widget paths are read at
   load time. */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const _tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-http-'));
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');
process.env.WIDGETS_PATH = path.join(_tmp, 'widgets');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');       // registers auth/config/health/badges/... + OPTIONS
require('../src/widget-data');  // registers /api/widget-data/:id (pulls in widgets)
const { dispatch, on } = require('../src/router');
const { saveConfig } = require('../src/config');
const { hashPassword, makeToken, clearAttempts } = require('../src/auth');

/* Routes that fail on purpose, to prove the router turns a handler error into a
   500 instead of crashing the process. */
on('GET', '/api/_boom_sync', () => { throw new Error('sync boom'); });
on('GET', '/api/_boom_async', async () => { throw new Error('async boom'); });

const SECRET = 'a'.repeat(64);
let server, base, validCookie;

before(async () => {
  const passwordHash = await hashPassword('correct-horse');
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: SECRET, passwordHash } } });
  validCookie = 'ds=' + makeToken('session-abc', SECRET);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(r => { server.closeAllConnections?.(); server.close(r); }));

function req(method, pathname, opts = {}) {
  const { cookie, body, origin, host } = opts;
  const data = body != null ? JSON.stringify(body) : null;
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      agent: false,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(host ? { Host: host } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('unauthenticated request to a protected route is rejected with 401', async () => {
  const r = await req('GET', '/api/config');
  assert.equal(r.status, 401);
  assert.equal(r.body.auth, true);
});

test('public routes do not require authentication', async () => {
  assert.equal((await req('GET', '/health')).status, 200);
  assert.equal((await req('GET', '/api/auth/check')).status, 200);
});

test('login with the wrong password returns 401', async () => {
  const r = await req('POST', '/api/auth/login', { body: { password: 'wrong' } });
  assert.equal(r.status, 401);
});

test('login with the correct password returns 200 and a session cookie', async () => {
  const r = await req('POST', '/api/auth/login', { body: { password: 'correct-horse' } });
  assert.equal(r.status, 200);
  const setCookie = String(r.headers['set-cookie'] || '');
  assert.match(setCookie, /ds=.+/);
  assert.match(setCookie, /HttpOnly/);
});

test('a concurrent burst of wrong passwords is capped, not all let through', async () => {
  // The bug this guards against: a parallel burst all clears the rate check
  // before any attempt is counted, so every one runs. With the atomic check,
  // at most the limit (5) reach the password check; the rest are blocked.
  const results = await Promise.all(
    Array.from({ length: 15 }, () => req('POST', '/api/auth/login', { body: { password: 'wrong' } })),
  );
  const got401 = results.filter(r => r.status === 401).length;
  const got429 = results.filter(r => r.status === 429).length;
  assert.ok(got401 <= 5, `at most 5 attempts should reach the password check, got ${got401}`);
  assert.equal(got401 + got429, 15);
  assert.ok(got429 >= 10, 'the rest should be rate-limited');
  clearAttempts('127.0.0.1'); // reset so later login tests start clean
});

test('a valid session cookie grants access to a protected route', async () => {
  const r = await req('GET', '/api/config', { cookie: validCookie });
  assert.equal(r.status, 200);
});

test('a tampered session cookie is rejected', async () => {
  const r = await req('GET', '/api/config', { cookie: 'ds=session-abc.' + 'b'.repeat(64) });
  assert.equal(r.status, 401);
});

test('unknown paths return 404', async () => {
  const r = await req('GET', '/api/does-not-exist', { cookie: validCookie });
  assert.equal(r.status, 404);
});

test('method mismatch falls through to 404', async () => {
  const r = await req('GET', '/api/auth/login'); // login is POST-only
  assert.equal(r.status, 404);
});

test('path parameters are extracted and routed', async () => {
  const r = await req('GET', '/api/widget-data/no-such-id', { cookie: validCookie });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'widget not found');
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const r = await req('OPTIONS', '/api/config');
  assert.equal(r.status, 204);
  assert.match(String(r.headers['access-control-allow-methods']), /GET/);
});

test('a cross-origin write is rejected by the origin check', async () => {
  const r = await req('POST', '/api/auth/set-password', {
    cookie: validCookie, body: { password: 'longenough123' },
    origin: 'http://evil.example', host: '127.0.0.1:1',
  });
  assert.equal(r.status, 403);
});

/* Config import/export route. */
test('POST /api/config rejects items that are not an array', async () => {
  const r = await req('POST', '/api/config', { cookie: validCookie, body: { items: 'nope' } });
  assert.equal(r.status, 400);
});

test('POST /api/config rejects an item missing id or type', async () => {
  const r = await req('POST', '/api/config', { cookie: validCookie, body: { items: [{ type: 'app' }] } });
  assert.equal(r.status, 400);
});

test('GET /api/config/export is downloadable and free of secrets', async () => {
  const r = await req('GET', '/api/config/export', { cookie: validCookie });
  assert.equal(r.status, 200);
  assert.match(String(r.headers['content-disposition'] || ''), /attachment/);
  assert.equal(r.body.settings?.auth?.secret, undefined);
  assert.equal(r.body.settings?.auth?.passwordHash, undefined);
});

test('POST /api/config drops unknown settings and preserves the stored auth secret', async () => {
  const r = await req('POST', '/api/config', {
    cookie: validCookie,
    body: { items: [], settings: { theme: 'dark', bogusKey: 1, logLevel: 'loud' } },
  });
  assert.equal(r.status, 200);
  // the existing secret was re-merged, so the session still authenticates
  assert.equal((await req('GET', '/api/config', { cookie: validCookie })).status, 200);
  const exp = await req('GET', '/api/config/export', { cookie: validCookie });
  assert.equal(exp.body.settings.bogusKey, undefined);   // unknown key stripped
  assert.equal(exp.body.settings.logLevel, undefined);   // invalid level stripped
  assert.equal(exp.body.settings.theme, 'dark');         // known key kept
});

test('POST /api/config rejects a stale _rev with 409', async () => {
  const read = await req('GET', '/api/config', { cookie: validCookie });
  const stale = read.body._rev;
  assert.equal(typeof stale, 'number');

  const ok = await req('POST', '/api/config', { cookie: validCookie, body: { items: [], settings: {}, _rev: stale } });
  assert.equal(ok.status, 200);

  // same rev again: disk has moved on, so this is the second tab saving over the first
  const conflict = await req('POST', '/api/config', { cookie: validCookie, body: { items: [], settings: {}, _rev: stale } });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /changed somewhere else/);
});

test('POST /api/config without a _rev overwrites regardless', async () => {
  const r = await req('POST', '/api/config', { cookie: validCookie, body: { items: [], settings: {} } });
  assert.equal(r.status, 200);
});

test('GET /api/config/export omits _rev', async () => {
  const r = await req('GET', '/api/config/export', { cookie: validCookie });
  assert.equal(r.status, 200);
  assert.equal(r.body._rev, undefined);
});

test('POST /api/config rejects more docked apps than the dock can render', async () => {
  const dock = n => Array.from({ length: n }, (_, k) => ({ id: `d${k}`, type: 'app', dock: true }));
  const ok = await req('POST', '/api/config', { cookie: validCookie, body: { items: dock(4), settings: {} } });
  assert.equal(ok.status, 200);

  const tooMany = await req('POST', '/api/config', { cookie: validCookie, body: { items: dock(5), settings: {} } });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /dock/);
});

test('POST /api/config does not count undocked apps, widgets or folders toward the dock', async () => {
  const items = [
    ...Array.from({ length: 4 }, (_, k) => ({ id: `d${k}`, type: 'app', dock: true })),
    { id: 'x', type: 'app', dock: false },
    { id: 'w', type: 'widget', dock: true },
    { id: 'f', type: 'folder', dock: true },
  ];
  const r = await req('POST', '/api/config', { cookie: validCookie, body: { items, settings: {} } });
  assert.equal(r.status, 200);
});

/* Router error boundary. */
test('a synchronous throw in a handler returns 500 without crashing the server', async () => {
  const r = await req('GET', '/api/_boom_sync', { cookie: validCookie });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'Internal server error');
  assert.equal((await req('GET', '/health')).status, 200); // process still serving
});

test('an async rejection in a handler returns 500 without crashing the server', async () => {
  const r = await req('GET', '/api/_boom_async', { cookie: validCookie });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'Internal server error');
  assert.equal((await req('GET', '/health')).status, 200);
});

/* Config-mutating auth paths, kept last so they don't disturb the tests above
   (set-password rotates the signing secret, invalidating validCookie). */
test('dismiss-setup records the flag for an authenticated same-origin request', async () => {
  const r = await req('POST', '/api/auth/dismiss-setup', { cookie: validCookie });
  assert.equal(r.status, 200);
  const check = await req('GET', '/api/auth/check');
  assert.equal(check.body.setupPrompted, true);
});

test('set-password rejects a too-short password', async () => {
  const r = await req('POST', '/api/auth/set-password', { cookie: validCookie, body: { password: 'short' } });
  assert.equal(r.status, 400);
});

test('set-password succeeds for an authenticated session and issues a new cookie', async () => {
  const r = await req('POST', '/api/auth/set-password', { cookie: validCookie, body: { password: 'a-long-enough-password' } });
  assert.equal(r.status, 200);
  assert.match(String(r.headers['set-cookie'] || ''), /ds=.+/);
});
