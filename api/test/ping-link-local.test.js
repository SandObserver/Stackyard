const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const resolver = require('../src/resolve');
const { pingUnchecked } = require('../src/proxy');

test('a link-local address is never pinged', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data',
    'http://[fe80::1]/',
    'http://[::ffff:169.254.169.254]/',
  ]) {
    const r = await pingUnchecked(url, 1000);
    assert.equal(r.code, 'blocked.link-local', url);
  }
});

test('a name that resolves to a link-local address is never pinged', async t => {
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '169.254.169.254', family: 4 }));
  const r = await pingUnchecked('http://metadata.google.internal/', 1000);
  assert.equal(r.code, 'blocked.link-local');
});

test('a private address is still pinged', async () => {
  const server = http.createServer((_, res) => res.end('ok'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const r = await pingUnchecked(`http://127.0.0.1:${server.address().port}/`, 2000);
    assert.equal(r.ok, true);
  } finally {
    server.close();
  }
});

test('a name that resolves to a private address is pinged at that address', async t => {
  const server = http.createServer((_, res) => res.end('ok'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '127.0.0.1', family: 4 }));
  try {
    const r = await pingUnchecked(`http://nas.example:${server.address().port}/`, 2000);
    assert.equal(r.ok, true);
  } finally {
    server.close();
  }
});
