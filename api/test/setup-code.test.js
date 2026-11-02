const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const DIR = tmpDir('setup-code');
const CFG = path.join(DIR, 'apps.json');
process.env.CONFIG_PATH = CFG;

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig } = require('../src/config');
const { hashPassword, verifyPassword, authActive } = require('../src/auth');
const setupCode = require('../src/setup-code');
const log = require('../src/log');

let server, port;
const HOST = 'stackyard-production.up.railway.app';

function request(pathName, body, { host = HOST, origin = `https://${host}` } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Host: host,
          ...(origin ? { Origin: origin } : {}),
          ...(body === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
            cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0],
          }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(payload);
    req.end();
  });
}

const setup = (code, password, opts) => request('/api/auth/setup-password', { code, password }, opts);

/** The code as the log shows it, grouped with dashes. */
function printedCode() {
  const printed = mock.method(log, 'print', () => {});
  setupCode.announce();
  const text = printed.mock.calls.map(c => c.arguments[0]).join('\n');
  printed.mock.restore();
  return text.match(/Setup code {2}(\S+)/)?.[1] ?? null;
}

let clock = Date.now();
const expireCache = () => (clock += 60_000);

before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => new Promise(r => server.close(r)));

beforeEach(() => {
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
  expireCache();
  setupCode._reset();
  delete process.env.INITIAL_PASSWORD;
  delete process.env.INITIAL_PASSWORD_FILE;
});

test('a refused address prints the setup code once', async () => {
  const printed = mock.method(log, 'print', () => {});
  assert.equal((await request('/api/auth/check')).status, 403);
  assert.equal((await request('/api/auth/check')).status, 403);
  const codes = printed.mock.calls.map(c => c.arguments[0]).filter(t => t.includes('Setup code'));
  printed.mock.restore();
  assert.equal(codes.length, 1);
  assert.match(codes[0], /Setup code {2}([2-9A-Z]{4}-){5}[2-9A-Z]{4}\n/);
});

test('the printed code sets the password on a refused address and signs in', async () => {
  const code = printedCode();
  const r = await setup(code.toLowerCase(), 'correct horse battery');
  assert.equal(r.status, 200);
  assert.ok(r.cookie?.startsWith('ds='));
  const cfg = loadConfig();
  assert.equal(authActive(cfg), true);
  assert.equal(await verifyPassword('correct horse battery', cfg.settings.auth.passwordHash), true);
  assert.equal((await request('/api/auth/check')).status, 200);
});

test('a used code cannot set a second password', async () => {
  const code = printedCode();
  assert.equal((await setup(code, 'first-password')).status, 200);
  const again = await setup(code, 'attacker-password');
  assert.equal(again.status, 409);
  assert.equal(await verifyPassword('first-password', loadConfig().settings.auth.passwordHash), true);
});

test('a wrong code is refused and stores nothing', async () => {
  printedCode();
  const r = await setup('AAAA-BBBB-CCCC', 'attacker-password');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'invalid.setup-code');
  assert.equal(authActive(loadConfig()), false);
});

test('a short password is refused before the code is checked', async () => {
  const code = printedCode();
  const r = await setup(code, 'short');
  assert.equal(r.status, 400);
  assert.equal((await setup(code, 'long enough now')).status, 200);
});

test('wrong codes never lock the owner out or replace the code', async () => {
  const code = printedCode();
  const audit = mock.method(log, 'audit', () => {});
  for (let i = 0; i < 150; i++) assert.equal((await setup(`WRONG-${i}`, 'attacker-password')).status, 403);
  const rejected = audit.mock.calls.filter(c => c.arguments[0] === 'setup code rejected').length;
  audit.mock.restore();
  assert.equal(rejected, 1);
  assert.equal((await setup(code, 'owner-password')).status, 200);
});

test('an address Stackyard answers gets no setup route', async () => {
  printedCode();
  for (const host of ['192.168.1.10', 'localhost', 'nas.local', 'nas']) {
    const r = await setup('ANY', 'attacker-password', { host, origin: `http://${host}` });
    assert.equal(r.status, 404, host);
  }
});

test('a submit with no code yet prints one, so the log holds a code that works', async () => {
  const printed = mock.method(log, 'print', () => {});
  const r = await setup('OLD-CODE-FROM-BEFORE-A-RESTART', 'owner-password');
  const fresh = printed.mock.calls
    .map(c => c.arguments[0])
    .join('\n')
    .match(/Setup code {2}(\S+)/)?.[1];
  printed.mock.restore();
  assert.equal(r.status, 403);
  assert.ok(fresh);
  assert.equal((await setup(fresh, 'owner-password')).status, 200);
});

test('a code pasted with its label, odd dashes or spaces still works', async () => {
  const code = printedCode();
  const pasted = `  Setup code  ${code.replace(/-/g, '\u2011 ')}\u200b`;
  assert.equal((await setup(pasted, 'correct horse battery')).status, 200);
});

test('a password over the maximum is refused with its own reason', async () => {
  const code = printedCode();
  const r = await setup(code, 'x'.repeat(1025));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid.password-long');
});

