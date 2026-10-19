const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
const DIR = tmpDir('login-limit-hosts');
process.env.CONFIG_PATH = path.join(DIR, 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');

let server, port;
let clock = Date.now();

/* Host and Origin name the same site, as a browser sends them after DNS
   rebinding, so the Origin check passes. */
function login(host, password) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ password });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          Host: host,
          Origin: `http://${host}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => new Promise(r => server.close(r)));

beforeEach(async () => {
  /* Past the 15-minute window, so each test starts with no attempts counted. */
  clock += 16 * 60 * 1000;
  const passwordHash = await hashPassword('correct-horse');
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, passwordHash }, server: { allowedHosts: ['dash.example.com'] } },
  });
});

test('wrong passwords sent under an unlisted name do not lock out the owner', async () => {
  for (let i = 0; i < 5; i++) assert.equal(await login('rebind.evil.example', 'wrong'), 401);
  assert.equal(await login('rebind.evil.example', 'wrong'), 429);
  assert.equal(await login('rebind.evil.example', 'correct-horse'), 429);
  assert.equal(await login('192.168.1.10', 'correct-horse'), 200);
  assert.equal(await login('dash.example.com', 'correct-horse'), 200);
});

test('every unlisted name shares one count, so changing names gains nothing', async () => {
  for (let i = 0; i < 5; i++) assert.equal(await login(`n${i}.evil.example`, 'wrong'), 401);
  assert.equal(await login('another.evil.example', 'wrong'), 429);
});

test('the owner is still limited on a known address', async () => {
  for (let i = 0; i < 5; i++) assert.equal(await login('192.168.1.10', 'wrong'), 401);
  assert.equal(await login('dash.example.com', 'correct-horse'), 429);
});
