const path = require('node:path');
const fs = require('node:fs');

const { tmpDir } = require('../test-support/tmp');
const root = tmpDir('retype');
const widgetsDir = path.join(root, 'widgets');
fs.mkdirSync(widgetsDir, { recursive: true });
process.env.WIDGETS_PATH = widgetsDir;
process.env.CONFIG_PATH = path.join(root, 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, loadConfig, HELD_PATH } = require('../src/config');
const { loadRegistry } = require('../src/widgets');
const log = require('../src/log');

const MANIFEST = {
  name: 'retired',
  label: 'Retired',
  sizes: ['small'],
  fields: [
    { key: 'url', type: 'text', label: 'Address' },
    { key: 'apiKey', type: 'secret', label: 'API key' },
    { key: 'refresh', type: 'number', label: 'Refresh' },
  ],
};
const STORED = { url: 'http://retired.lan:8080', apiKey: 'STORED-KEY', refresh: 30 };
const RELEASED = { url: STORED.url, refresh: 30 };
const SERVER = { hostIp: '10.0.0.5', portMap: { 8080: { host: 'retired.lan', port: '8081' } } };
const ITEM = { id: 'w1', type: 'widget', label: 'Old service', widgetType: 'retired' };
const HELD_W1 = { w1: { widgetType: 'retired', widgetConfig: STORED } };

const installManifest = () => {
  fs.mkdirSync(path.join(widgetsDir, 'retired'), { recursive: true });
  fs.writeFileSync(path.join(widgetsDir, 'retired', 'widget.json'), JSON.stringify(MANIFEST));
  loadRegistry();
};
const removeManifest = () => {
  fs.rmSync(path.join(widgetsDir, 'retired'), { recursive: true, force: true });
  loadRegistry();
};
const rawConfig = () => fs.readFileSync(process.env.CONFIG_PATH, 'utf8');
const diskItem = () => JSON.parse(rawConfig()).items.find(i => i.id === 'w1');
const held = () => (fs.existsSync(HELD_PATH) ? JSON.parse(fs.readFileSync(HELD_PATH, 'utf8')) : null);
const w1Of = cfg => cfg.items.find(i => i.id === 'w1');

const writeHeldState = (widgetConfig = {}) => {
  saveConfig({ items: [{ ...ITEM, widgetConfig }], settings: { server: structuredClone(SERVER) } });
  fs.writeFileSync(HELD_PATH, JSON.stringify(HELD_W1), { mode: 0o600 });
};

let clock;
const enableClock = t => {
  clock = Date.now() + 60_000;
  t.mock.timers.enable({ apis: ['Date'], now: clock });
};
const freshLoad = t => {
  clock += 60_000;
  t.mock.timers.setTime(clock);
  return loadConfig();
};

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

beforeEach(() => {
  removeManifest();
  fs.rmSync(HELD_PATH, { force: true });
  saveConfig({ items: [{ ...ITEM, widgetConfig: STORED }], settings: { server: structuredClone(SERVER) } });
});

async function request(method, route, body) {
  return fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', Origin: base } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(method, route, body) {
  const res = await request(method, route, body);
  assert.equal(res.status, 200, `${method} ${route}`);
  return res.json();
}

async function withServer(change) {
  const cfg = await call('GET', '/api/config');
  assert.deepEqual(w1Of(cfg).widgetConfig, {});
  cfg.settings = { ...cfg.settings, server: { ...cfg.settings.server, ...change } };
  return cfg;
}

const saveWithServer = async change => call('POST', '/api/config', await withServer(change));

const TRIGGERS = [
  ['the certificate skip', { skipTlsVerify: true }],
  ['Host IP with a port map set', { hostIp: '10.0.0.9' }],
  ['the port map', { portMap: { 8080: { host: 'retired.lan', port: '9090' } } }],
];

for (const [name, change] of TRIGGERS) {
  test(`changing ${name} moves the config of a widget with no manifest out of the config file`, async () => {
    const reply = await saveWithServer(change);
    assert.deepEqual(reply.withheld, [{ id: 'w1', label: 'Old service' }]);
    assert.ok(!rawConfig().includes('STORED-KEY'));
    assert.deepEqual(diskItem(), { ...ITEM, widgetConfig: {} });
    assert.deepEqual(held(), HELD_W1);
    assert.equal(fs.statSync(HELD_PATH).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(loadConfig()).includes('STORED-KEY'));
  });
}

test('only a change of destination holds the config, and later saves keep it', async () => {
  await saveWithServer({});
  assert.equal(held(), null);
  assert.deepEqual(diskItem().widgetConfig, STORED);
  await saveWithServer({ skipTlsVerify: true });
  const reply = await saveWithServer({});
  assert.equal(reply.withheld, undefined);
  assert.deepEqual(diskItem().widgetConfig, {});
  assert.deepEqual(held(), HELD_W1);

  await saveWithServer({ hostIp: '10.0.0.7' });
  assert.deepEqual(held(), HELD_W1);

  await call('POST', '/api/settings/unsplash-key', { apiKey: 'unsplash' });
  assert.deepEqual(held(), HELD_W1);
});

