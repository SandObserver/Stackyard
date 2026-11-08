const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('toggle-race'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const auth = require('../src/auth');
const realVerify = auth.verifyPassword;
let duringVerify = null;
auth.verifyPassword = async (password, hash) => {
  const ok = await realVerify(password, hash);
  if (duringVerify) {
    const run = duringVerify;
    duringVerify = null;
    run();
  }
  return ok;
};

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, loadConfigForUpdate, saveConfig } = require('../src/config');

const SECRET = 'a'.repeat(64);
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

test('a password changed during the check is not deleted by turning protection off', async () => {
  const oldHash = await auth.hashPassword('old-password-here');
  const newHash = await auth.hashPassword('new-password-here');
  saveConfig({ items: [], settings: { auth: { enabled: true, secret: SECRET, passwordHash: oldHash } } });
  duringVerify = () => {
    const cfg = loadConfigForUpdate();
    cfg.settings.auth.passwordHash = newHash;
    saveConfig(cfg);
  };
  const r = await fetch(`${base}/api/auth/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      Cookie: `ds=${auth.makeToken('session-abc', SECRET)}`,
    },
    body: JSON.stringify({ enabled: false, currentPassword: 'old-password-here' }),
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'invalid.password-changed');
  assert.equal(loadConfig().settings.auth.passwordHash, newHash);
});
