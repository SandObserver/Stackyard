const path = require('node:path');
const fs = require('node:fs');

process.env.ALLOW_PRIVATE_IPS = 'true';
const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('apierr');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');
process.env.WIDGETS_PATH = path.join(_tmp, 'widgets');
fs.mkdirSync(process.env.WIDGETS_PATH, { recursive: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { hashPassword, makeToken } = require('../src/auth');
const { KIND } = require('../src/api-error');

const SECRET = 'b'.repeat(64);
let server, base, cookie;
let upstream, upstreamBase;
let upstreamStatus = 200,
  upstreamBody = '{"count":3}';

before(async () => {
  const passwordHash = await hashPassword('correct-horse');
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: SECRET, passwordHash } } });
  cookie = 'ds=' + makeToken('session-abc', SECRET);

  /* Stub upstream, so we control the status the badge proxy sees. */
  upstream = http.createServer((_, res) => {
    res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    res.end(upstreamBody);
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  upstreamBase = `http://127.0.0.1:${upstream.address().port}`;

  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
  await new Promise(r => {
    upstream.closeAllConnections?.();
    upstream.close(r);
  });
});

function post(pathname, body, opts = {}) {
  const data = JSON.stringify(body);
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Origin: base,
          Cookie: opts.cookie === null ? '' : opts.cookie || cookie,
        }),
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

/* ── Router-level errors ──────────────────────────────────────────────────── */

test('an unauthenticated request is tagged as an auth failure', async () => {
  const r = await post('/api/ping', { url: upstreamBase }, { cookie: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.kind, KIND.AUTH);
  assert.equal(r.body.auth, true, 'the existing auth flag must survive');
  assert.equal(r.body.error, 'Unauthorised', 'the existing message must survive');
});

test('a cross-origin write keeps its 403 and gains a kind', async () => {
  const data = JSON.stringify({ url: upstreamBase });
  const u = new URL(base + '/api/ping');
  const r = await new Promise((resolve, reject) => {
    const q = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Origin: 'http://evil.example',
          Cookie: cookie,
        },
      },
      res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      },
    );
    q.on('error', reject);
    q.end(data);
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.kind, KIND.INVALID);
});

/* ── badge-proxy ──────────────────────────────────────────────────────────── */

test('badge-proxy reports an upstream 401 as a failure, not a bare success', async () => {
  upstreamStatus = 401;
  upstreamBody = '{"detail":"missing token"}';
  const r = await post('/api/badge-proxy', { url: upstreamBase });
  assert.equal(r.status, 502);
  assert.equal(r.body.kind, KIND.UPSTREAM);
  assert.equal(r.body.detail.status, 401);
});

test('badge-proxy does not leak the upstream response body into detail', async () => {
  upstreamStatus = 403;
  upstreamBody = '{"secret":"hunter2"}';
  const r = await post('/api/badge-proxy', { url: upstreamBase });
  assert.deepEqual(Object.keys(r.body.detail), ['status'], 'detail is server-derived only');
  assert.ok(!JSON.stringify(r.body).includes('hunter2'));
});

test('badge-proxy still succeeds on a 200', async () => {
  upstreamStatus = 200;
  upstreamBody = '{"count":3}';
  const r = await post('/api/badge-proxy', { url: upstreamBase });
  assert.equal(r.status, 200);
  assert.ok(!('kind' in r.body), 'a success carries no kind');
  assert.ok(Array.isArray(r.body.numbers));
});

test('badge-proxy still returns the upstream body for the field picker', async () => {
  upstreamStatus = 200;
  upstreamBody = '{"count":3,"nested":{"other":9}}';
  const r = await post('/api/badge-proxy', { url: upstreamBase });
  assert.deepEqual(r.body.data, { count: 3, nested: { other: 9 } });
  assert.ok(r.body.numbers.some(n => n.path === 'count' && n.value === 3));
});

test('badge-proxy tags an unreachable target as a network failure', async () => {
  const dead = await new Promise(res => {
    const s = http.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  const r = await post('/api/badge-proxy', { url: `http://127.0.0.1:${dead}` });
  assert.equal(r.status, 502);
  assert.equal(r.body.kind, KIND.NETWORK);
  assert.equal(r.body.detail.code, 'ECONNREFUSED');
});

test('badge-proxy tags a missing url as invalid', async () => {
  const r = await post('/api/badge-proxy', {});
  assert.equal(r.status, 400);
  assert.equal(r.body.kind, KIND.INVALID);
});

/* ── ping ─────────────────────────────────────────────────────────────────── */

test('ping keeps its ok:false shape and gains a kind', async () => {
  const dead = await new Promise(res => {
    const s = http.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  const r = await post('/api/ping', { url: `http://127.0.0.1:${dead}` });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false, 'the existing ok flag must survive');
  assert.equal(r.body.status, 0);
});

/* ── config ───────────────────────────────────────────────────────────────── */

test('a rejected config save is tagged invalid, with its message intact', async () => {
  const r = await post('/api/config', { items: 'not-an-array' });
  assert.equal(r.status, 400);
  assert.equal(r.body.kind, KIND.INVALID);
  assert.equal(r.body.error, 'items must be an array');
});
