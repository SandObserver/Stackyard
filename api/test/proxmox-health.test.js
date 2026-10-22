const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('proxmox-health'), 'apps.json');
delete process.env.SOCKET_PROXY_URL;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig } = require('../src/config');
const latest = require('../src/latest');

const TOKEN = 'stackyard@pve!dash';
const SECRET = '0b5f7c2e-1d3a-4c6b-9e8f-2a7d4b1c0e9f';

let server, base, pve, pveBase;
let guests = [];
let pveStatus = 200;
const seen = [];

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  pve = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.headers.authorization !== `PVEAPIToken=${TOKEN}=${SECRET}`) {
      res.writeHead(401);
      return res.end();
    }
    res.writeHead(pveStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: guests }));
  });
  pveBase = await listen(pve);
  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(pve);
});
beforeEach(() => {
  latest.reset();
  seen.length = 0;
  pveStatus = 200;
  guests = [
    { vmid: 100, name: 'ha', type: 'qemu', node: 'pve', status: 'running' },
    { vmid: 101, name: 'db', type: 'lxc', node: 'pve', status: 'stopped' },
    { vmid: 900, name: 'tmpl', type: 'qemu', node: 'pve', status: 'stopped', template: 1 },
  ];
});

function request(method, pathname, body) {
  const u = new URL(base + pathname);
  const data = body == null ? null : JSON.stringify(body);
  const headers = data
    ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base }
    : {};
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, res => {
      let b = '';
      res.on('data', c => {
        b += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const app = (id, guest) => ({
  id,
  type: 'app',
  label: id,
  monitoring: { healthcheck: { enabled: true, container: '', pingUrl: '', proxmoxGuest: guest } },
});

function configure(items, extra = {}) {
  saveConfig({
    items,
    settings: {
      server: { proxmox: { url: pveBase, tokenId: TOKEN, secret: SECRET }, ...extra },
    },
  });
}

test('a running guest is healthy and a stopped one is not', async () => {
  configure([app('a', 100), app('b', 101)]);
  const r = (await request('GET', '/api/health')).body;
  assert.deepEqual(r.a, { unhealthy: false, guestState: 'running' });
  assert.deepEqual(r.b, { unhealthy: true, guestState: 'stopped' });
});

test('every tile shares one request to Proxmox', async () => {
  configure([app('a', 100), app('b', 101), app('c', 100)]);
  await request('GET', '/api/health');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api2/json/cluster/resources?type=vm');
});

test('a guest Proxmox does not list is reported as not found', async () => {
  configure([app('a', 555), app('t', 900)]);
  const r = (await request('GET', '/api/health')).body;
  assert.deepEqual(r.a, { unhealthy: true, guestState: 'missing' });
  assert.deepEqual(r.t, { unhealthy: true, guestState: 'missing' }, 'a template is never a guest to watch');
});

/* Proxmox lists a guest as 'unknown', with no name or template flag, while its
   node has not reported. */
test('a guest Proxmox has no figures for is kept apart from a missing one', async () => {
  guests = [{ id: 'qemu/100', vmid: 100, node: 'pve', type: 'qemu', status: 'unknown' }];
  configure([app('a', 100)]);
  const r = (await request('GET', '/api/health')).body;
  assert.deepEqual(r.a, { unhealthy: true, guestState: 'unknown' });
});

test('an address copied from the Proxmox tab still reaches the API', async () => {
  saveConfig({
    items: [app('a', 100)],
    settings: { server: { proxmox: { url: `${pveBase}/#v1:0:18:4:::::::`, tokenId: TOKEN, secret: SECRET } } },
  });
  const r = (await request('GET', '/api/health')).body;
  assert.deepEqual(r.a, { unhealthy: false, guestState: 'running' });
  assert.equal(seen[0].url, '/api2/json/cluster/resources?type=vm');
});

test('a refused token turns the tile red with the reason', async () => {
  saveConfig({
    items: [app('a', 100)],
    settings: { server: { proxmox: { url: pveBase, tokenId: TOKEN, secret: '11111111-2222-3333-4444-555555555555' } } },
  });
  const r = (await request('GET', '/api/health')).body;
  assert.equal(r.a.unhealthy, true);
  assert.equal(r.a.proxmoxError, 'Proxmox refused the token.');
  assert.equal(r.a.proxmoxCode, 'upstream.proxmox-refused');
});

test('a tile set to Proxmox with no connection says so', async () => {
  saveConfig({ items: [app('a', 100)], settings: { server: {} } });
  const r = (await request('GET', '/api/health')).body;
  assert.equal(r.a.unhealthy, true);
  assert.match(r.a.proxmoxError, /not set up/);
  assert.equal(r.a.proxmoxCode, 'invalid.proxmox-missing');
  assert.equal(seen.length, 0);
});

test('with health checks off nothing is checked', async () => {
  configure([app('a', 101), { id: 'p', type: 'app', ping: pveBase }], { healthChecks: false });
  assert.deepEqual((await request('GET', '/api/health')).body, {});
  assert.equal(seen.length, 0);
});

test('a disabled check is not sent to Proxmox', async () => {
  const off = app('a', 101);
  off.monitoring.healthcheck.enabled = false;
  configure([off]);
  assert.deepEqual((await request('GET', '/api/health')).body, {});
});

/* ── the stored secret ───────────────────────────────────────────────────── */

test('the secret never reaches the browser', async () => {
  configure([]);
  const cfg = (await request('GET', '/api/config')).body;
  assert.equal(cfg.settings.server.proxmox.secret, undefined);
  assert.equal(cfg.settings.server.proxmox.secretSet, true);
  const exported = (await request('GET', '/api/config/export')).body;
  assert.equal(exported.settings.server.proxmox.secret, undefined);
});

test('a save without the secret keeps it for the same address and token', async () => {
  configure([]);
  const cfg = (await request('GET', '/api/config')).body;
  const r = await request('POST', '/api/config', cfg);
  assert.equal(r.status, 200);
  assert.equal(r.body.withheld, undefined);
  assert.equal(loadConfig().settings.server.proxmox.secret, SECRET);
  assert.equal(loadConfig().settings.server.proxmox.secretSet, undefined);
});

test('pointing the secret at another address drops it and says so', async () => {
  configure([]);
  for (const change of [
    { url: 'https://elsewhere.example:8006' },
    { tokenId: 'root@pam!other' },
    { skipTlsVerify: true },
  ]) {
    configure([]);
    const cfg = (await request('GET', '/api/config')).body;
    Object.assign(cfg.settings.server.proxmox, change);
    const r = await request('POST', '/api/config', cfg);
    assert.deepEqual(r.body.withheld, [{ id: 'proxmox', label: 'Proxmox' }], JSON.stringify(change));
    assert.equal(loadConfig().settings.server.proxmox.secret, undefined);
  }
});

/* ── the Test button and the guest list ──────────────────────────────────── */

test('the test counts the guests a tile can watch', async () => {
  configure([]);
  const r = await request('POST', '/api/proxmox/test', { url: pveBase, tokenId: TOKEN, secret: SECRET });
  assert.deepEqual(r.body, { ok: true, guests: 2 });
});

test('a test with a blank secret uses the stored one only for the same address', async () => {
  configure([]);
  const same = await request('POST', '/api/proxmox/test', { url: pveBase, tokenId: TOKEN });
  assert.equal(same.body.ok, true);
  const moved = await request('POST', '/api/proxmox/test', { url: 'http://127.0.0.1:9', tokenId: TOKEN });
  assert.equal(moved.body.code, 'invalid.retype');
});

test('a test reports each failure as a code the admin translates', async () => {
  saveConfig({ items: [], settings: { server: {} } });
  const cases = [
    [{ url: pveBase, tokenId: TOKEN }, 'invalid.proxmox-missing'],
    [{ url: pveBase, tokenId: 'not-a-token', secret: SECRET }, 'invalid.proxmox-token'],
    [{ url: pveBase, tokenId: TOKEN, secret: '11111111-2222-3333-4444-555555555555' }, 'upstream.proxmox-refused'],
  ];
  for (const [body, code] of cases) {
    const r = await request('POST', '/api/proxmox/test', body);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.code, code, JSON.stringify(body));
  }
  pveStatus = 403;
  const denied = await request('POST', '/api/proxmox/test', { url: pveBase, tokenId: TOKEN, secret: SECRET });
  assert.equal(denied.body.code, 'upstream.proxmox-permission');
});

test('the guest list names each guest without its state', async () => {
  configure([]);
  const r = await request('GET', '/api/proxmox/guests');
  assert.deepEqual(r.body.guests, [
    { vmid: 100, name: 'ha', type: 'qemu', node: 'pve' },
    { vmid: 101, name: 'db', type: 'lxc', node: 'pve' },
  ]);
});

test('the guest list without a connection asks for one', async () => {
  saveConfig({ items: [], settings: { server: {} } });
  const r = await request('GET', '/api/proxmox/guests');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid.proxmox-missing');
});
