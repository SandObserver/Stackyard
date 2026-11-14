const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('pihole-session'), 'apps.json');

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { dataFnContext } = require('../src/widget-data');
const { fetchUnchecked } = require('../src/proxy');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'dns', 'data.js'));

const SUMMARY = { queries: { total: 10, blocked: 2, cached: 3, forwarded: 5 }, took: 0.003 };

/* Reply shapes from pi-hole/FTL src/api/docs/content/specs/auth.yaml. A
   request with a revoked or unknown sid answers 401. */
async function stubPiHole({ validity = 1800 } = {}) {
  const seen = [];
  const live = new Set();
  let issued = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => {
      body += c;
    });
    req.on('end', () => {
      const sid = req.headers['x-ftl-sid'] || '';
      seen.push({ method: req.method, url: req.url, sid, body });
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/auth' && req.method === 'POST') {
        const next = `sid-${++issued}`;
        live.add(next);
        return send(200, {
          session: { valid: true, totp: false, sid: next, csrf: 'c', validity, message: 'correct password' },
          took: 0.003,
        });
      }
      if (!live.has(sid)) {
        return send(401, {
          error: { key: 'unauthorized', message: 'Unauthorized', hint: null },
          took: 0.003,
        });
      }
      if (req.url === '/api/stats/summary') return send(200, SUMMARY);
      if (req.url === '/api/history') return send(200, { history: [], took: 0.003 });
      send(404, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    seen,
    revoke: () => live.clear(),
    signIns: () => seen.filter(r => r.method === 'POST' && r.url === '/api/auth').length,
    signOuts: () => seen.filter(r => r.method === 'DELETE').length,
    close: () => new Promise(r => server.close(r)),
  };
}

const poll = config =>
  dataFn(dataFnContext({ provider: 'pihole', ...config }, '', new URLSearchParams(), fetchUnchecked));

test('Pi-hole polls reuse one session and never sign out', async t => {
  const pi = await stubPiHole();
  t.after(pi.close);
  const config = { dnsUrl: pi.url, dnsPiholePassword: 'pw' };
  for (let i = 0; i < 3; i++) assert.equal((await poll(config)).num_dns_queries, 10);
  assert.equal(pi.signIns(), 1);
  assert.equal(pi.signOuts(), 0);
  const summaries = pi.seen.filter(r => r.url === '/api/stats/summary');
  assert.deepEqual(
    summaries.map(r => r.sid),
    ['sid-1', 'sid-1', 'sid-1'],
  );
});

test('a session Pi-hole refuses with 401 is replaced by one new sign-in', async t => {
  const pi = await stubPiHole();
  t.after(pi.close);
  const config = { dnsUrl: pi.url, dnsPiholePassword: 'pw' };
  await poll(config);
  pi.revoke();
  assert.equal((await poll(config)).num_dns_queries, 10);
  assert.equal(pi.signIns(), 2);
  await poll(config);
  assert.equal(pi.signIns(), 2);
});

test('a session past its validity signs in again', async t => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 13, 12) });
  t.after(() => mock.timers.reset());
  const pi = await stubPiHole({ validity: 300 });
  t.after(pi.close);
  const config = { dnsUrl: pi.url, dnsPiholePassword: 'pw' };
  await poll(config);
  mock.timers.tick(200_000);
  await poll(config);
  mock.timers.tick(200_000);
  await poll(config);
  assert.equal(pi.signIns(), 1, 'each accepted request extends the session');
  mock.timers.tick(301_000);
  await poll(config);
  assert.equal(pi.signIns(), 2);
});

test('a changed Pi-hole password signs in again', async t => {
  const pi = await stubPiHole();
  t.after(pi.close);
  await poll({ dnsUrl: pi.url, dnsPiholePassword: 'old' });
  await poll({ dnsUrl: pi.url, dnsPiholePassword: 'new' });
  assert.equal(pi.signIns(), 2);
  assert.equal(JSON.parse(pi.seen.filter(r => r.method === 'POST').at(-1).body).password, 'new');
});

test('polls that start together share one sign-in', async t => {
  const pi = await stubPiHole();
  t.after(pi.close);
  const config = { dnsUrl: pi.url, dnsPiholePassword: 'pw' };
  await Promise.all([poll(config), poll(config), poll(config)]);
  assert.equal(pi.signIns(), 1);
});
