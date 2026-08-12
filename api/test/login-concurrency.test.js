const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('login-concurrency');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { hashPassword } = require('../src/auth');

const PASSWORD = 'correct-horse-battery-staple';
const LOGIN_MAX = 5; /* mirrors LOGIN_MAX in api/src/auth.js */
let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  saveConfig({
    items: [],
    settings: {
      auth: {
        enabled: true,
        secret: 'a'.repeat(64),
        passwordHash: await hashPassword(PASSWORD),
      },
    },
  });
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

let _ip = 0;
const nextIp = () => `10.9.${Math.floor(_ip / 250)}.${(_ip++ % 250) + 1}`;

function login(password, ip) {
  const data = JSON.stringify({ password });
  const u = new URL(base + '/api/auth/login');
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Origin: base,
          'X-Real-IP': ip,
        },
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

const countBy = results =>
  results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

test('a burst of wrong passwords is counted, not waved through', async () => {
  const ip = nextIp();
  const burst = 20;
  /* All in flight before any verification can finish. */
  const results = await Promise.all(Array.from({ length: burst }, () => login('wrong', ip)));
  const counts = countBy(results);
  assert.equal(
    counts[401],
    LOGIN_MAX,
    `expected exactly ${LOGIN_MAX} attempts to reach verification, got ${JSON.stringify(counts)}`,
  );
  assert.equal(counts[429], burst - LOGIN_MAX, `expected the rest to be refused, got ${JSON.stringify(counts)}`);
});

test('the correct password is refused too once the burst has used the attempts', async () => {
  const ip = nextIp();
  await Promise.all(Array.from({ length: 20 }, () => login('wrong', ip)));
  const after = await login(PASSWORD, ip);
  assert.equal(after.status, 429);
  assert.match(after.body.error, /Too many attempts/);
});

test('the lockout message counts down in minutes', async () => {
  const ip = nextIp();
  const results = await Promise.all(Array.from({ length: 8 }, () => login('wrong', ip)));
  const refused = results.find(r => r.status === 429);
  assert.ok(refused, 'nothing was refused');
  assert.match(refused.body.error, /Try again in \d+ minutes?\./);
});

test('a successful login clears the attempts spent before it', async () => {
  const ip = nextIp();
  /* Sequential, staying under the ceiling, so the success is reached. */
  for (let i = 0; i < LOGIN_MAX - 1; i++) {
    const r = await login('wrong', ip);
    assert.equal(r.status, 401);
  }
  assert.equal((await login(PASSWORD, ip)).status, 200);
  /* A full burst is available again, which it would not be if the counter had
     survived the success. */
  const results = await Promise.all(Array.from({ length: 20 }, () => login('wrong', ip)));
  assert.equal(countBy(results)[401], LOGIN_MAX);
});

test('one client using up its attempts does not lock out another', async () => {
  const victim = nextIp();
  const attacker = nextIp();
  await Promise.all(Array.from({ length: 20 }, () => login('wrong', attacker)));
  assert.equal((await login(PASSWORD, victim)).status, 200);
});

test('simultaneous bursts from different clients are counted separately', async () => {
  const a = nextIp(),
    b = nextIp();
  const interleaved = [];
  for (let i = 0; i < 10; i++) {
    interleaved.push(login('wrong', a), login('wrong', b));
  }
  const results = await Promise.all(interleaved);
  /* Ten each, five allowed each: interleaving two clients must not let either
     spend the other's allowance. */
  assert.deepEqual(countBy(results), { 401: LOGIN_MAX * 2, 429: (10 - LOGIN_MAX) * 2 });
});
