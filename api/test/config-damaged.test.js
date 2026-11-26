const path = require('node:path');
const fs = require('node:fs');
const { startApp } = require('../test-support/app');
const app = startApp({ label: 'config-damaged' });
const DIR = app.dir;
const CFG = path.join(DIR, 'apps.json');

const { test, before, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { saveConfig, loadConfig, SCHEMA_VERSION } = require('../src/config');
const { hashPassword, clearAttempts } = require('../src/auth');

let original;

function request(method, pathName, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      app.base + pathName,
      {
        method,
        headers: {
          Origin: app.base,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
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

/* Moves the clock past the config cache, so the next read goes to disk. */
let clock = Date.now();
function expireCache() {
  clock += 60_000;
}

function reset() {
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
}

before(async () => {
  mock.method(Date, 'now', () => clock);
  const passwordHash = await hashPassword('correct-horse');
  original = {
    items: [{ id: 'a', type: 'app', label: 'Keep me' }],
    settings: { auth: { enabled: true, passwordHash } },
  };
});

beforeEach(() => {
  reset();
  clearAttempts('127.0.0.1');
  saveConfig(structuredClone(original));
  expireCache();
});

const backups = () => fs.readdirSync(DIR).filter(f => f.startsWith('apps.json.corrupt'));

test('a corrupt file keeps sign-in on and refuses every write', async () => {
  const broken = fs.readFileSync(CFG, 'utf8').slice(0, 40);
  fs.writeFileSync(CFG, broken);
  expireCache();

  for (const [method, p, body] of [
    ['GET', '/api/config'],
    ['GET', '/api/auth/check'],
    ['POST', '/api/auth/set-password', { password: 'attacker-pass-1' }],
    ['POST', '/api/auth/login', { password: 'anything' }],
    ['POST', '/api/config', { items: [], settings: {} }],
  ]) {
    const r = await request(method, p, body);
    assert.equal(r.status, 503, `${method} ${p}`);
    assert.equal(r.body.code, 'internal.config-corrupt', `${method} ${p}`);
    assert.equal(r.body.detail.file, 'apps.json');
    assert.deepEqual([r.body.detail.backup], backups());
  }
  assert.equal(fs.readFileSync(CFG, 'utf8'), broken);
  assert.throws(() => saveConfig({ items: [], settings: {} }));
});

test('a file that cannot be read keeps sign-in on and refuses every write', async () => {
  fs.rmSync(CFG);
  fs.mkdirSync(CFG);
  expireCache();

  const set = await request('POST', '/api/auth/set-password', { password: 'attacker-pass-1' });
  assert.equal(set.status, 503);
  assert.equal(set.body.code, 'internal.config-unreadable');
  assert.deepEqual(set.body.detail, { file: 'apps.json' });
  assert.equal((await request('GET', '/api/config')).status, 503);
  assert.ok(fs.statSync(CFG).isDirectory());
  assert.equal(backups().length, 0);
});

test('a file saved by a newer version is never migrated or saved', async () => {
  const newer = JSON.stringify({ ...original, _schemaVersion: SCHEMA_VERSION + 1, _rev: 7 });
  fs.writeFileSync(CFG, newer);
  expireCache();

  for (const [method, p, body] of [
    ['GET', '/api/config'],
    ['GET', '/api/auth/check'],
    ['POST', '/api/auth/login', { password: 'correct-horse' }],
    ['POST', '/api/config', { items: [], settings: {} }],
  ]) {
    const r = await request(method, p, body);
    assert.equal(r.status, 503, `${method} ${p}`);
    assert.equal(r.body.code, 'internal.config-newer', `${method} ${p}`);
    assert.deepEqual(r.body.detail, { file: 'apps.json' });
  }
  assert.equal(loadConfig().items.length, 0);
  assert.throws(() => saveConfig({ items: [], settings: {} }));
  assert.equal(fs.readFileSync(CFG, 'utf8'), newer);
  assert.equal(backups().length, 0);

  fs.writeFileSync(CFG, JSON.stringify({ ...original, _schemaVersion: SCHEMA_VERSION }));
  expireCache();
  assert.equal((await request('GET', '/api/config')).status, 401);
});

test('health still answers while the file is damaged', async () => {
  fs.writeFileSync(CFG, '{ broken');
  expireCache();
  assert.equal((await request('GET', '/health')).status, 200);
});

test('a repaired file brings the protected install back', async () => {
  fs.writeFileSync(CFG, '{ broken');
  expireCache();
  assert.equal((await request('GET', '/api/config')).status, 503);

  fs.writeFileSync(CFG, JSON.stringify(original));
  expireCache();
  const r = await request('GET', '/api/config');
  assert.equal(r.status, 401);
  assert.equal(r.body.auth, true);
  assert.equal(loadConfig().items[0].label, 'Keep me');
});

test('a deleted file starts first-time setup', async () => {
  fs.writeFileSync(CFG, '{ broken');
  expireCache();
  assert.equal((await request('GET', '/api/config')).status, 503);

  fs.rmSync(CFG);
  expireCache();
  const r = await request('GET', '/api/auth/check');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
});
