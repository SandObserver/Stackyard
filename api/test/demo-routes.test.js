process.env.DEMO_MODE = 'true';
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
const dir = tmpDir('demo-routes');
process.env.CONFIG_PATH = path.join(dir, 'apps.json');
process.env.ICONS_PATH = path.join(dir, 'icons');
fs.mkdirSync(process.env.ICONS_PATH);

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');

let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

function post(pathname, body, contentType = 'application/json') {
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), Origin: base },
      },
      res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(b);
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    r.end(body);
  });
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const BOUNDARY = 'demo-boundary';
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;
const upload = Buffer.concat([
  Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`,
  ),
  PNG,
  Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
]);

const WRITES = [
  ['/api/config', JSON.stringify({ items: [{ id: 'x', type: 'app', label: 'X', url: 'https://example.com' }] })],
  ['/api/settings/unsplash-key', JSON.stringify({ apiKey: 'k'.repeat(43) })],
  ['/api/auth/set-password', JSON.stringify({ password: 'correct-horse-battery' })],
  ['/api/auth/revoke-sessions', '{}'],
  ['/api/auth/dismiss-setup', '{}'],
  ['/api/auth/toggle', JSON.stringify({ enabled: true })],
  ['/api/icons/upload', upload, MULTIPART],
  ['/api/wallpaper/upload', upload, MULTIPART],
  ['/api/wallpaper/fetch', JSON.stringify({ url: 'https://example.com/x.png' })],
];

for (const [route, body, contentType] of WRITES) {
  test(`${route} is read-only in the demo`, async () => {
    const r = await post(route, body, contentType);
    assert.equal(r.status, 403);
    assert.equal(r.body?.code, 'blocked.read-only');
  });
}

test('no demo write reached the disk', () => {
  assert.equal(fs.existsSync(process.env.CONFIG_PATH), false);
  assert.deepEqual(fs.readdirSync(process.env.ICONS_PATH), []);
});
