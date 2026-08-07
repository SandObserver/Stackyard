/* getHostIp reads through loadConfig, so this file points CONFIG_PATH at a real
   file with a host IP set. proxy.test.js covers the no-config fallback. */
const path = require('node:path');
const fs = require('node:fs');
const { tmpDir, tmpPath } = require('../test-support/tmp');
const dir = tmpDir('proxy');
process.env.CONFIG_PATH = path.join(dir, 'apps.json');
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ items: [], settings: { server: { hostIp: '192.168.1.50' } } }));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getHostIp } = require('../src/proxy');

test('getHostIp returns the configured host IP', () => {
  assert.equal(getHostIp(), '192.168.1.50');
});