test('a code printed before a password was set and removed no longer works', async () => {
  const code = printedCode();
  const ip = { host: '192.168.1.10', origin: 'http://192.168.1.10' };
  const set = await request('/api/auth/set-password', { password: 'first-password' }, ip);
  assert.equal(set.status, 200);
  const cookie = set.cookie;
  expireCache();
  const off = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ enabled: false, currentPassword: 'first-password' });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/auth/toggle',
        method: 'POST',
        headers: {
          Host: '192.168.1.10',
          Origin: 'http://192.168.1.10',
          Cookie: cookie,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(off, 200);
  expireCache();
  assert.equal(authActive(loadConfig()), false);
  assert.equal((await setup(code, 'attacker-password')).status, 403);
});

test('a request without an Origin header is refused', async () => {
  const code = printedCode();
  const r = await setup(code, 'correct horse battery', { origin: null });
  assert.equal(r.status, 403);
  assert.equal(authActive(loadConfig()), false);
});

test('the code cannot replace a password that is already set', async () => {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password') } } });
  expireCache();
  const code = printedCode();
  const r = await setup(code, 'attacker-password');
  assert.equal(r.status, 409);
  assert.equal(await verifyPassword('owner-password', loadConfig().settings.auth.passwordHash), true);
});

test('INITIAL_PASSWORD sets the password while none is set', async () => {
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), true);
  const cfg = loadConfig();
  assert.equal(authActive(cfg), true);
  assert.equal(await verifyPassword('from-the-template', cfg.settings.auth.passwordHash), true);
});

test('INITIAL_PASSWORD leaves a password set in Settings alone', async () => {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password') } } });
  expireCache();
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), false);
  assert.equal(await verifyPassword('owner-password', loadConfig().settings.auth.passwordHash), true);
});

test('INITIAL_PASSWORD does not come back after the owner removes the password', async () => {
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), true);
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    settings: { ...cfg.settings, auth: { ...cfg.settings.auth, enabled: false, passwordHash: undefined } },
  });
  expireCache();
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), false);
  assert.equal(authActive(loadConfig()), false);
});

test('INITIAL_PASSWORD_FILE is read, and the variable is cleared after start', async () => {
  const file = path.join(DIR, 'initial-password');
  fs.writeFileSync(file, 'from-a-secret-file\n');
  process.env.INITIAL_PASSWORD_FILE = file;
  process.env.INITIAL_PASSWORD = 'ignored-when-a-file-is-set';
  assert.equal(await setupCode.applyInitialPassword(), true);
  assert.equal(process.env.INITIAL_PASSWORD, undefined);
  assert.equal(await verifyPassword('from-a-secret-file', loadConfig().settings.auth.passwordHash), true);
});

test('a short INITIAL_PASSWORD is ignored with a warning that names $$', async () => {
  const warned = mock.method(log, 'warn', () => {});
  process.env.INITIAL_PASSWORD = 'short';
  assert.equal(await setupCode.applyInitialPassword(), false);
  assert.equal(warned.mock.callCount(), 1);
  assert.match(warned.mock.calls[0].arguments[0], /write each \$ as \$\$/);
  warned.mock.restore();
  assert.equal(authActive(loadConfig()), false);
});

const LAN = { host: '192.168.1.10', origin: 'http://192.168.1.10' };
const damage = () => {
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, passwordHash: '$scrypt$broken', secret: 'x'.repeat(64) } },
  });
  expireCache();
};

test('a damaged password prints a code at sign-in, and the code replaces it on any address', async () => {
  damage();
  const printed = mock.method(log, 'print', () => {});
  const login = await request('/api/auth/login', { password: 'anything' }, LAN);
  const text = printed.mock.calls.map(c => c.arguments[0]).join('\n');
  printed.mock.restore();
  assert.equal(login.status, 401);
  assert.equal(login.body.code, 'auth.password-damaged');
  assert.match(text, /saved dashboard password is damaged/);
  const code = text.match(/Setup code {2}(\S+)/)[1];
  assert.equal((await setup('WRONG-CODE', 'new-owner-pass', LAN)).status, 403);
  const r = await setup(code, 'new-owner-pass', LAN);
  assert.equal(r.status, 200);
  assert.ok(r.cookie?.startsWith('ds='));
  expireCache();
  const cfg = loadConfig();
  assert.equal(await verifyPassword('new-owner-pass', cfg.settings.auth.passwordHash), true);
  assert.notEqual(cfg.settings.auth.secret, 'x'.repeat(64));
  assert.equal((await request('/api/auth/login', { password: 'new-owner-pass' }, LAN)).status, 200);
});

test('a damaged password is not counted as a failed sign-in', async () => {
  damage();
  const printed = mock.method(log, 'print', () => {});
  for (let i = 0; i < 20; i++)
    assert.equal((await request('/api/auth/login', { password: 'x' }, LAN)).body.code, 'auth.password-damaged');
  printed.mock.restore();
});

test('the code cannot replace a password that is intact', async () => {
  saveConfig({ items: [], settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password') } } });
  expireCache();
  const code = printedCode();
  assert.equal((await setup(code, 'attacker-password', LAN)).status, 409);
  assert.equal(await verifyPassword('owner-password', loadConfig().settings.auth.passwordHash), true);
});
