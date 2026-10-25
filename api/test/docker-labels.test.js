const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('docker-labels'), 'apps.json');
delete process.env.SOCKET_PROXY_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, saveConfig } = require('../src/config');
const { homepageLabels } = require('../src/docker-labels');

let server, base, proxy, proxyBase;
let reply = { status: 200, body: '[]' };
let lastPath = '';

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  proxy = http.createServer((req, res) => {
    lastPath = req.url;
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(reply.body);
  });
  proxyBase = await listen(proxy);
  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(proxy);
});

function setSocket(url) {
  const cfg = loadConfig();
  cfg.settings = { ...cfg.settings, server: { ...cfg.settings?.server, socketProxyUrl: url } };
  saveConfig(cfg);
}

async function labels() {
  const r = await fetch(`${base}/api/docker/labels`);
  return { status: r.status, body: await r.json() };
}

const EMBY = {
  Names: ['/emby'],
  Labels: {
    'homepage.group': 'Media',
    'homepage.name': 'Emby',
    'homepage.href': 'http://emby.home/',
    'homepage.icon': 'emby.png',
    'homepage.widget.type': 'emby',
    'homepage.widget.key': 'secret-api-key',
    'com.docker.compose.project': 'media',
  },
};

test('only listed homepage fields leave the server', () => {
  const [c] = homepageLabels([EMBY]);
  assert.equal(c.container, 'emby');
  assert.deepEqual(c.labels, { name: 'Emby', group: 'Media', href: 'http://emby.home/', icon: 'emby.png' });
  assert.equal(c.widget, true);
  assert.ok(!JSON.stringify(c).includes('secret-api-key'));
});

test('containers without homepage labels are left out', () => {
  assert.deepEqual(homepageLabels([{ Names: ['/db'], Labels: { 'com.docker.compose.service': 'db' } }, {}, null]), []);
  assert.deepEqual(homepageLabels({ message: 'not a list' }), []);
});

test('a container with only instance labels is listed without a name', () => {
  const [c] = homepageLabels([{ Names: ['/x'], Labels: { 'homepage.instance.lan.name': 'X' } }]);
  assert.deepEqual(c.labels, {});
});

test('indexed widget labels count as a widget', () => {
  const [c] = homepageLabels([{ Names: ['/x'], Labels: { 'homepage.name': 'X', 'homepage.widgets[0].type': 'y' } }]);
  assert.equal(c.widget, true);
});

test('the route asks for a socket proxy when none is set', async () => {
  setSocket('');
  const r = await labels();
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'invalid.socket-missing');
});

test('the route reads every container through the socket proxy', async () => {
  setSocket(`${proxyBase}/`);
  reply = { status: 200, body: JSON.stringify([EMBY]) };
  const r = await labels();
  assert.equal(r.status, 200);
  assert.equal(lastPath, '/containers/json?all=true');
  assert.equal(r.body.containers.length, 1);
  assert.ok(!JSON.stringify(r.body).includes('secret-api-key'));
});

test('a proxy that refuses the container list is reported', async () => {
  setSocket(proxyBase);
  reply = { status: 403, body: '{}' };
  const r = await labels();
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'upstream.refused');
});

test('an error status from the proxy is reported with its status', async () => {
  setSocket(proxyBase);
  reply = { status: 500, body: '{"message":"boom"}' };
  const r = await labels();
  assert.equal(r.body.code, 'upstream.status');
  assert.equal(r.body.detail.status, 500);
});

test('an answer that is not a container list is reported as not Docker', async () => {
  setSocket(proxyBase);
  reply = { status: 200, body: '{"message":"page not found"}' };
  const r = await labels();
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'upstream.not-docker');
});

test('a container list past the read limit is reported as too many containers', async () => {
  setSocket(proxyBase);
  const pad = 'x'.repeat(64 * 1024);
  reply = {
    status: 200,
    body: JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ Names: [`/c${i}`], Labels: { pad } }))),
  };
  const r = await labels();
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'upstream.too-many-containers');
});
