/* Ping used to skip the host-IP rewrite that fetching applies, so "Test
   connection" reported on a different target than the widget would actually
   reach: the raw host IP instead of the mapped container. These tests hold the
   two in agreement.

   portMap maps 8096 to a dotless name that cannot resolve, so a ping that got
   rewritten fails with that name in the error, which is what proves the rewrite
   happened. 7000 maps to a private IP to prove the guard runs downstream of the
   rewrite rather than on the URL as typed. */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-ping-'));
process.env.CONFIG_PATH = path.join(dir, 'apps.json');
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  items: [],
  settings: { server: {
    hostIp: '192.168.1.50',
    portMap: {
      '8096': { host: 'stackyard-test-nx-host', port: '8096' },
      '7000': { host: '10.0.0.9', port: '80' },
    },
  } },
}));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchChecked, pingChecked, pingUnchecked, SsrfBlockedError } = require('../src/proxy');

const MAPPED = 'http://192.168.1.50:8096/';
const MS = 4000;

test('pingChecked follows portMap to the mapped container', async () => {
  const r = await pingChecked(MAPPED, MS, false);
  assert.equal(r.ok, false);
  assert.match(r.error, /stackyard-test-nx-host/, 'ping must target the rewritten host');
});

test('pingUnchecked follows portMap to the mapped container', async () => {
  /* Health checks ping config-supplied urls, and diverged the same way. */
  const r = await pingUnchecked(MAPPED, MS, false);
  assert.equal(r.ok, false);
  assert.match(r.error, /stackyard-test-nx-host/);
});

test('ping and fetch resolve the same url to the same target', async () => {
  /* The bug this fixes: a ping that succeeds where the fetch fails, or the
     reverse, because they disagreed about where the url points. */
  const ping = await pingChecked(MAPPED, MS, false);
  const fetchErr = await fetchChecked(MAPPED, { timeout: MS }).then(() => null, e => e.message);
  assert.match(ping.error, /stackyard-test-nx-host/);
  assert.match(fetchErr, /stackyard-test-nx-host/);
});

test('pingChecked guards the rewritten target, not the url as typed', async () => {
  /* The host-IP form would pass the guard on its own via the host-IP branch.
     Blocking proves the guard sees the mapped private target instead. */
  await assert.rejects(
    () => pingChecked('http://192.168.1.50:7000/', MS, false),
    (e) => e instanceof SsrfBlockedError && /10\.0\.0\.9/.test(e.message),
  );
});

test('pingChecked still allows a host-IP port with no portMap entry', async () => {
  /* Unmapped host-IP ports stay trusted and connect to the host directly. */
  const r = await pingChecked('http://192.168.1.50:9/', 1500, false);
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.error), /Blocked/);
});
