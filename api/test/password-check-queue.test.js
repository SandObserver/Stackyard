const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('password-check-queue'), 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const fs = require('node:fs');
const {
  hashPassword,
  verifyPassword,
  hashQueueFull,
  clearAttempts,
  HASH_QUEUE_WAIT_MS,
  _hashQueueLength,
} = require('../src/auth');
const log = require('../src/log');

const PASSWORD = 'quiet otter lantern 42';
let server,
  port,
  nextAddr = 1;
const freshIp = () => `10.20.${Math.floor(nextAddr / 250)}.${(nextAddr++ % 250) + 1}`;

function login(password, ip) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ password });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          Host: '192.168.1.10',
          Origin: 'http://192.168.1.10',
          'X-Real-IP': ip,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function holdScrypt() {
  const real = crypto.scrypt;
  const held = [];
  let running = 0;
  let most = 0;
  const m = mock.method(crypto, 'scrypt', (...args) => {
    const done = args.at(-1);
    running++;
    most = Math.max(most, running);
    held.push(() => {
      running--;
      real(...args.slice(0, -1), done);
    });
  });
  return {
    held,
    most: () => most,
    async releaseUntil(work) {
      let done = false;
      Promise.allSettled(work).then(() => {
        done = true;
      });
      while (!done) {
        held.shift()?.();
        await new Promise(r => setTimeout(r, 5));
      }
    },
    restore: () => m.mock.restore(),
  };
}

/* Do not replace with a fixed sleep. Under the full suite it can expire first,
   and a failed assert before the release hangs the run. */
async function until(check, what) {
  const end = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword(PASSWORD) } } });
});
after(() => server.close());
beforeEach(() => mock.restoreAll());

test('password hashes run one at a time', async () => {
  const stored = await hashPassword(PASSWORD);
  const gate = holdScrypt();
  const checks = Array.from({ length: 5 }, () => verifyPassword('wrong password here', stored));
  const work = [hashPassword('a'), hashPassword('b'), hashPassword('c'), ...checks];
  try {
    await until(() => gate.held.length === 1, 'the first hash');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(gate.held.length, 1, 'only the first hash has started');
  } finally {
    await gate.releaseUntil(work);
    gate.restore();
  }
  assert.deepEqual(await Promise.all(checks), [false, false, false, false, false]);
  assert.equal(gate.most(), 1);
});

test('a full queue answers busy at once, and the refused sign-in costs no guess', async () => {
  const gate = holdScrypt();
  const waiting = Array.from({ length: 17 }, () => login('wrong password here', freshIp()));
  const ip = freshIp();
  let clock;
  try {
    await until(hashQueueFull, 'a full queue');
    const busy = await login('wrong password here', ip);
    assert.equal(busy.status, 503);
    assert.equal(busy.body.code, 'blocked.busy');
    const now = Date.now();
    clock = mock.method(Date, 'now', () => now);
  } finally {
    await gate.releaseUntil(waiting);
    gate.restore();
    clock?.mock.restore();
  }
  const statuses = (await Promise.all(waiting)).map(r => r.status);
  assert.deepEqual(
    statuses.filter(s => s !== 401),
    [],
  );

  const later = [];
  for (let i = 0; i < 6; i++) later.push((await login('wrong password here', ip)).status);
  assert.deepEqual(later, [401, 401, 401, 401, 401, 429], 'all five guesses are still there');
  clearAttempts(ip);
});

test('the queue wait stays well below the nginx timeout for sign-in requests', () => {
  const conf = fs.readFileSync(path.join(__dirname, '../../nginx/dashboard.conf'), 'utf8');
  const block = conf.slice(conf.indexOf('location ^~ /api/auth/ {'));
  const seconds = Number(/proxy_read_timeout\s+(\d+)s;/.exec(block)[1]);
  assert.ok(HASH_QUEUE_WAIT_MS + 3000 <= seconds * 1000, `${HASH_QUEUE_WAIT_MS} ms against ${seconds} s`);
});

test('a hash whose turn comes after the queue wait does not run', async () => {
  const gate = holdScrypt();
  const first = hashPassword('a');
  let late;
  try {
    await until(() => gate.held.length === 1, 'the first hash');
    late = hashPassword('b').catch(e => e);
    await until(() => _hashQueueLength() === 1, 'the queued hash');
    const start = Date.now();
    mock.method(Date, 'now', () => start + HASH_QUEUE_WAIT_MS + 1);
  } finally {
    await gate.releaseUntil([first, late]);
    gate.restore();
  }
  assert.equal((await late)?.busy, true);
});

test('a hash queued for a closed connection does not run', async () => {
  const gate = holdScrypt();
  const first = hashPassword('a');
  const ac = new AbortController();
  let gone;
  try {
    await until(() => gate.held.length === 1, 'the first hash');
    gone = hashPassword('b', { signal: ac.signal }).catch(e => e);
    await until(() => _hashQueueLength() === 1, 'the queued hash');
    ac.abort();
  } finally {
    await gate.releaseUntil([first, gone]);
    gate.restore();
  }
  assert.equal((await gone)?.busy, true);
});

test('a sign-in that waited too long answers busy and costs no guess', async () => {
  const gate = holdScrypt();
  const ahead = login('wrong password here', freshIp());
  const ip = freshIp();
  let late;
  try {
    await until(() => gate.held.length === 1, 'the first check');
    late = login('wrong password here', ip);
    await until(() => _hashQueueLength() === 1, 'the queued check');
    const start = Date.now();
    mock.method(Date, 'now', () => start + HASH_QUEUE_WAIT_MS + 1);
  } finally {
    await gate.releaseUntil([ahead, late]);
    gate.restore();
  }
  const r = await late;
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'blocked.busy');

  const later = [];
  for (let i = 0; i < 6; i++) later.push((await login('wrong password here', ip)).status);
  assert.deepEqual(later, [401, 401, 401, 401, 401, 429], 'all five guesses are still there');
  clearAttempts(ip);
});

test('the correct password still signs in after a queue of wrong ones', async () => {
  const wrong = Array.from({ length: 6 }, () => login('wrong password here', freshIp()));
  const right = login(PASSWORD, freshIp());
  await Promise.all(wrong);
  assert.equal((await right).status, 200);
});

/* ── the log under a flood of refused sign-ins ───────────────────────────── */

test('a blocked address is logged once per lockout window, with its address', async () => {
  const now = Date.now() + 5 * 60_000;
  mock.method(Date, 'now', () => now);
  const lines = [];
  mock.method(log, 'audit', (msg, fields) => lines.push({ msg, fields }));
  const ip = freshIp();
  for (let i = 0; i < 25; i++) await login('wrong password here', ip);
  const blocked = lines.filter(l => l.msg === 'login blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].fields.ip, ip);
  assert.equal(lines.filter(l => l.msg === 'login failed').length, 5);
});

test('past the per-minute cap, lines are counted, then summed up in one line', async () => {
  let now = Date.now() + 10 * 60_000;
  mock.method(Date, 'now', () => now);
  const lines = [];
  mock.method(log, 'audit', (msg, fields) => lines.push({ msg, fields }));
  for (let i = 0; i < 40; i++) await login('wrong password here', freshIp());
  const failed = lines.filter(l => l.msg === 'login failed').length;
  assert.ok(failed <= 30, `at most 30 lines a minute, got ${failed}`);

  now += 61_000;
  await login('wrong password here', freshIp());
  const summary = lines.filter(l => l.msg === 'sign-in events not logged one by one').at(-1);
  assert.ok(summary, 'a summary line follows');
  assert.equal(summary.fields.count, 40 - failed);
});
