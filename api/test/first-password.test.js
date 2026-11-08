const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
const DIR = tmpDir('first-password');
process.env.CONFIG_PATH = path.join(DIR, 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');
const setupCode = require('../src/setup-code');
const log = require('../src/log');
const { firstPasswordCode } = require('../test-support/setup-code');

const PASSWORD = 'quiet otter lantern 42';
const LAN = '192.168.1.10';
let server, port;

function request(method, pathName, { host = LAN, origin = `http://${host}`, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method,
        headers: {
          Host: host,
          ...(origin ? { Origin: origin } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const setPassword = (body, opts) => request('POST', '/api/auth/set-password', { ...opts, body });
const PROXIED = { 'X-Stackyard-Proxied': '1' };

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => server.close());
beforeEach(() => {
  setupCode._reset();
  saveConfig({ items: [], settings: {} });
});

test('a first password without the setup code is refused, on a local address too', async () => {
  firstPasswordCode();
  for (const body of [{ password: PASSWORD }, { password: PASSWORD, code: 'WRONG-CODE' }]) {
    const r = await setPassword(body);
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.equal(r.body.code, 'invalid.setup-code');
  }
  assert.equal(loadConfig().settings?.auth?.passwordHash, undefined);
});

test('a first password with the setup code is stored and signs the caller in', async () => {
  const code = firstPasswordCode();
  const r = await setPassword({ password: PASSWORD, code });
  assert.equal(r.status, 200);
  assert.equal(loadConfig().settings.auth.enabled, true);
  assert.equal(setupCode._current(), null, 'the code is used up');
});

test('the code is accepted as the log groups it, in any letter case', async () => {
  const code = firstPasswordCode();
  const grouped = code
    .match(/.{1,4}/g)
    .join('-')
    .toLowerCase();
  assert.equal((await setPassword({ password: PASSWORD, code: grouped })).status, 200);
});

test('a first password with no code yet prints one and is refused', async () => {
  const printed = mock.method(log, 'print', () => {});
  const r = await setPassword({ password: PASSWORD, code: 'ANYTHING' });
  printed.mock.restore();
  assert.equal(r.status, 403);
  assert.match(printed.mock.calls.map(c => c.arguments[0]).join('\n'), /Setup code {2}\S+/);
});

test('the sign-in check prints the code once while no password is set, and never after', async () => {
  const printed = mock.method(log, 'print', () => {});
  await request('GET', '/api/auth/check', { origin: null });
  await request('GET', '/api/auth/check', { origin: null });
  assert.equal(printed.mock.calls.length, 1);
  assert.match(printed.mock.calls[0].arguments[0], /No dashboard password is set/);

  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword(PASSWORD) } } });
  setupCode._reset();
  await request('GET', '/api/auth/check', { origin: null });
  printed.mock.restore();
  assert.equal(printed.mock.calls.length, 1);
});

test('changing an existing password needs no setup code', async () => {
  const code = firstPasswordCode();
  const first = await new Promise((resolve, reject) => {
    const payload = JSON.stringify({ password: PASSWORD, code });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/auth/set-password',
        method: 'POST',
        headers: {
          Host: LAN,
          Origin: `http://${LAN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        res.resume();
        res.on('end', () => resolve((res.headers['set-cookie'] || [])[0].split(';')[0]));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
  const r = await setPassword(
    { password: 'another quiet otter 43', currentPassword: PASSWORD },
    { headers: { Cookie: first } },
  );
  assert.equal(r.status, 200);
});

test('the audit line for a first password names the address and the host it used', async () => {
  const lines = [];
  const audit = mock.method(log, 'audit', (msg, fields) => lines.push({ msg, fields }));
  await setPassword({ password: PASSWORD, code: firstPasswordCode() }, { headers: { 'X-Real-IP': '192.168.1.77' } });
  audit.mock.restore();
  const line = lines.find(l => l.msg === 'password set with setup code');
  assert.deepEqual(line?.fields, { ip: '192.168.1.77', host: LAN });
});

/* ── requests through a proxy while no password is set ───────────────────── */

test('through a proxy, an IP or one-label Host is refused like a public name', async () => {
  for (const host of ['10.0.0.5:8700', 'stackyard', 'stackyard:80', 'nas.local']) {
    const r = await request('GET', '/api/config', { host, headers: PROXIED });
    assert.equal(r.status, 403, host);
    assert.equal(r.body.kind, 'blocked', host);
    assert.equal(r.body.detail.proxied, true, host);
  }
});

test('through a proxy, a listed name is answered, as Host or as X-Forwarded-Host', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: ['dash.example.com'] } } });
  assert.equal((await request('GET', '/api/config', { host: 'dash.example.com', headers: PROXIED })).status, 200);
  const forwarded = { ...PROXIED, 'X-Stackyard-Trusted-Peer': '1', 'X-Forwarded-Host': 'dash.example.com' };
  assert.equal((await request('GET', '/api/config', { host: 'stackyard', headers: forwarded })).status, 200);
  const other = { ...PROXIED, 'X-Stackyard-Trusted-Peer': '1', 'X-Forwarded-Host': 'evil.example' };
  const refused = await request('GET', '/api/config', { host: 'stackyard', headers: other });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.detail.host, 'evil.example', 'the screen names the address the visitor used');
});

test('X-Forwarded-Host from a peer not in TRUSTED_PROXY does not pass the gate', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: ['dash.example.com'] } } });
  const headers = { ...PROXIED, 'X-Forwarded-Host': 'dash.example.com' };
  assert.equal((await request('GET', '/api/config', { host: 'evil.example', headers })).status, 403);
});

test('without the proxy flag a local address is answered as before', async () => {
  for (const flag of [{}, { 'X-Stackyard-Proxied': '0' }]) {
    assert.equal((await request('GET', '/api/config', { host: '10.0.0.5:8700', headers: flag })).status, 200);
  }
});

test('through a proxy, the setup code route answers so the owner can set a password', async () => {
  const printed = mock.method(log, 'print', () => {});
  setupCode.announce('host');
  printed.mock.restore();
  const code = setupCode._current();
  const r = await request('POST', '/api/auth/setup-password', {
    host: 'stackyard',
    headers: PROXIED,
    body: { code, password: PASSWORD },
  });
  assert.equal(r.status, 200);
});

test('turning protection off through a proxy needs the name in the list', () => {
  const { proxiedNameLost } = require('../src/host-check');
  const req = headers => ({ socket: { remoteAddress: '127.0.0.1' }, headers });
  const proxiedReq = req({ host: 'stackyard', 'x-stackyard-proxied': '1' });
  assert.equal(proxiedNameLost(proxiedReq, []), 'stackyard');
  assert.equal(proxiedNameLost(proxiedReq, ['stackyard']), null);
  assert.equal(proxiedNameLost(req({ host: 'stackyard' }), []), null);
});

test('a toggle with no password stored keeps the setup code', async () => {
  saveConfig({ items: [], settings: {} });
  const printed = mock.method(log, 'print', () => {});
  setupCode.announce('host');
  printed.mock.restore();
  const code = setupCode._current();
  const r = await request('POST', '/api/auth/toggle', { body: { enabled: false } });
  assert.equal(r.status, 200);
  assert.equal(setupCode._current(), code);
});

test('with a password set, a proxied request is gated by the session, not the address', async () => {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword(PASSWORD) } } });
  const r = await request('GET', '/api/config', { host: 'stackyard', headers: PROXIED });
  assert.equal(r.status, 401);
  const check = await request('GET', '/api/auth/check', { host: 'stackyard', origin: null, headers: PROXIED });
  assert.equal(check.status, 200);
});
