const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('busy-refund'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const auth = require('../src/auth');
const realHash = auth.hashPassword;
auth.matchPassword = async () => {
  throw Object.assign(new Error('busy'), { busy: true });
};

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');

let server, base;

before(async () => {
  const passwordHash = await realHash('some-password');
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: 'a'.repeat(64), passwordHash } } });
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

test('a busy hash during sign-in does not use up an attempt', async () => {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ password: 'some-password' }),
    });
    assert.equal(r.status, 503, `attempt ${i}`);
  }
});
