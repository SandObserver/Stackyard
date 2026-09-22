const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('router-literal'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { on, dispatch, json } = require('../src/router');

on('GET', '/api/probe.json', (req, res) => json(res, 200, { hit: 'dot' }));
on('GET', '/api/probe(1)/:id', (req, res) => json(res, 200, { id: req.params.id }));

let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(r => server.close(r)));

test('a dot in a route matches only a dot', async () => {
  assert.equal((await fetch(`${base}/api/probe.json`)).status, 200);
  assert.equal((await fetch(`${base}/api/probeXjson`)).status, 404);
});

test('a route with regex metacharacters still reads its parameter', async () => {
  const r = await fetch(`${base}/api/probe(1)/a%20b`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: 'a b' });
  assert.equal((await fetch(`${base}/api/probe1/a`)).status, 404);
});
