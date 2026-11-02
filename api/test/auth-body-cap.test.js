const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const DIR = tmpDir('auth-body-cap');
process.env.CONFIG_PATH = path.join(DIR, 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch, AUTH_BODY_LIMIT } = require('../src/router');
const { saveConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');

let server, port;
const HOST = '192.168.1.10';

function post(pathName, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method: 'POST',
        headers: {
          Host: HOST,
          Origin: `http://${HOST}`,
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

let clock = Date.now();
before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise(r => server.close(r)));
beforeEach(() => {
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
  clock += 60_000;
});

test('a sign-in body over the auth limit is refused', async () => {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password') } } });
  clock += 60_000;
  const body = JSON.stringify({ password: 'p'.repeat(AUTH_BODY_LIMIT + 1) });
  assert.equal(await post('/api/auth/login', body), 400);
});

test('a set-password body over the auth limit is refused', async () => {
  const body = JSON.stringify({ password: 'owner-password', pad: 'p'.repeat(AUTH_BODY_LIMIT) });
  assert.equal(await post('/api/auth/set-password', body), 400);
});

test('a toggle body over the auth limit is refused', async () => {
  const body = JSON.stringify({ enabled: false, pad: 'p'.repeat(AUTH_BODY_LIMIT) });
  assert.equal(await post('/api/auth/toggle', body), 400);
});

test('the largest real auth body, 50 long allowed addresses, still fits', async () => {
  const label = n => `${'a'.repeat(58)}${String(n).padStart(3, '0')}`;
  const hosts = Array.from(
    { length: 50 },
    (_, i) => `${label(i)}.${label(i)}.${label(i)}.${'b'.repeat(64 - 9)}.example`,
  );
  assert.ok(hosts.every(h => h.length <= 253));
  const body = JSON.stringify({ enabled: false, allowedHosts: hosts, currentPassword: 'x'.repeat(1024) });
  assert.ok(body.length > 12_000 && body.length < AUTH_BODY_LIMIT);
  assert.equal(await post('/api/auth/toggle', body), 200);
});

test('nginx refuses auth bodies at the same size as the API', () => {
  const conf = fs.readFileSync(path.join(__dirname, '../../nginx/dashboard.conf'), 'utf8');
  const block = conf.match(/location \^~ \/api\/auth\/ \{([\s\S]*?)\n {4}\}/)?.[1] ?? '';
  assert.match(block, new RegExp(`client_max_body_size ${AUTH_BODY_LIMIT / 1024}k;`));
  assert.match(block, /proxy_set_header X-Real-IP \$remote_addr;/);
});
