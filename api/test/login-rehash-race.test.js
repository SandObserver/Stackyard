const path = require('node:path');
const crypto = require('node:crypto');

const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('rehash-race');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const auth = require('../src/auth');
const realHash = auth.hashPassword;
let duringHash = null;
auth.hashPassword = async password => {
  const h = await realHash(password);
  if (duringHash) {
    const run = duringHash;
    duringHash = null;
    run();
  }
  return h;
};

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, loadConfigForUpdate, saveConfig } = require('../src/config');

let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

function login(password) {
  const data = JSON.stringify({ password });
  const u = new URL(base + '/api/auth/login');
  return new Promise((resolve, reject) => {
    const q = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    q.on('error', reject);
    q.end(data);
  });
}

test('a config write made while a login upgrades the hash is kept', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const legacy = `${salt}:${crypto.scryptSync('correct-horse', salt, 64).toString('hex')}`;
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: 'a'.repeat(64), passwordHash: legacy } } });
  duringHash = () => {
    const mid = loadConfigForUpdate();
    mid.items = [{ id: 'added-meanwhile', type: 'app', name: 'Added' }];
    saveConfig(mid);
  };

  assert.equal(await login('correct-horse'), 200);
  const saved = loadConfig();
  assert.deepEqual(
    saved.items.map(i => i.id),
    ['added-meanwhile'],
  );
  assert.notEqual(saved.settings.auth.passwordHash, legacy, 'the hash should still have been upgraded');
});
