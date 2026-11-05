const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('new-password'), 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, saveConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');
const { newPasswordError, isCommonPassword } = require('../src/new-password');
const setupCode = require('../src/setup-code');

let server, base;
let clock = Date.now();

function request(method, p, { body, cookie, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const u = new URL(base + p);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    headers.Host = host || u.host;
    headers.Origin = `http://${headers.Host}`;
    if (cookie) headers.Cookie = cookie;
    const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, res => {
      let text = '';
      res.on('data', c => (text += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          body: text ? JSON.parse(text) : null,
          cookie: String(res.headers['set-cookie'] || '').split(';')[0],
        }),
      );
    });
    q.on('error', reject);
    q.end(data);
  });
}

async function signedInWith(password) {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword(password) } } });
  const r = await request('POST', '/api/auth/login', { body: { password } });
  assert.equal(r.status, 200, 'an existing password signs in whatever its length');
  return r.cookie;
}

before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));
beforeEach(() => {
  clock += 16 * 60 * 1000;
  delete process.env.INITIAL_PASSWORD;
  delete process.env.INITIAL_PASSWORD_FILE;
});

test('the list holds only lower-case NFC entries of 15 or more characters', () => {
  const lines = fs.readFileSync(path.join(__dirname, '../src/common-passwords.txt'), 'utf8').split('\n');
  const entries = lines.filter(l => l && !l.startsWith('#'));
  assert.ok(entries.length > 300);
  for (const e of entries) {
    assert.ok([...e].length >= 15, e);
    assert.equal(e, e.normalize('NFC').toLowerCase(), e);
  }
  assert.match(lines.slice(0, 3).join('\n'), /Open Government Licence v3\.0/);
});

test('common passwords are refused whatever their case', () => {
  assert.equal(isCommonPassword('1q2w3e4r5t6y7u8i9o0p'), true);
  assert.equal(isCommonPassword('1Q2W3E4R5T6Y7U8I9O0P'), true);
  assert.equal(isCommonPassword('correct horse battery'), false);
  assert.equal(newPasswordError('1q2w3e4r5t6y7u8i9o0p').code, 'invalid.password-common');
});

test('an existing 8-character password signs in, changes and switches off', async () => {
  const cookie = await signedInWith('old-pass');
  const weak = await request('POST', '/api/auth/set-password', {
    cookie,
    body: { password: 'too-short-new', currentPassword: 'old-pass' },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, 'invalid.password-short');
  const set = await request('POST', '/api/auth/set-password', {
    cookie,
    body: { password: 'a much longer passphrase', currentPassword: 'old-pass' },
  });
  assert.equal(set.status, 200);

  const again = await signedInWith('old-pass');
  const off = await request('POST', '/api/auth/toggle', {
    cookie: again,
    body: { enabled: false, currentPassword: 'old-pass' },
  });
  assert.equal(off.status, 200, 'the current-password check never applies the new rules');
});

test('set-password refuses a common password and one made of the host name', async () => {
  const cookie = await signedInWith('old-pass');
  const common = await request('POST', '/api/auth/set-password', {
    cookie,
    body: { password: '1q2w3e4r5t6y7u8i9o0p', currentPassword: 'old-pass' },
  });
  assert.equal(common.status, 400);
  assert.equal(common.body.code, 'invalid.password-common');
  const host = await request('POST', '/api/auth/set-password', {
    cookie,
    host: '127.0.0.1',
    body: { password: 'Stackyard-Homelab-2025!', currentPassword: 'old-pass' },
  });
  assert.equal(host.body.code, 'invalid.password-common');
  assert.equal(loadConfig().settings.auth.enabled, true);
});

test('INITIAL_PASSWORD that is common stops the first start', async () => {
  saveConfig({ items: [], settings: {} });
  process.env.INITIAL_PASSWORD = '1q2w3e4r5t6y7u8i9o0p';
  await assert.rejects(setupCode.applyInitialPassword(), /too common/);
});
