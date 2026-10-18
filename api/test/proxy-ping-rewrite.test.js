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
        hostIp: '127.0.0.1',
        portMap: {
          8096: { host: 'stackyard-test-nx-host', port: '8096' },
          7000: { host: '10.0.0.9', port: '80' },
        },
      },
    },
  }),
);

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const net = require('node:net');
const log = require('../src/log');
const { fetchChecked, pingChecked, pingUnchecked, SsrfBlockedError } = require('../src/proxy');
const { errorBody } = require('../src/api-error');

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

const MAPPED = 'http://127.0.0.1:8096/';
const MS = 4000;

const NX = 'stackyard-test-nx-host';
const notFound = code => Object.assign(new Error(`${code} ${NX}`), { code, hostname: NX });
for (const name of ['resolve4', 'resolve6']) {
  const real = dns.promises.Resolver.prototype[name];
  dns.promises.Resolver.prototype[name] = function (host, ...rest) {
    return host === NX ? Promise.reject(notFound(dns.NOTFOUND)) : real.call(this, host, ...rest);
  };
}
const realLookup = dns.promises.lookup;
dns.promises.lookup = (host, ...rest) =>
  host === NX ? Promise.reject(notFound('ENOTFOUND')) : realLookup(host, ...rest);

let closedPort;
before(async () => {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  closedPort = s.address().port;
  await new Promise(r => s.close(r));
});

test('pingChecked follows portMap to the mapped container', async () => {
  const e = await pingChecked(MAPPED, MS, false).then(
    () => null,
    x => x,
  );
  assert.ok(e instanceof SsrfBlockedError);
  assert.match(e.message, /stackyard-test-nx-host/, 'ping must guard the rewritten host');
  assert.doesNotMatch(errorBody(e).error, /stackyard-test-nx-host/, 'and must not tell the browser the host');
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
  const pingErr = await pingChecked(MAPPED, MS, false).then(
    () => null,
    e => e.message,
  );
  const fetchErr = await fetchChecked(MAPPED, { timeout: MS }).then(
    () => null,
    e => e.message,
  );
  assert.match(pingErr, /stackyard-test-nx-host/);
  assert.match(fetchErr, /stackyard-test-nx-host/, 'both must resolve to the same host');
});

test('pingChecked guards the rewritten target, not the url as typed', async () => {
  /* The host-IP form would pass the guard on its own via the host-IP branch.
     Blocking proves the guard sees the mapped private target instead. */
  await assert.rejects(
    () => pingChecked('http://127.0.0.1:7000/', MS, false),
    e => e instanceof SsrfBlockedError && /10\.0\.0\.9/.test(e.message),
  );
});

test('pingChecked still allows a host-IP port with no portMap entry', async () => {
  /* Unmapped host-IP ports stay trusted and connect to the host directly. */
  const r = await pingChecked(`http://127.0.0.1:${closedPort}/`, 1500, false);
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.error), /Blocked/);
});

test('fetchChecked guards the rewritten target, not the url as typed', async () => {
  await assert.rejects(
    () => fetchChecked('http://127.0.0.1:7000/', { timeout: MS }),
    e => e instanceof SsrfBlockedError && /10\.0\.0\.9/.test(e.message),
  );
});
