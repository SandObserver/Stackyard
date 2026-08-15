/* Boots the real request pipeline (router.dispatch + all registered routes)
   against a temp config, and exercises it over real HTTP. Env must be set
   before the app modules are required, since config/widget paths are read at
   load time. */
const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('http');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');
process.env.WIDGETS_PATH = path.join(_tmp, 'widgets');

/* One throwaway widget, so the request-body-URL path (/api/widget-options) has
   something to dispatch to. Its data function fetches whatever URL the request
   supplied, which is what the SSRF guard has to intercept. */
const _fx = path.join(_tmp, 'widgets', 'fixture');
fs.mkdirSync(_fx, { recursive: true });
fs.writeFileSync(
  path.join(_fx, 'widget.json'),
  JSON.stringify({
    name: 'fixture',
    label: 'Fixture',
    sizes: ['medium'],
    views: { main: { src: 'index.html' } },
    fields: [{ key: 'url', type: 'text', label: 'URL' }],
  }),
);
fs.writeFileSync(path.join(_fx, 'index.html'), '');
fs.writeFileSync(path.join(_fx, 'data.js'), 'module.exports = async ctx => ctx.fetchJSON(ctx.config.url, {});\n');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes'); // registers auth/config/health/badges/... + OPTIONS
require('../src/widget-data'); // registers /api/widget-data/:id (pulls in widgets)
const { dispatch, on } = require('../src/router');
const { saveConfig, loadConfig } = require('../src/config');
const { hashPassword, makeToken, verifyToken, clearAttempts, RENEW_AFTER_MS } = require('../src/auth');

/* Routes that fail on purpose, to prove the router turns a handler error into a
   500 instead of crashing the process. */
on('GET', '/api/_boom_sync', () => {
  throw new Error('sync boom');
});
on('GET', '/api/_boom_async', async () => {
  throw new Error('async boom');
});

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

after(
  () =>
    new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    }),
);

/* Origin defaults to this server's own, which is what a browser sends on a
   same-origin write and what the origin check now requires. Pass `origin: null`
   for the case of a request that states none. */
function req(method, pathname, opts = {}) {
  const { cookie, body, origin = base, host } = opts;
  const data = body != null ? JSON.stringify(body) : null;
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        agent: false,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(host ? { Host: host } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      },
    );
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

test('a widget type naming an inherited member is unknown, not data-less', async () => {
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    items: [...(cfg.items || []), { id: 'proto-w', type: 'widget', widgetType: 'constructor', widgetConfig: {} }],
  });
  try {
    const r = await req('GET', '/api/widget-data/proto-w', { cookie: validCookie });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'unknown widget type');
  } finally {
    saveConfig(cfg);
  }
});

test('OPTIONS is no longer specially routed', async () => {
  const r = await req('OPTIONS', '/api/config', { cookie: validCookie });
  assert.equal(r.status, 404, 'it must fall through like any other unmatched method');
});

test('OPTIONS without a session is refused like every other method', async () => {
  const r = await req('OPTIONS', '/api/config');
  assert.equal(r.status, 401);
});

test('no response carries the dead CORS headers', async () => {
  for (const [method, path] of [
    ['GET', '/api/config'],
    ['GET', '/api/health'],
    ['OPTIONS', '/api/config'],
  ]) {
    const r = await req(method, path, { cookie: validCookie });
    assert.equal(r.headers['access-control-allow-methods'], undefined, `${method} ${path}`);
    assert.equal(r.headers['access-control-allow-headers'], undefined, `${method} ${path}`);
  }
});

test('a cross-origin write is rejected by the origin check', async () => {
  const r = await req('POST', '/api/auth/set-password', {
    cookie: validCookie,
    body: { password: 'longenough123' },
    origin: 'http://evil.example',
    host: '127.0.0.1:1',
  });
  assert.equal(r.status, 403);
});

test('cross-origin login, logout, ping and badge-proxy are rejected', async () => {
  const evil = { origin: 'http://evil.example', host: '127.0.0.1:1' };
  const login = await req('POST', '/api/auth/login', { body: { password: 'correct-horse' }, ...evil });
  assert.equal(login.status, 403);
  const logout = await req('POST', '/api/auth/logout', { cookie: validCookie, ...evil });
  assert.equal(logout.status, 403);
  const ping = await req('POST', '/api/ping', { cookie: validCookie, body: { url: 'http://x' }, ...evil });
  assert.equal(ping.status, 403);
  const badge = await req('POST', '/api/badge-proxy', { cookie: validCookie, body: { url: 'http://x' }, ...evil });
  assert.equal(badge.status, 403);
});

/* A browser states an origin on every write, including a same-origin one, so a
   write that states none did not come from a page on this dashboard. */
test('a write that states no origin at all is rejected', async () => {
  for (const [pathname, body] of [
    ['/api/config', { items: [] }],
    ['/api/ping', { url: 'http://x' }],
    ['/api/badge-proxy', { url: 'http://x' }],
    ['/api/auth/logout', {}],
    ['/api/auth/login', { password: 'correct-horse' }],
  ]) {
    const r = await req('POST', pathname, { cookie: validCookie, body, origin: null });
    assert.equal(r.status, 403, pathname);
    assert.match(String(r.body?.error), /Origin/, pathname);
  }
});

