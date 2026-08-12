/* Icon files used to be fetched by the browser straight from jsDelivr on every
   page load, which told a third party the name of every service on the
   dashboard and left the dashboard without icons when it could not be reached.

   /api/icons/cdn fetches each icon once and holds it in memory. Nothing is
   written to disk: a restart refetches, so no icon is ever served from a stale
   file. */

const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('icon-cdn'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

require('../src/routes');
const { dispatch } = require('../src/router');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

/** Answers every outbound https request from a queue, and records the URLs. */
function stubCdn(t, replies) {
  const urls = [];
  const original = https.request;
  https.request = (opts, cb) => {
    urls.push(`https://${opts.hostname}${opts.path}`);
    const reply = replies.shift() || { status: 404, body: '' };
    const req = new EventEmitter();
    req.end = () => {
      const res = Readable.from([Buffer.from(reply.body)]);
      res.statusCode = reply.status;
      res.headers = { 'content-type': reply.type || 'application/octet-stream' };
      setImmediate(() => cb(res));
    };
    req.write = () => {};
    req.destroy = () => {};
    return req;
  };
  t.after(() => {
    https.request = original;
  });
  return urls;
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(dispatch);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http
        .request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET' }, res => {
          const bufs = [];
          res.on('data', c => bufs.push(c));
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs) });
          });
        })
        .on('error', e => {
          server.close();
          reject(e);
        })
        .end();
    });
  });
}

test('an icon is fetched once and served from memory after that', async t => {
  const urls = stubCdn(t, [{ status: 200, body: SVG, type: 'image/svg+xml' }]);

  const first = await get('/api/icons/cdn?name=radarr&ext=svg');
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-type'], 'image/svg+xml');
  assert.match(first.body.toString(), /<svg/);

  const second = await get('/api/icons/cdn?name=radarr&ext=svg');
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(urls.length, 1, 'the second request must not reach the CDN');
});

test('a png is served with its own type and cached the same way', async t => {
  const urls = stubCdn(t, [{ status: 200, body: PNG, type: 'image/png' }]);
  const first = await get('/api/icons/cdn?name=sonarr&ext=png');
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-type'], 'image/png');
  assert.deepEqual(first.body, PNG);
  await get('/api/icons/cdn?name=sonarr&ext=png');
  assert.equal(urls.length, 1);
});

/* A name the catalogue does not have is asked for on every page load, so the
   miss is remembered too. */
test('a missing icon is remembered as missing', async t => {
  const urls = stubCdn(t, [{ status: 404, body: 'not found' }]);
  assert.equal((await get('/api/icons/cdn?name=nothing-here&ext=svg')).status, 404);
  assert.equal((await get('/api/icons/cdn?name=nothing-here&ext=svg')).status, 404);
  assert.equal(urls.length, 1);
});

/* Caching a CDN outage would keep every icon missing for a day. */
test('a CDN failure is not cached', async t => {
  const urls = stubCdn(t, [
    { status: 503, body: 'busy' },
    { status: 200, body: SVG, type: 'image/svg+xml' },
  ]);
  assert.equal((await get('/api/icons/cdn?name=plex&ext=svg')).status, 502);
  assert.equal((await get('/api/icons/cdn?name=plex&ext=svg')).status, 200);
  assert.equal(urls.length, 2);
});

test('the request goes to the icon catalogue and nowhere else', async t => {
  const urls = stubCdn(t, [{ status: 200, body: SVG, type: 'image/svg+xml' }]);
  await get('/api/icons/cdn?name=home-assistant&ext=svg');
  assert.equal(urls[0], 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/home-assistant.svg');
});

/* The name reaches a CDN path, so only the catalogue's own spelling is allowed
   through. */
test('a name outside the catalogue form is refused without any outbound call', async t => {
  const urls = stubCdn(t, []);
  for (const name of ['../secret', 'a/b', 'UPPER', 'sp ace', '', 'a'.repeat(65), '-lead']) {
    const r = await get(`/api/icons/cdn?name=${encodeURIComponent(name)}&ext=svg`);
    assert.equal(r.status, 400, name);
  }
  assert.equal((await get('/api/icons/cdn?name=radarr&ext=gif')).status, 400);
  assert.equal(urls.length, 0);
});

/* An SVG served from this origin runs whatever it contains when the URL is
   opened directly. */
test('script in an upstream svg is removed before it is served', async t => {
  stubCdn(t, [
    {
      status: 200,
      body: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>',
      type: 'image/svg+xml',
    },
  ]);
  const r = await get('/api/icons/cdn?name=evil&ext=svg');
  assert.equal(r.status, 200);
  const body = r.body.toString();
  assert.doesNotMatch(body, /<script/i);
  assert.doesNotMatch(body, /onload/i);
});

/* A png path that answers with something else must not be served as an image. */
test('a png that is not a png is treated as missing', async t => {
  stubCdn(t, [{ status: 200, body: '<html>error page</html>', type: 'text/html' }]);
  assert.equal((await get('/api/icons/cdn?name=fake&ext=png')).status, 404);
});
