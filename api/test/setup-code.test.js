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

const LAN_ADDR = { host: '192.168.1.10', origin: 'http://192.168.1.10' };
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
  assert.equal((await setup(code, 'first-password-here')).status, 200);
  const again = await setup(code, 'attacker-password');
  assert.equal(again.status, 409);
  assert.equal(await verifyPassword('first-password-here', loadConfig().settings.auth.passwordHash), true);
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
  assert.equal((await setup(code, 'owner-password-here')).status, 200);
});

test('rejected codes after the first are logged when the window ends', async () => {
  const { flushRejectedCodes } = require('../src/routes/auth');
  const code = printedCode();
  flushRejectedCodes(Date.now() + 120_000);
  const audit = mock.method(log, 'audit', () => {});
  for (let i = 0; i < 3; i++) await setup(`WRONG-${i}`, 'attacker-password');
  flushRejectedCodes(Date.now() + 240_000);
  const lines = audit.mock.calls.filter(c => c.arguments[0] === 'setup code rejected');
  audit.mock.restore();
  assert.equal(
    lines.reduce((sum, c) => sum + c.arguments[1].count, 0),
    3,
  );
  assert.equal((await setup(code, 'owner-password-here')).status, 200);
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
  const r = await setup('OLD-CODE-FROM-BEFORE-A-RESTART', 'owner-password-here');
  const fresh = printed.mock.calls
    .map(c => c.arguments[0])
    .join('\n')
    .match(/Setup code {2}(\S+)/)?.[1];
  printed.mock.restore();
  assert.equal(r.status, 403);
  assert.ok(fresh);
  assert.equal((await setup(fresh, 'owner-password-here')).status, 200);
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
  const set = await request('/api/auth/set-password', { password: 'first-password-here', code }, ip);
  assert.equal(set.status, 200);
  const cookie = set.cookie;
  expireCache();
  const off = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ enabled: false, currentPassword: 'first-password-here' });
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
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password-here') } },
  });
  expireCache();
  const code = printedCode();
  const r = await setup(code, 'attacker-password');
  assert.equal(r.status, 409);
  assert.equal(await verifyPassword('owner-password-here', loadConfig().settings.auth.passwordHash), true);
});

test('INITIAL_PASSWORD sets the password while none is set', async () => {
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), true);
  const cfg = loadConfig();
  assert.equal(authActive(cfg), true);
  assert.equal(await verifyPassword('from-the-template', cfg.settings.auth.passwordHash), true);
});

test('INITIAL_PASSWORD leaves a password set in Settings alone', async () => {
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password-here') } },
  });
  expireCache();
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), false);
  assert.equal(await verifyPassword('owner-password-here', loadConfig().settings.auth.passwordHash), true);
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

test('INITIAL_PASSWORD_FILE is read and wins over INITIAL_PASSWORD', async () => {
  const file = path.join(DIR, 'initial-password');
  fs.writeFileSync(file, 'from-a-secret-file\n');
  process.env.INITIAL_PASSWORD_FILE = file;
  process.env.INITIAL_PASSWORD = 'ignored-when-a-file-is-set';
  assert.equal(await setupCode.applyInitialPassword(), true);
  assert.equal(await verifyPassword('from-a-secret-file', loadConfig().settings.auth.passwordHash), true);
});

test('INITIAL_PASSWORD_FILE drops a byte-order mark and every trailing line ending', async () => {
  const file = path.join(DIR, 'initial-password');
  fs.writeFileSync(file, '\uFEFFfrom-a-secret-file\r\n\r\n');
  process.env.INITIAL_PASSWORD_FILE = file;
  assert.equal(await setupCode.applyInitialPassword(), true);
  assert.equal(await verifyPassword('from-a-secret-file', loadConfig().settings.auth.passwordHash), true);
});

test('an INITIAL_PASSWORD_FILE saved as UTF-16 is refused, not stored', async () => {
  const file = path.join(DIR, 'initial-password');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('from-a-secret-file', 'utf16le')]));
  process.env.INITIAL_PASSWORD_FILE = file;
  await assert.rejects(setupCode.applyInitialPassword(), {
    name: 'Error',
    message: /control characters or text that is not UTF-8/,
  });
  assert.equal(authActive(loadConfig()), false);
});

test('an INITIAL_PASSWORD_FILE that cannot be read is an error, not a skip', async () => {
  process.env.INITIAL_PASSWORD_FILE = path.join(DIR, 'not-mounted');
  await assert.rejects(setupCode.applyInitialPassword(), /INITIAL_PASSWORD_FILE could not be read/);
  assert.equal(authActive(loadConfig()), false);
});

test('a short INITIAL_PASSWORD is an error that names $$', async () => {
  process.env.INITIAL_PASSWORD = 'short';
  await assert.rejects(
    setupCode.applyInitialPassword(),
    /at least 15 characters\. In docker-compose\.yml or \.env, write each \$ as \$\$/,
  );
  assert.equal(authActive(loadConfig()), false);
});

