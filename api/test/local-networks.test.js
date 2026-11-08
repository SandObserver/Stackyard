const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { onLocalNetwork } = require('../src/local-networks');

test('onLocalNetwork never counts loopback or a non-address', () => {
  for (const a of ['127.0.0.1', '::1', 'nas', '']) assert.equal(onLocalNetwork(a), false, a);
});

test('onLocalNetwork follows the interface subnets', t => {
  t.mock.method(os, 'networkInterfaces', () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' }],
    eth0: [
      { address: '172.18.0.4', family: 'IPv4', internal: false, cidr: '172.18.0.4/16' },
      { address: 'fd12:3456::4', family: 'IPv6', internal: false, cidr: 'fd12:3456::4/64' },
    ],
  }));
  assert.equal(onLocalNetwork('172.18.9.9'), true);
  assert.equal(onLocalNetwork('fd12:3456::9'), true);
  assert.equal(onLocalNetwork('172.19.0.1'), false);
  assert.equal(onLocalNetwork('192.168.1.10'), false);
  assert.equal(onLocalNetwork('fd12:3457::9'), false);
});
