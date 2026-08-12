const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const dir = tmpDir('ping');
process.env.CONFIG_PATH = path.join(dir, 'apps.json');
fs.writeFileSync(
  process.env.CONFIG_PATH,
  JSON.stringify({
    items: [],
    settings: {
      server: {
        hostIp: '192.168.1.50',
        portMap: {
          8096: { host: 'stackyard-test-nx-host', port: '8096' },
          7000: { host: '10.0.0.9', port: '80' },
        },
      },
    },
  }),
);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../src/log');
const { fetchChecked, pingChecked, pingUnchecked, SsrfBlockedError } = require('../src/proxy');

/* Capture what proxy.js logs about the attempt, which names the host it tried. */
async function targetOf(fn) {
  const real = log.warn;
  const seen = [];
  log.warn = (msg, fields) => {
    seen.push(fields || {});
  };
  try {
    await fn();
  } finally {
    log.warn = real;
  }
  return seen.map(f => String(f.url || '')).join(' ');
}

const MAPPED = 'http://192.168.1.50:8096/';
const MS = 4000;

test('pingChecked follows portMap to the mapped container', async () => {
  let r;
  const target = await targetOf(async () => {
    r = await pingChecked(MAPPED, MS, false);
  });
  assert.equal(r.ok, false);
  assert.match(target, /stackyard-test-nx-host/, 'ping must target the rewritten host');
  assert.doesNotMatch(r.error, /stackyard-test-nx-host/, 'and must not tell the browser the host');
});

test('pingUnchecked follows portMap to the mapped container', async () => {
  /* Health checks ping config-supplied urls, and diverged the same way. */
  let r;
  const target = await targetOf(async () => {
    r = await pingUnchecked(MAPPED, MS, false);
  });
  assert.equal(r.ok, false);
  assert.match(target, /stackyard-test-nx-host/);
});

test('ping and fetch resolve the same url to the same target', async () => {
  const pingTarget = await targetOf(async () => {
    await pingChecked(MAPPED, MS, false);
  });
  const fetchErr = await fetchChecked(MAPPED, { timeout: MS }).then(
    () => null,
    e => e.message,
  );
  assert.match(pingTarget, /stackyard-test-nx-host/);
  assert.match(fetchErr, /stackyard-test-nx-host/, 'both must resolve to the same host');
});

test('pingChecked guards the rewritten target, not the url as typed', async () => {
  /* The host-IP form would pass the guard on its own via the host-IP branch.
     Blocking proves the guard sees the mapped private target instead. */
  await assert.rejects(
    () => pingChecked('http://192.168.1.50:7000/', MS, false),
    e => e instanceof SsrfBlockedError && /10\.0\.0\.9/.test(e.message),
  );
});

test('pingChecked still allows a host-IP port with no portMap entry', async () => {
  /* Unmapped host-IP ports stay trusted and connect to the host directly. */
  const r = await pingChecked('http://192.168.1.50:9/', 1500, false);
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.error), /Blocked/);
});
