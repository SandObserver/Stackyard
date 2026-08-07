/* Regression tests for P1-1 and P2-3, which are one defect in two places.

   decodeURIComponent raises URIError on an invalid escape, and neither call site
   expected it:

     auth.js parseCookies decoded every cookie value, so a stray '%' in any
     cookie on the domain, not only ours, turned every authenticated request into
     a 500. That included the public /api/auth/check, so it needed no session.

     router.js decoded route parameters, so /api/widget-config/% answered 500.

   A 500 also misreports a malformed request as a server fault, which is wrong for
   the client and noise in the log.

   What a failure means differs by site, which is why the helper reports it rather
   than deciding: an unrelated cookie is not this application's business and its
   value is carried through, while a route parameter that will not decode is a bad
   request and answers 400. */

const path = require('node:path');

const { tmpDir, tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('decode'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { tryDecode, decodeOrRaw } = require('../src/percent-decode');
const { parseCookies, hashPassword, makeToken } = require('../src/auth');
const { plain } = require('../test-support/plain');

/* Values decodeURIComponent throws on. */
const MALFORMED = ['%', '%z', '%zz', '%2', 'a%', '%%', '%E0%A4%A', 'ok-%-then', '%C0%80'.slice(0, 5)];

/* ── the helper ───────────────────────────────────────────────────────────── */

test('valid encoding decodes', () => {
  assert.equal(tryDecode('a%20b'), 'a b');
  assert.equal(tryDecode('%C3%A9'), 'é');
  assert.equal(tryDecode('plain'), 'plain');
  assert.equal(tryDecode(''), '');
});

test('malformed encoding reports failure rather than throwing', () => {
  for (const v of MALFORMED) {
    assert.doesNotThrow(() => tryDecode(v), `${JSON.stringify(v)} should not throw`);
    assert.equal(tryDecode(v), null, `${JSON.stringify(v)} should report failure`);
  }
});

/* Confirms the inputs above really are the failing case, so the test cannot pass
   because decodeURIComponent quietly got more permissive. */
test('the malformed cases are ones decodeURIComponent rejects', () => {
  for (const v of MALFORMED) {
    assert.throws(() => decodeURIComponent(v), /URI malformed/, `${JSON.stringify(v)} should throw`);
  }
});

test('decodeOrRaw keeps the raw value when it will not decode', () => {
  for (const v of MALFORMED) assert.equal(decodeOrRaw(v), v);
  assert.equal(decodeOrRaw('a%20b'), 'a b');
});

test('both tolerate non-string input', () => {
  for (const v of [null, undefined, 0, {}, []]) {
    assert.equal(typeof decodeOrRaw(v), 'string');
    assert.doesNotThrow(() => tryDecode(v));
  }
});

/* ── cookies ──────────────────────────────────────────────────────────────── */

/* Copied onto an ordinary prototype: parseCookies builds a null-prototype
   object, since its keys are cookie names off the request. */
const cookies = header => plain(parseCookies({ headers: { cookie: header } }));

test('a malformed cookie value is kept rather than throwing', () => {
  assert.doesNotThrow(() => cookies('ds=%'));
  assert.deepEqual(cookies('ds=%'), { ds: '%' });
});

/* The case that made this reachable without a session: the broken cookie need
   not be ours. */
test('a malformed unrelated cookie does not break the ones that matter', () => {
  const out = cookies('other=%zz; ds=abc.123.def');
  assert.equal(out.ds, 'abc.123.def');
  assert.equal(out.other, '%zz');
});

test('ordinary cookies still decode', () => {
  assert.deepEqual(cookies('a=one%20two; b=x'), { a: 'one two', b: 'x' });
});

test('a value containing = survives intact', () => {
  assert.equal(cookies('t=a=b=c').t, 'a=b=c');
});

/* ── over HTTP ────────────────────────────────────────────────────────────── */

let server, base;

before(async () => {
  require('../src/routes');
  require('../src/widget-data');   /* registers /api/widget-config/:id */
  const { dispatch } = require('../src/router');
  const { saveConfig } = require('../src/config');
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, secret: 'a'.repeat(64), passwordHash: await hashPassword('correct-horse') } },
  });
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => { server.closeAllConnections?.(); server.close(r); }); });

function get(pathname, cookie) {
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET',
      headers: cookie ? { Cookie: cookie } : {},
    }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    r.end();
  });
}

test('a malformed cookie no longer produces a 500', async () => {
  for (const c of ['ds=%', 'ds=%zz', 'other=%; ds=x', 'a=%2']) {
    const r = await get('/api/config', c);
    assert.equal(r.status, 401, `${c} should be an ordinary auth failure, got ${r.status}`);
  }
});

/* Public route, so this was reachable with no session at all. */
test('a malformed cookie no longer breaks the public auth check', async () => {
  const r = await get('/api/auth/check', 'ds=%');
  assert.equal(r.status, 200);
  assert.equal(r.body.authenticated, false);
});

test('a valid session still works alongside a malformed cookie', async () => {
  const { loadConfig } = require('../src/config');
  const token = makeToken('session-abc', loadConfig().settings.auth.secret);
  const r = await get('/api/config', `broken=%zz; ds=${token}`);
  assert.equal(r.status, 200, 'one bad cookie must not invalidate the session');
});

/* Auth is enabled in this file, and the gate runs before route matching, so
   these need a real session or they answer 401 without ever reaching the decode.
   That is how a test can pass for the wrong reason. */
const session = () => {
  const { loadConfig } = require('../src/config');
  return 'ds=' + makeToken('session-abc', loadConfig().settings.auth.secret);
};

test('a malformed route parameter is a bad request, not a server error', async () => {
  const r = await get('/api/widget-config/%', session());
  assert.equal(r.status, 400, 'must reach the decode, not stop at the auth gate');
  assert.equal(r.body.kind, 'invalid');
  assert.match(r.body.error, /id/, 'the message should name the parameter');
});

test('a valid route parameter still decodes', async () => {
  /* Not found rather than 400: the id decoded fine, there is just no such
     widget. */
  const r = await get('/api/widget-config/a%20b', session());
  assert.equal(r.status, 404);
});

test('no malformed URL produces a 500', async () => {
  const c = session();
  for (const p of ['/api/widget-config/%', '/api/widget-config/%zz', '/api/widget-config/a%', '/api/widget-config/%E0%A4%A']) {
    const r = await get(p, c);
    assert.notEqual(r.status, 500, `${p} answered 500`);
    assert.equal(r.status, 400, `${p} should be a bad request`);
  }
});
