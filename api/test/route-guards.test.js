const path = require('node:path');

const { startApp } = require('../test-support/app');
const app = startApp({
  label: 'guards',
  widgetData: true,
  env: { WIDGETS_PATH: path.join(__dirname, '../../ui/widgets') },
});

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');

const { _routeTable, _resetOriginLog } = require('../src/router');
const log = require('../src/log');
const { saveConfig } = require('../src/config');
const { hashPassword, makeToken } = require('../src/auth');

const SECRET = 'b'.repeat(64);
const PUBLIC = new Set([
  '/health',
  '/api/auth/login',
  '/api/auth/check',
  '/api/auth/setup-password',
  '/api/csp-report',
]);
/* A browser posts a violation report with no Origin. The route stores nothing. */
const REPORT_SINKS = new Set(['/api/csp-report']);
const routes = _routeTable();
const writes = routes.filter(r => r.method !== 'GET' && !REPORT_SINKS.has(r.path));
const concrete = p => p.replace(/:[^/]+/g, 'x');

let host;

before(async () => {
  host = `127.0.0.1:${app.port}`;
  saveConfig({
    items: [],
    settings: { auth: { enabled: true, secret: SECRET, passwordHash: await hashPassword('correct-horse') } },
  });
});
function send(method, pathname, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: app.port,
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
    assert.equal(JSON.parse(res.body).code, 'invalid.origin', `${r.method} ${r.path}`);
    assert.equal(configFile(), stored, `${r.method} ${r.path} wrote the config`);
  }
});

test('a refused origin is logged once per reason, with both hosts', async t => {
  _resetOriginLog();
  const warns = [];
  t.mock.method(log, 'warn', (msg, data) => warns.push({ msg, data }));
  const write = writes.find(r => r.path === '/api/config');
  for (let i = 0; i < 3; i++)
    await send(write.method, write.path, { Cookie: session(), Origin: 'http://evil.example' });
  await send(write.method, write.path, { Cookie: session() });
  assert.deepEqual(
    warns.map(w => w.data.reason),
    ['mismatch', 'missing'],
  );
  assert.equal(warns[0].data.origin, 'evil.example');
  assert.ok(warns[0].data.host);
  assert.equal(warns[0].data.path, '/api/config');
});

test('the violation report route takes no session and changes nothing', async () => {
  const stored = configFile();
  const res = await send('POST', '/api/csp-report', { 'Content-Type': 'application/csp-report' });
  assert.equal(res.status, 204);
  assert.equal(configFile(), stored);
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