test('INITIAL_PASSWORD after a skipped prompt is ignored with a warning', async () => {
  saveConfig({ items: [], settings: { auth: { setupPrompted: true } } });
  expireCache();
  const warned = mock.method(log, 'warn', () => {});
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), false);
  const messages = warned.mock.calls.map(c => c.arguments[0]);
  warned.mock.restore();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /INITIAL_PASSWORD ignored: a password was set, skipped or removed before/);
  assert.equal(authActive(loadConfig()), false);
});

test('INITIAL_PASSWORD applied once is not reported again on later starts', async () => {
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), true);
  expireCache();
  const warned = mock.method(log, 'warn', () => {});
  assert.equal(await setupCode.applyInitialPassword(), false);
  const calls = warned.mock.callCount();
  warned.mock.restore();
  assert.equal(calls, 0);
});

test('INITIAL_PASSWORD waits while the settings file is damaged', async () => {
  fs.writeFileSync(CFG, '{ not json');
  expireCache();
  const warned = mock.method(log, 'warn', () => {});
  process.env.INITIAL_PASSWORD = 'from-the-template';
  assert.equal(await setupCode.applyInitialPassword(), false);
  const messages = warned.mock.calls.map(c => c.arguments[0]);
  warned.mock.restore();
  assert.ok(messages.some(m => /INITIAL_PASSWORD not applied: the settings file cannot be used/.test(m)));
  assert.equal(fs.readFileSync(CFG, 'utf8'), '{ not json');
});

test('setting a password retires a printed code', async () => {
  const code = printedCode();
  assert.equal(
    (await request('/api/auth/set-password', { password: 'first-password-here', code }, LAN_ADDR)).status,
    200,
  );
  saveConfig({ items: [], settings: {} });
  expireCache();
  const printed = mock.method(log, 'print', () => {});
  assert.equal((await setup(code, 'attacker-password')).status, 403);
  printed.mock.restore();
});

test('two submits of the right code at once set one password', async () => {
  const code = printedCode();
  const results = await Promise.all([setup(code, 'first-submit-pw'), setup(code, 'second-submit-pw')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  expireCache();
  const hash = loadConfig().settings.auth.passwordHash;
  const winner = results[0].status === 200 ? 'first-submit-pw' : 'second-submit-pw';
  assert.equal(await verifyPassword(winner, hash), true);
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
  assert.equal((await setup('WRONG-CODE', 'new-owner-password', LAN)).status, 403);
  const r = await setup(code, 'new-owner-password', LAN);
  assert.equal(r.status, 200);
  assert.ok(r.cookie?.startsWith('ds='));
  expireCache();
  const cfg = loadConfig();
  assert.equal(await verifyPassword('new-owner-password', cfg.settings.auth.passwordHash), true);
  assert.notEqual(cfg.settings.auth.secret, 'x'.repeat(64));
  assert.equal((await request('/api/auth/login', { password: 'new-owner-password' }, LAN)).status, 200);
});

test('a damaged password is not counted as a failed sign-in', async () => {
  damage();
  const printed = mock.method(log, 'print', () => {});
  for (let i = 0; i < 20; i++)
    assert.equal((await request('/api/auth/login', { password: 'x' }, LAN)).body.code, 'auth.password-damaged');
  printed.mock.restore();
});

test('the code cannot replace a password that is intact', async () => {
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, passwordHash: await hashPassword('owner-password-here') } },
  });
  expireCache();
  const code = printedCode();
  assert.equal((await setup(code, 'attacker-password', LAN)).status, 409);
  assert.equal(await verifyPassword('owner-password-here', loadConfig().settings.auth.passwordHash), true);
});

function rawPost(pathName, payload, { host = HOST, origin = `https://${host}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method: 'POST',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

test('bodies that are not a JSON object get a 400 with no log line on every public auth route', async () => {
  const logged = mock.method(log, 'error', () => {});
  const printed = mock.method(log, 'print', () => {});
  const routes = [
    ['/api/auth/setup-password', {}],
    ['/api/auth/login', LAN_ADDR],
    ['/api/auth/set-password', LAN_ADDR],
    ['/api/auth/toggle', LAN_ADDR],
  ];
  for (const [route, opts] of routes) {
    for (const payload of ['{', 'null', '[]', '"text"', '42']) {
      const r = await rawPost(route, payload, opts);
      assert.equal(r.status, 400, `${route} ${payload}`);
      assert.equal(r.body.kind, 'invalid', `${route} ${payload}`);
    }
  }
  const errors = logged.mock.callCount();
  logged.mock.restore();
  printed.mock.restore();
  assert.equal(errors, 0);
});
