const path = require('node:path');
const fs = require('node:fs');

/* Set before anything under src/ is required: ICONS_PATH is read once when
   those modules load. */
const { tmpDir } = require('../test-support/tmp');
const iconsDir = tmpDir('wallpaper-icons');
process.env.ICONS_PATH = iconsDir;
process.env.CONFIG_PATH = path.join(tmpDir('wallpaper-cfg'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { sniffImageType } = require('../src/image-sniff');
const { storeWallpaper, WALLPAPER_URL_BASE } = require('../src/routes/wallpaper');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const AVIF = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(4)]);
const GIF = Buffer.from('GIF89a\0\0\0\0');

const dir = () => path.join(iconsDir, 'wallpaper');

/* ── the format is read from the bytes ────────────────────────────────────── */

test('every accepted format is recognised', () => {
  assert.equal(sniffImageType(PNG).type, 'png');
  assert.equal(sniffImageType(JPEG).type, 'jpeg');
  assert.equal(sniffImageType(WEBP).type, 'webp');
  assert.equal(sniffImageType(AVIF).type, 'avif');
  assert.equal(sniffImageType(GIF).type, 'gif');
});

test('anything else is not an image', () => {
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImageType(Buffer.from('<!doctype html>')), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
  /* A cursor and an ICO both start 00 00, and neither is a wallpaper. */
  assert.equal(sniffImageType(Buffer.from([0x00, 0x00, 0x01, 0x00])), null);
});

test('an ISO container that is not AVIF is refused', () => {
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypmp42'), Buffer.alloc(4)]);
  assert.equal(sniffImageType(mp4), null);
});

test('a RIFF container that is not WebP is refused', () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
  assert.equal(sniffImageType(wav), null);
});

/* ── storing ──────────────────────────────────────────────────────────────── */

test('the stored name is generated, and carries the sniffed extension', () => {
  const url = storeWallpaper(JPEG, sniffImageType(JPEG).ext);
  assert.ok(url.startsWith(WALLPAPER_URL_BASE), url);
  assert.match(url, /\.jpg$/);
  assert.ok(fs.existsSync(path.join(iconsDir, url.replace('/icons/', ''))));
});

test('storing again replaces the wallpaper rather than piling them up', () => {
  storeWallpaper(PNG, '.png');
  storeWallpaper(JPEG, '.jpg');
  storeWallpaper(GIF, '.gif');
  const files = fs.readdirSync(dir());
  assert.equal(files.length, 1);
  assert.match(files[0], /\.gif$/);
});

test('wallpapers are kept out of the directory the icon picker lists', () => {
  storeWallpaper(PNG, '.png');
  const topLevel = fs.readdirSync(iconsDir).filter(f => /\.(svg|png|ico)$/i.test(f));
  assert.deepEqual(topLevel, []);
});

/* ── through the routes ───────────────────────────────────────────────────── */

let server, base;

before(async () => {
  require('../src/routes');
  const { dispatch } = require('../src/router');
  const { saveConfig } = require('../src/config');
  saveConfig({ items: [], settings: {} });
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

function request(pathname, headers, body) {
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { ...headers, 'Content-Length': body.length, Origin: base },
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

function upload(filename, contents) {
  const boundary = '----sytest';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="wallpaper"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    contents,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request('/api/wallpaper/upload', { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body);
}

const fetchLink = url =>
  request('/api/wallpaper/fetch', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ url })));

test('an uploaded image is stored and answered with its served URL', async () => {
  const r = await upload('photo.jpg', JPEG);
  assert.equal(r.status, 200);
  assert.ok(r.body.url.startsWith(WALLPAPER_URL_BASE), r.body.url);
  assert.ok(fs.existsSync(path.join(iconsDir, r.body.url.replace('/icons/', ''))));
});

test('a name claiming a format the bytes do not have is refused', async () => {
  const r = await upload('photo.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not a JPEG/);
});

test('a name that walks out of the wallpaper directory cannot', async () => {
  const r = await upload('../../escape.png', PNG);
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^\/icons\/wallpaper\/wallpaper-[a-z0-9]+\.png$/);
});

test('fetching something that is not a URL is refused before any request', async () => {
  const r = await fetchLink('not a url');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /valid URL/);
});

test('a link on a scheme that is not http is refused', async () => {
  const r = await fetchLink('file:///etc/passwd');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /http and https/);
});
