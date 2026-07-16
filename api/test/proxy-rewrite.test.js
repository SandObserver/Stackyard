/* rewriteUrl reads hostIp and portMap through loadConfig, so this file points
   CONFIG_PATH at a real file with both set. proxy.test.js covers the no-config
   fallback and proxy-host.test.js covers getHostIp on its own.

   These are characterization tests: they pin down what rewriteUrl and guardSsrf
   do *today*, including the interaction between them, so that moving the guard
   relative to the rewrite is a change we can see rather than one we discover in
   production. Do not "fix" an assertion here to make a refactor pass — if one of
   these fails, the behaviour changed and that is the thing to look at. */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-rewrite-'));
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
const { rewriteUrl, guardSsrf } = require('../src/proxy');

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
  /* Unpinned is load-bearing: fetchJSON rewrites this host to a container name
     after the guard runs, and a pinned IP would defeat that rewrite. */
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

test('the URL guardSsrf checks is not the URL rewriteUrl produces', async () => {
  /* Documents the current ordering. The guard passes on the host-IP form while
     the connection is actually made to the rewritten container name. Today this
     is safe only because the host-IP branch returns ip:null, letting the later
     rewrite take effect. Whoever changes this ordering should expect this test
     to need rewriting, deliberately. */
  const raw = 'http://192.168.1.50:8096/api/summary';
  const guard = await guardSsrf(raw);
  assert.equal(guard.error, null);
  assert.notEqual(rewriteUrl(raw), raw);
});

test('guarding the rewritten URL also passes, via the dotless-name branch', async () => {
  /* The property that makes reordering viable: once rewritten, the host is a
     dotless Docker name, which the guard already trusts. */
  assert.deepEqual(await guardSsrf(rewriteUrl('http://192.168.1.50:8096/')), { error: null, ip: null });
});
