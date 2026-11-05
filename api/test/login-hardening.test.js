const path = require('node:path');
const crypto = require('node:crypto');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('login-hardening'), 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const auth = require('../src/auth');
const realMatch = auth.matchPassword;
let duringMatch = null;
auth.matchPassword = async (password, hash) => {
  const result = await realMatch(password, hash);
  if (duringMatch) {
    const run = duringMatch;
    duringMatch = null;
    await run();
  }
  return result;
};

const realHash = auth.hashPassword;
let duringHash = null;
auth.hashPassword = async password => {
  const result = await realHash(password);
  if (duringHash) {
    const run = duringHash;
    duringHash = null;
    await run();
  }
  return result;
};

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, loadConfigForUpdate, saveConfig } = require('../src/config');

let server, base;
let clock = Date.now();

function request(method, p, { body, cookie, ip } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const headers = { Origin: base, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (cookie) headers.Cookie = cookie;
    if (ip) headers['X-Real-IP'] = ip;
    const u = new URL(base + p);
    const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, res => {
      res.resume();
      res.on('end', () =>
        resolve({ status: res.statusCode, cookie: String(res.headers['set-cookie'] || '').split(';')[0] }),
      );
    });
    q.on('error', reject);
    q.end(data);
  });
}
const login = (password, ip) => request('POST', '/api/auth/login', { body: { password }, ip });

function setHash(passwordHash) {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash } } });
}

before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));
beforeEach(async () => {
  clock += 16 * 60 * 1000;
  duringMatch = null;
  duringHash = null;
  setHash(await auth.hashPassword('correct-horse'));
});

test('attemptAddress groups an IPv6 /64 and unwraps IPv4-mapped addresses', () => {
  const a = auth.attemptAddress;
  assert.equal(a('2001:db8::1'), a('2001:db8:0:0:ffff:ffff:ffff:ffff'));
  assert.equal(a('2001:DB8::1'), '2001:db8:0:0::/64');
  assert.notEqual(a('2001:db8:0:1::1'), a('2001:db8:0:2::1'));
  assert.equal(a('::ffff:192.0.2.7'), '192.0.2.7');
  assert.equal(a('::ffff:c000:207'), '192.0.2.7');
  assert.equal(a('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(a('192.0.2.7'), '192.0.2.7');
  assert.equal(a('unknown'), 'unknown');
});

test('guesses from different addresses in one IPv6 /64 share one limit', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong', `2001:db8:5:6::${i + 1}`)).status, 401);
  assert.equal((await login('correct-horse', '2001:db8:5:6::99')).status, 429);
  assert.equal((await login('correct-horse', '2001:db8:5:7::1')).status, 200);
});

test('a login checked against a password that is changed meanwhile gets no session', async () => {
  duringMatch = async () => {
    const cfg = loadConfigForUpdate();
    auth.storePassword(cfg, await auth.hashPassword('new-password-2'));
    saveConfig(cfg);
  };
  const res = await login('correct-horse');
  assert.equal(res.status, 401);
  assert.equal(res.cookie, '');
  assert.equal((await login('new-password-2')).status, 200);
});

test('a session from a login is accepted when nothing changed', async () => {
  const res = await login('correct-horse');
  assert.equal(res.status, 200);
  assert.equal((await request('GET', '/api/config', { cookie: res.cookie })).status, 200);
});

const NFD = 'café-terrace-1';
const NFC = 'café-terrace-1';

test('composed and decomposed accents are the same password', async () => {
  setHash(await auth.hashPassword(NFD));
  assert.equal((await login(NFC)).status, 200);
  assert.equal((await login(NFD)).status, 200);
});

async function unnormalizedHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 2 ** 14, r: 8, p: 5 }, (e, k) => (e ? reject(e) : resolve(k))),
  );
  const b64 = buf => buf.toString('base64').replace(/=+$/, '');
  return `$scrypt$ln=14,r=8,p=5$${b64(salt)}$${b64(key)}`;
}

test('a password changed while the login rewrites the old hash gets no session', async () => {
  setHash(await unnormalizedHash(NFD));
  duringHash = async () => {
    const cfg = loadConfigForUpdate();
    auth.storePassword(cfg, await auth.hashPassword('new-password-2'));
    saveConfig(cfg);
  };
  const res = await login(NFD);
  assert.equal(res.status, 401);
  assert.equal(res.cookie, '');
  assert.equal((await login('new-password-2')).status, 200);
});

test('parallel correct logins all succeed while the old hash is rewritten', async () => {
  setHash(await unnormalizedHash(NFD));
  const results = await Promise.all([login(NFD), login(NFD), login(NFD)]);
  assert.deepEqual(
    results.map(r => r.status),
    [200, 200, 200],
  );
});

test('a hash made from an unnormalized password still signs in and is rehashed', async () => {
  const old = await unnormalizedHash(NFD);
  setHash(old);
  assert.equal((await login(NFC)).status, 401);
  assert.equal((await login(NFD)).status, 200);
  assert.notEqual(loadConfig().settings.auth.passwordHash, old);
  assert.equal((await login(NFC)).status, 200);
});
