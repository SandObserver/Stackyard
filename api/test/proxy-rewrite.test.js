/* rewriteUrl reads hostIp and portMap through loadConfig, so this file points
   CONFIG_PATH at a real file with both set. proxy.test.js covers the no-config
   fallback and proxy-host.test.js covers getHostIp on its own.

   These are characterization tests: they pin down what rewriteUrl and guardSsrf
   do *today*, including the interaction between them, so that moving the guard
   relative to the rewrite is a change we can see rather than one we discover in
   production. Do not "fix" an assertion here to make a refactor pass. If one of
   these fails, the behaviour changed and that is the thing to look at. */
const path = require('node:path');
const fs = require('node:fs');
const { tmpDir, tmpPath } = require('../test-support/tmp');
const dir = tmpDir('rewrite');
process.env.CONFIG_PATH = path.join(dir, 'apps.json');
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  items: [],
  settings: { server: {
    hostIp: '192.168.1.50',
    portMap: { '8096': { host: 'jellyfin', port: '8096' }, '9000': { host: 'portainer', port: '9443' } },
  } },
}));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteUrl, _internals } = require('../src/proxy');
const { guardSsrf } = _internals;

/* ── rewriteUrl ─────────────────────────────────────────────────────────── */

test('rewriteUrl maps a host-IP URL to its mapped container name and port', () => {
  assert.equal(rewriteUrl('http://192.168.1.50:8096/api/x'), 'http://jellyfin:8096/api/x');
});

test('rewriteUrl applies a port change from the map', () => {
  assert.equal(rewriteUrl('http://192.168.1.50:9000/'), 'http://portainer:9443/');
});

test('rewriteUrl leaves a host-IP URL alone when the port is not mapped', () => {
  assert.equal(rewriteUrl('http://192.168.1.50:7777/'), 'http://192.168.1.50:7777/');
});

test('rewriteUrl leaves a URL on a different host alone', () => {
  assert.equal(rewriteUrl('http://192.168.1.99:8096/'), 'http://192.168.1.99:8096/');
});

test('rewriteUrl leaves a public host alone', () => {
  assert.equal(rewriteUrl('https://example.com/api'), 'https://example.com/api');
});

test('rewriteUrl returns the input unchanged when it is not a valid URL', () => {
  assert.equal(rewriteUrl('not a url'), 'not a url');
});

test('rewriteUrl preserves the query string', () => {
  assert.equal(rewriteUrl('http://192.168.1.50:8096/a?b=c&d=e'), 'http://jellyfin:8096/a?b=c&d=e');
});

/* ── guardSsrf against the host IP ──────────────────────────────────────── */

test('guardSsrf allows the configured host IP without pinning', async () => {
  /* Reached only for a host-IP port with no portMap entry: a mapped one has
     already been rewritten to a container name before the guard runs. */
  assert.deepEqual(await guardSsrf('http://192.168.1.50:8096/'), { error: null, ip: null });
});

test('guardSsrf allows the host IP even on a port that is not mapped', async () => {
  assert.deepEqual(await guardSsrf('http://192.168.1.50:7777/'), { error: null, ip: null });
});

test('guardSsrf still blocks a private address that is not the host IP', async () => {
  const r = await guardSsrf('http://192.168.1.99:8096/');
  assert.match(r.error, /private address/);
  assert.equal(r.ip, null);
});

/* ── the interaction: guard sees the pre-rewrite URL ────────────────────── */

test('rewriting changes the host, so the guard must run after it', async () => {
  /* The reason the pipeline is ordered rewrite → guard → connect. Guarding the
     raw form would check a host that is not the one connected to. */
  const raw = 'http://192.168.1.50:8096/api/summary';
  assert.notEqual(rewriteUrl(raw), raw);
  assert.equal((await guardSsrf(raw)).error, null);
});

test('guarding the rewritten URL also passes, via the dotless-name branch', async () => {
  /* The property that makes reordering viable: once rewritten, the host is a
     dotless Docker name, which the guard already trusts. */
  assert.deepEqual(await guardSsrf(rewriteUrl('http://192.168.1.50:8096/')), { error: null, ip: null });
});

/* ── the service-name allowance must not swallow an IPv6 literal ─────────── */

/* An IPv6 literal is dotless, so it reaches the guard looking like a Docker
   service name and is separated from one only by its colons. That exclusion is
   now shared with the TLS-skip check (see internal-host.test.js), so it needs
   coverage here too: relaxing it would open the SSRF guard, not just weaken
   certificate verification. */
test('guardSsrf blocks a private IPv6 literal rather than trusting it as a service name', async () => {
  for (const url of ['http://[fd00::1]/', 'http://[::1]/', 'http://[fe80::1]/']) {
    const r = await guardSsrf(url);
    assert.match(String(r.error), /private address/, url);
    assert.equal(r.ip, null, url);
  }
});

test('guardSsrf blocks an IPv4-in-IPv6 wrapper around a loopback address', async () => {
  const r = await guardSsrf('http://[::ffff:127.0.0.1]/');
  assert.match(String(r.error), /private address/);
});

/* The other half: a real dotless name still passes, so the exclusion above is
   narrow rather than a blanket refusal of short hostnames. */
test('guardSsrf still trusts an ordinary dotless container name', async () => {
  assert.deepEqual(await guardSsrf('http://jellyfin:8096/'), { error: null, ip: null });
});
