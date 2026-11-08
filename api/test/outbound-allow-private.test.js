const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');
process.env.ALLOW_PRIVATE_IPS = 'true';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../src/resolve');
const {
  fetchChecked,
  SsrfBlockedError,
  _internals: { guardSsrf },
} = require('../src/proxy');

test('ALLOW_PRIVATE_IPS still refuses cloud metadata addresses', async t => {
  for (const url of ['http://169.254.169.254/', 'http://[fd00:ec2::254]/', 'http://100.100.100.200/'])
    assert.equal((await guardSsrf(url)).reason, 'link-local', url);
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '169.254.169.254', family: 4 }));
  assert.equal((await guardSsrf('http://metadata.google.internal/')).reason, 'link-local');
  await assert.rejects(fetchChecked('http://169.254.169.254/latest/', { timeout: 2000 }), SsrfBlockedError);
});

test('ALLOW_PRIVATE_IPS still allows private and loopback addresses', async t => {
  for (const url of ['http://192.168.1.10/', 'http://127.0.0.1:8080/', 'http://[fd00::1]/'])
    assert.equal((await guardSsrf(url)).error, null, url);
  t.mock.method(resolver, 'resolveHost', async () => ({ address: '192.168.1.10', family: 4 }));
  assert.deepEqual(await guardSsrf('http://nas/'), { error: null, ip: '192.168.1.10' });
});