test('a saved setting on the known list survives, an unknown one is dropped', async () => {
  const cfg = loadConfig();
  try {
    const r = await req('POST', '/api/config', {
      cookie: validCookie,
      body: {
        items: [],
        _rev: cfg._rev,
        settings: { showLabels: { desktop: false, ios: true }, keepAwake: 'yes', notASetting: 'x' },
      },
    });
    assert.equal(r.status, 200);
    const saved = loadConfig();
    assert.deepEqual(saved.settings.showLabels, { desktop: false, ios: true });
    assert.equal(saved.settings.notASetting, undefined);
    assert.equal(saved.settings.keepAwake, false, 'a non-boolean keepAwake is stored as off, not as a string');
  } finally {
    saveConfig(cfg);
  }
});

test('a read is not asked for an origin, since it changes nothing', async () => {
  const r = await req('GET', '/api/config', { cookie: validCookie, origin: null });
  assert.equal(r.status, 200);
});

/* Signed by the server, so it cannot be backdated by the holder: this builds the
   token the server would have issued at that moment. */
function agedCookie(ms) {
  const real = Date.now;
  Date.now = () => real() - ms;
  try {
    return 'ds=' + makeToken('session-aged', SECRET);
  } finally {
    Date.now = real;
  }
}

test('a session still in use is extended rather than expiring under the shorter window', async () => {
  const r = await req('GET', '/api/config', { cookie: agedCookie(RENEW_AFTER_MS + 1000) });
  assert.equal(r.status, 200);
  const issued = String(r.headers['set-cookie'] || '');
  assert.match(issued, /ds=.+/, 'a session past halfway must come back renewed');
  assert.equal(verifyToken(/ds=([^;]+)/.exec(issued)[1], SECRET), 'session-aged');
});

test('a fresh session is not handed a new cookie on every request', async () => {
  const r = await req('GET', '/api/config', { cookie: validCookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers['set-cookie'], undefined);
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
  assert.equal(exp.body.settings.bogusKey, undefined); // unknown key stripped
  assert.equal(exp.body.settings.logLevel, undefined); // invalid level stripped
  assert.equal(exp.body.settings.theme, 'dark'); // known key kept
});

test('POST /api/config rejects a stale _rev with 409', async () => {
  const read = await req('GET', '/api/config', { cookie: validCookie });
  const stale = read.body._rev;
  assert.equal(typeof stale, 'number');

  const ok = await req('POST', '/api/config', { cookie: validCookie, body: { items: [], settings: {}, _rev: stale } });
  assert.equal(ok.status, 200);

  // same rev again: disk has moved on, so this is the second tab saving over the first
  const conflict = await req('POST', '/api/config', {
    cookie: validCookie,
    body: { items: [], settings: {}, _rev: stale },
  });
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

/* An options fetch takes its target URL from the request body, so it must route
   through the SSRF-guarded fetch: a private/loopback target is blocked with 403
   rather than reached. */
test('POST /api/widget-options blocks a private target URL', async () => {
  const r = await req('POST', '/api/widget-options/x', {
    cookie: validCookie,
    body: { widgetType: 'fixture', endpoint: 'any', widgetConfig: { url: 'http://127.0.0.1:1/' } },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body?.kind, 'blocked');
  assert.doesNotMatch(String(r.body?.error), /\d+\.\d+\.\d+\.\d+/, 'must not echo the address back');
});

test('POST /api/widget-options rejects a cross-origin write', async () => {
  const r = await req('POST', '/api/widget-options/x', {
    cookie: validCookie,
    body: { widgetType: 'fixture', endpoint: 'any', widgetConfig: { url: 'http://example.com/' } },
    origin: 'http://evil.example',
    host: '127.0.0.1:1',
  });
  assert.equal(r.status, 403);
  assert.match(String(r.body?.error), /origin mismatch/);
});

test('POST /api/widget-options refuses an unknown widget type', async () => {
  const r = await req('POST', '/api/widget-options/x', {
    cookie: validCookie,
    body: { widgetType: 'nope', endpoint: 'any', widgetConfig: {} },
  });
  assert.equal(r.status, 400);
});

test('GET /api/truenas-proxy is not routed', async () => {
  const r = await req('GET', '/api/truenas-proxy?url=http://example.com/&key=secret', { cookie: validCookie });
  assert.equal(r.status, 404);
});

/* Config-mutating auth paths, kept last so they don't disturb the tests above
   (set-password rotates the signing secret, invalidating validCookie). */
test('dismiss-setup records the flag for an authenticated same-origin request', async () => {
  const r = await req('POST', '/api/auth/dismiss-setup', { cookie: validCookie });
  assert.equal(r.status, 200);
  const check = await req('GET', '/api/auth/check', { cookie: validCookie });
  assert.equal(check.body.setupPrompted, true);
});

/* The one route that answers before sign-in, so what it volunteers is the whole
   pre-auth surface. */
test('the pre-auth check withholds how the install is configured', async () => {
  const r = await req('GET', '/api/auth/check');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.authenticated, false);
  assert.ok(!('passwordSet' in r.body), 'passwordSet must not be told to a caller with no session');
  assert.ok(!('setupPrompted' in r.body), 'setupPrompted must not be told to a caller with no session');
});

test('set-password rejects a too-short password', async () => {
  const r = await req('POST', '/api/auth/set-password', { cookie: validCookie, body: { password: 'short' } });
  assert.equal(r.status, 400);
});

test('set-password succeeds for an authenticated session and issues a new cookie', async () => {
  const r = await req('POST', '/api/auth/set-password', {
    cookie: validCookie,
    body: { password: 'a-long-enough-password' },
  });
  assert.equal(r.status, 200);
  assert.match(String(r.headers['set-cookie'] || ''), /ds=.+/);
});
