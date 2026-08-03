/* Ping used to skip the host-IP rewrite that fetching applies, so "Test
   connection" reported on a different target than the widget would actually
   reach: the raw host IP instead of the mapped container. These tests hold the
   two in agreement.

   portMap maps 8096 to a dotless name that cannot resolve, so a ping that got
   rewritten tries to reach that name, which is what proves the rewrite happened.
   7000 maps to a private IP to prove the guard runs downstream of the rewrite
   rather than on the URL as typed.

   The target is read from the log rather than the returned error. The error no
   longer names the host: it said "getaddrinfo ENOTFOUND stackyard-test-nx-host"
   and that result is returned to the browser as-is by /api/ping, which disclosed
   internal hostnames. The log is where the detail lives now, so that is where a
   test looking for it belongs. */
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
const log = require('../src/log');
const { fetchChecked, pingChecked, pingUnchecked, SsrfBlockedError } = require('../src/proxy');

/* Capture what proxy.js logs about the attempt, which names the host it tried. */
async function targetOf(fn) {
  const real = log.warn;
  const seen = [];
  log.warn = (msg, fields) => { seen.push(fields || {}); };
  try { await fn(); } finally { log.warn = real; }
  return seen.map(f => String(f.url || '')).join(' ');
}

const MAPPED = 'http://192.168.1.50:8096/';
const MS = 4000;

test('pingChecked follows portMap to the mapped container', async () => {
  let r;
  const target = await targetOf(async () => { r = await pingChecked(MAPPED, MS, false); });
  assert.equal(r.ok, false);
  assert.match(target, /stackyard-test-nx-host/, 'ping must target the rewritten host');
  assert.doesNotMatch(r.error, /stackyard-test-nx-host/, 'and must not tell the browser the host');
});

test('pingUnchecked follows portMap to the mapped container', async () => {
  /* Health checks ping config-supplied urls, and diverged the same way. */
  let r;
  const target = await targetOf(async () => { r = await pingUnchecked(MAPPED, MS, false); });
  assert.equal(r.ok, false);
  assert.match(target, /stackyard-test-nx-host/);
});

test('ping and fetch resolve the same url to the same target', async () => {
  /* The bug this fixes: a ping that succeeds where the fetch fails, or the
     reverse, because they disagreed about where the url points.

     fetchChecked rejects with an Error, which is internal and still carries the
     detail; only the response body is sanitised, and errorBody is what does
     that. So the two are read from their respective internals rather than from
     what a browser would see. */
  const pingTarget = await targetOf(async () => { await pingChecked(MAPPED, MS, false); });
  const fetchErr = await fetchChecked(MAPPED, { timeout: MS }).then(() => null, e => e.message);
  assert.match(pingTarget, /stackyard-test-nx-host/);
  assert.match(fetchErr, /stackyard-test-nx-host/, 'both must resolve to the same host');
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
