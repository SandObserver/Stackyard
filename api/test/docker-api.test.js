const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('docker-api'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { dockerGet } = require('../src/docker-api');

const LIST = [{ Names: ['/emby'], Labels: { 'homepage.name': 'Emby', 'homepage.group': 'Media' } }];
let seen = [];

function versionedOnly(req, res) {
  seen.push(req.url);
  if (!/^\/v1\.\d+\//.test(req.url)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (req.url.startsWith('/v1.24/')) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Api-Version': '1.53' });
    return res.end('{"message":"client version 1.24 is too old"}');
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Api-Version': '1.53' });
  res.end(JSON.stringify(req.url.startsWith('/v1.53/version') ? { ApiVersion: '1.53' } : LIST));
}

function noContainers(req, res) {
  seen.push(req.url);
  if (req.url.includes('/containers/')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Api-Version': '1.53' });
  res.end('{"ApiVersion":"1.53"}');
}

let versioned, versionedBase, blocked, blockedBase, api, apiBase;
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));

before(async () => {
  versioned = http.createServer(versionedOnly);
  versionedBase = await listen(versioned);
  blocked = http.createServer(noContainers);
  blockedBase = await listen(blocked);
  api = http.createServer(dispatch);
  apiBase = await listen(api);
});
after(() => {
  for (const s of [versioned, blocked, api]) {
    s.closeAllConnections?.();
    s.close();
  }
});

test('a proxy that allows only versioned paths is read through the engine version', async () => {
  seen = [];
  const r = await dockerGet(versionedBase, '/containers/json?all=true');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, LIST);
  assert.deepEqual(seen, ['/containers/json?all=true', '/v1.24/version', '/v1.53/containers/json?all=true']);
});

test('the version found is reused without asking again', async () => {
  seen = [];
  await dockerGet(versionedBase, '/containers/json?all=true');
  assert.deepEqual(seen, ['/v1.53/containers/json?all=true']);
});

test('a refusal that a versioned path does not lift is returned as it is', async () => {
  seen = [];
  const r = await dockerGet(blockedBase, '/containers/json?all=true');
  assert.equal(r.status, 403);
  seen = [];
  await dockerGet(blockedBase, '/containers/json?all=true');
  assert.equal(seen[0], '/containers/json?all=true');
});

test('the socket proxy test passes on a proxy that allows only versioned paths', async () => {
  const body = JSON.stringify({ url: `${versionedBase}/` });
  const r = await fetch(`${apiBase}/api/docker/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: apiBase },
    body,
  });
  const out = await r.json();
  assert.equal(out.ok, true);
  assert.equal(out.version, '1.53');
});
