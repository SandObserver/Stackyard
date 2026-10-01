const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const DIR = tmpDir('host-check');
const CFG = path.join(DIR, 'apps.json');
process.env.CONFIG_PATH = CFG;

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');

let server, port;

/* Host and Origin both name the attacker's site, as a browser sends them after
   DNS rebinding. */
function request(method, pathName, host, body, cookie) {
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
          Origin: `http://${host}`,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
            cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0],
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let clock = Date.now();
const expireCache = () => (clock += 60_000);
const stored = () => JSON.parse(fs.readFileSync(CFG, 'utf8')).settings?.server?.allowedHosts;

before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => new Promise(r => server.close(r)));

beforeEach(() => {
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
  expireCache();
});

test('a rebound page cannot set the password on a fresh install', async () => {
  const r = await request('POST', '/api/auth/set-password', 'evil.example:3999', { password: 'attacker-pass-1' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'blocked.host');
  assert.equal(r.body.detail.host, 'evil.example');
  assert.equal(fs.existsSync(CFG), false);
});

test('a rebound page cannot read or replace the config', async () => {
  saveConfig({ items: [{ id: 'a', type: 'app' }], settings: { server: { allowedHosts: [] } } });
  expireCache();
  assert.equal((await request('GET', '/api/config', 'evil.example')).status, 403);
  assert.equal((await request('POST', '/api/config', 'evil.example', { items: [], settings: {} })).status, 403);
  assert.equal(loadConfig().items.length, 1);
});

test('the first page load by name trusts that name and no other', async () => {
  const first = await request('GET', '/api/auth/check', 'Dash.Example.com:8700');
  assert.equal(first.status, 200);
  assert.deepEqual(stored(), ['dash.example.com']);
  expireCache();
  assert.equal((await request('GET', '/api/config', 'dash.example.com')).status, 200);
  assert.equal((await request('GET', '/api/auth/check', 'evil.example')).status, 403);
});

test('the first page load by IP address trusts no name', async () => {
  assert.equal((await request('GET', '/api/auth/check', '192.168.1.10:8700')).status, 200);
  assert.deepEqual(stored(), []);
  expireCache();
  assert.equal((await request('GET', '/api/auth/check', 'dash.example.com')).status, 403);
});

test('local addresses are always answered', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: [] } } });
  for (const host of ['localhost:8700', '127.0.0.1', '[::1]:8700', 'nas', 'nas.local', 'box.home.arpa', 'x.internal']) {
    expireCache();
    assert.equal((await request('GET', '/api/config', host)).status, 200, host);
  }
});

test('an address added in Settings is answered, and a save without the list keeps it', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: [] } } });
  expireCache();
  const add = await request('POST', '/api/config', '192.168.1.10', {
    items: [],
    settings: { server: { allowedHosts: ['Dash.Example.com', 'dash.example.com'] } },
  });
  assert.equal(add.status, 200);
  assert.deepEqual(stored(), ['dash.example.com']);
  expireCache();
  assert.equal((await request('GET', '/api/config', 'dash.example.com')).status, 200);
  assert.equal((await request('POST', '/api/config', '192.168.1.10', { items: [], settings: {} })).status, 200);
  assert.deepEqual(stored(), ['dash.example.com']);
});

test('a list that is not host names is refused', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: [] } } });
  expireCache();
  for (const allowedHosts of [['not a host'], 'dash.example.com', [42]]) {
    const r = await request('POST', '/api/config', '127.0.0.1', { items: [], settings: { server: { allowedHosts } } });
    assert.equal(r.status, 400, JSON.stringify(allowedHosts));
  }
});

test('with a password set, any address reaches the sign-in check', async () => {
  const passwordHash = await hashPassword('correct-horse');
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash }, server: { allowedHosts: [] } } });
  expireCache();
  const r = await request('GET', '/api/config', 'dash.example.com');
  assert.equal(r.status, 401);
});

test('health answers on any address', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: [] } } });
  expireCache();
  assert.equal((await request('GET', '/health', 'evil.example')).status, 200);
});

test('turning the password off from a name stores that name in the same write', async () => {
  const passwordHash = await hashPassword('correct-horse');
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash }, server: { allowedHosts: [] } } });
  expireCache();
  const login = await request('POST', '/api/auth/login', 'dash.example.com', { password: 'correct-horse' });
  assert.equal(login.status, 200);
  const off = await request(
    'POST',
    '/api/auth/toggle',
    'dash.example.com',
    { enabled: false, currentPassword: 'correct-horse', allowedHosts: ['dash.example.com'] },
    login.cookie,
  );
  assert.equal(off.status, 200);
  assert.deepEqual(stored(), ['dash.example.com']);
  assert.equal((await request('GET', '/api/config', 'dash.example.com')).status, 200);
});

test('a toggle with a malformed list changes nothing', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: [] } } });
  expireCache();
  const r = await request('POST', '/api/auth/toggle', '127.0.0.1', { enabled: false, allowedHosts: ['not a host'] });
  assert.equal(r.status, 400);
  assert.deepEqual(stored(), []);
});

test('names with an underscore are answered and can be allowed', async () => {
  saveConfig({ items: [], settings: { server: { allowedHosts: ['stackyard_app.example.com'] } } });
  for (const host of ['my_nas:8700', 'stackyard_app.example.com']) {
    expireCache();
    assert.equal((await request('GET', '/api/auth/check', host)).status, 200, host);
  }
});