test('when the manifest returns, the held config comes back without its secret', async t => {
  await saveWithServer({ hostIp: '10.0.0.9' });
  const audits = [];
  t.mock.method(log, 'audit', (msg, data) => audits.push([msg, data]));
  installManifest();
  enableClock(t);

  const read = await call('GET', '/api/widget-config/w1');
  assert.deepEqual(read.widgetConfig, RELEASED);
  assert.deepEqual(diskItem().widgetConfig, RELEASED);
  assert.equal(held(), null);
  assert.deepEqual(audits, [['stored credentials dropped until retyped', { items: ['w1'] }]]);

  const cfg = await call('GET', '/api/config');
  w1Of(cfg).widgetConfig.apiKey = 'RETYPED-KEY';
  await call('POST', '/api/config', cfg);
  assert.deepEqual(diskItem().widgetConfig, { ...STORED, apiKey: 'RETYPED-KEY' });
  assert.equal(held(), null);
});

test('a widgetConfig that is not empty wins over a held config', t => {
  const newer = { url: 'http://new.lan', refresh: 5 };
  writeHeldState(newer);
  installManifest();
  enableClock(t);
  assert.deepEqual(w1Of(freshLoad(t)).widgetConfig, newer);
  assert.equal(held(), null);
});

test('export and the admin read never carry the held config, and an import cannot add one', async () => {
  await saveWithServer({ skipTlsVerify: true });
  for (const route of ['/api/config/export', '/api/config']) {
    const text = await (await request('GET', route)).text();
    assert.ok(!text.includes('STORED-KEY'), route);
  }

  const exported = await call('GET', '/api/config/export');
  exported.items.push({ id: 'w2', type: 'widget', widgetType: 'retired', widgetConfig: { apiKey: 'IMPORTED' } });
  assert.equal((await call('POST', '/api/config', exported)).ok, true);
  assert.deepEqual(held(), HELD_W1);
});

test('a deleted widget loses its held config on the next save', async () => {
  await saveWithServer({ skipTlsVerify: true });
  const cfg = await call('GET', '/api/config');
  cfg.items = cfg.items.filter(i => i.id !== 'w1');
  await call('POST', '/api/config', cfg);
  assert.equal(held(), null);
});

test('a widget of another type loses its held config on the next save', async () => {
  await saveWithServer({ skipTlsVerify: true });
  const cfg = await call('GET', '/api/config');
  w1Of(cfg).widgetType = 'other';
  await call('POST', '/api/config', cfg);
  assert.equal(held(), null);
});

test('a failed held write fails the save and leaves the config file as it was', async t => {
  const original = rawConfig();
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === HELD_PATH) throw Object.assign(new Error('EIO'), { code: 'EIO' });
    return rename(from, to);
  });
  const res = await request('POST', '/api/config', await withServer({ skipTlsVerify: true }));
  assert.notEqual(res.status, 200);
  assert.equal(rawConfig(), original);
  assert.equal(held(), null);
});

test('a failed config write after the held write keeps the full stored config', async t => {
  const original = rawConfig();
  const rename = fs.renameSync;
  const failing = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === process.env.CONFIG_PATH) throw Object.assign(new Error('EIO'), { code: 'EIO' });
    return rename(from, to);
  });
  const res = await request('POST', '/api/config', await withServer({ skipTlsVerify: true }));
  assert.notEqual(res.status, 200);
  assert.equal(rawConfig(), original);
  assert.deepEqual(held(), HELD_W1);
  failing.mock.restore();

  installManifest();
  enableClock(t);
  assert.deepEqual(w1Of(freshLoad(t)).widgetConfig, STORED);
  assert.equal(held(), null);
});

test('a failed held removal after the release drops the entry on the next read', t => {
  writeHeldState();
  installManifest();
  const audits = [];
  t.mock.method(log, 'audit', msg => audits.push(msg));
  const unlink = fs.unlinkSync;
  const failing = t.mock.method(fs, 'unlinkSync', file => {
    if (file === HELD_PATH) throw Object.assign(new Error('EIO'), { code: 'EIO' });
    return unlink(file);
  });
  enableClock(t);

  assert.deepEqual(w1Of(freshLoad(t)).widgetConfig, RELEASED);
  assert.deepEqual(diskItem().widgetConfig, RELEASED);
  assert.deepEqual(held(), HELD_W1);
  failing.mock.restore();

  assert.deepEqual(w1Of(freshLoad(t)).widgetConfig, RELEASED);
  assert.equal(held(), null);
  assert.deepEqual(audits, ['stored credentials dropped until retyped']);
});

test('an unwritable config logs the release once and never holds the secret in memory', t => {
  writeHeldState();
  installManifest();
  const audits = [];
  const warns = [];
  t.mock.method(log, 'audit', msg => audits.push(msg));
  t.mock.method(log, 'warn', msg => warns.push(msg));
  enableClock(t);
  fs.chmodSync(root, 0o555);
  t.after(() => fs.chmodSync(root, 0o755));

  for (let i = 0; i < 5; i++) {
    const cfg = freshLoad(t);
    assert.deepEqual(w1Of(cfg).widgetConfig, RELEASED);
    assert.ok(!JSON.stringify(cfg).includes('STORED-KEY'));
  }
  assert.deepEqual(audits, ['stored credentials dropped until retyped']);
  assert.deepEqual(warns, ['migrated config could not be written back']);
  assert.deepEqual(held(), HELD_W1);
});
