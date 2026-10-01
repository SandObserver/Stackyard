const path = require('node:path');

process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('guards'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');

require('../src/routes');
require('../src/widgets');
require('../src/widget-data');
const { dispatch, _routeTable } = require('../src/router');
const { saveConfig } = require('../src/config');
const { hashPassword, makeToken } = require('../src/auth');

const SECRET = 'b'.repeat(64);
const PUBLIC = new Set(['/health', '/api/auth/login', '/api/auth/check']);
const routes = _routeTable();
const writes = routes.filter(r => r.method !== 'GET');
const concrete = p => p.replace(/:[^/]+/g, 'x');

let server, host;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${server.address().port}`;
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') } },
  });
});
after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

function send(method, pathname, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: pathname,
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2, ...headers },
      },
      res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      },
    );
    r.on('error', reject);
    r.end('{}');
  });
}

const session = () => `ds=${makeToken('session-guards', SECRET)}`;

test('every source file that registers a route is loaded', () => {
  const src = path.join(__dirname, '../src');
  const registering = fs
    .readdirSync(src, { recursive: true })
    .map(f => path.join(src, String(f)))
    .filter(f => f.endsWith('.js') && /^on\('/m.test(fs.readFileSync(f, 'utf8')));
  assert.ok(registering.length > 5);
  for (const f of registering)
    assert.ok(require.cache[f], `${path.relative(src, f)} registers routes the walk never loads`);
});

test('the walk sees every route file', () => {
  const paths = new Set(routes.map(r => r.path));
  for (const p of [
    '/api/config',
    '/api/auth/toggle',
    '/api/icons/upload',
    '/api/wallpaper/fetch',
    '/api/widget-options/:id',
  ]) {
    assert.ok(paths.has(p), `${p} is not registered`);
  }
});

test('every route outside the public list needs a session', async () => {
  for (const r of routes.filter(route => !PUBLIC.has(route.path))) {
    const res = await send(r.method, concrete(r.path), { Origin: `http://${host}` });
    assert.equal(res.status, 401, `${r.method} ${r.path}`);
  }
});

/* checkOrigin sends the 403 itself. A handler that ignores its result still
   answers 403 after it has written. */
const configFile = () => fs.readFileSync(process.env.CONFIG_PATH, 'utf8');

test('every write refuses another origin', async () => {
  const stored = configFile();
  for (const r of writes) {
    const res = await send(r.method, concrete(r.path), { Cookie: session(), Origin: 'http://evil.example' });
    assert.equal(res.status, 403, `${r.method} ${r.path}`);
    assert.match(res.body, /origin mismatch/, `${r.method} ${r.path}`);
    assert.equal(configFile(), stored, `${r.method} ${r.path} wrote the config`);
  }
});

test('every write refuses a request with no origin', async () => {
  const stored = configFile();
  for (const r of writes) {
    const res = await send(r.method, concrete(r.path), { Cookie: session() });
    assert.equal(res.status, 403, `${r.method} ${r.path}`);
    assert.match(res.body, /needs an Origin header/, `${r.method} ${r.path}`);
    assert.equal(configFile(), stored, `${r.method} ${r.path} wrote the config`);
  }
});
