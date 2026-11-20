const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const { startApp } = require('../test-support/app');
const app = startApp({ label: 'demo-routes', env: { DEMO_MODE: 'true', ICONS_PATH: tmpDir('demo-routes-icons') } });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function post(pathname, body, contentType = 'application/json') {
  const u = new URL(app.base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), Origin: app.base },
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

test('icon search answers the demo refusal instead of failing on the blocked catalogues', async () => {
  const r = await new Promise((resolve, reject) => {
    http
      .get(`${app.base}/api/icons/search?q=plex`, res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      })
      .on('error', reject);
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'blocked.demo');
  assert.equal(r.body.kind, 'blocked');
});
