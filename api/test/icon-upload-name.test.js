const path = require('node:path');
const fs = require('node:fs');

/* Set before anything under src/ is required: ICONS_PATH and CONFIG_PATH are
   read once when those modules load. */
const { tmpDir } = require('../test-support/tmp');
const uploadDir = tmpDir('upload');
process.env.ICONS_PATH = uploadDir;
process.env.CONFIG_PATH = path.join(tmpDir('upcfg'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { safeIconName } = require('../src/routes/icons.js');

const dir = () => tmpDir('icons');
const touch = (d, name) => fs.writeFileSync(path.join(d, name), 'x');

/* ── not overwriting ──────────────────────────────────────────────────────── */

test('a free name is used as given', () => {
  assert.equal(safeIconName(dir(), 'logo.svg'), 'logo.svg');
});

test('a name already taken does not overwrite', () => {
  const d = dir();
  touch(d, 'logo.svg');
  assert.equal(safeIconName(d, 'logo.svg'), 'logo-2.svg');
});

test('several uploads of the same name each get their own', () => {
  const d = dir();
  for (const expected of ['logo.svg', 'logo-2.svg', 'logo-3.svg', 'logo-4.svg']) {
    const got = safeIconName(d, 'logo.svg');
    assert.equal(got, expected);
    touch(d, got);
  }
});

test('the extension is preserved when a suffix is added', () => {
  const d = dir();
  touch(d, 'icon.png');
  assert.equal(safeIconName(d, 'icon.png'), 'icon-2.png');
});

test('a different extension is a different file', () => {
  const d = dir();
  touch(d, 'logo.svg');
  assert.equal(safeIconName(d, 'logo.png'), 'logo.png', 'only an exact name collides');
});

/* Unbounded searching would be a way to spend the server's time, and a directory
   holding a thousand icons of one name is not a case worth serving. */
test('the search for a free name is bounded', () => {
  const d = dir();
  touch(d, 'a.svg');
  for (let n = 2; n <= 999; n++) touch(d, `a-${n}.svg`);
  assert.doesNotThrow(() => safeIconName(d, 'a.svg'));
});

/* ── tidying the name ─────────────────────────────────────────────────────── */

test('a path is reduced to its filename, either separator', () => {
  const d = dir();
  assert.equal(safeIconName(d, '/abs/path/logo.svg'), 'logo.svg');
  assert.equal(safeIconName(d, 'a/b/c.svg'), 'c.svg');
  assert.equal(safeIconName(d, '..\\..\\etc\\passwd.svg'), 'passwd.svg', 'a Windows path too');
});

test('the result always stays inside the icons directory', () => {
  const d = dir();
  for (const raw of ['../../etc/passwd.svg', '..\\..\\x.svg', '/etc/shadow.svg', '....//..svg', 'a/../../b.svg']) {
    const full = path.resolve(d, safeIconName(d, raw));
    assert.ok(full.startsWith(path.resolve(d) + path.sep), `${raw} escaped to ${full}`);
  }
});

test('leading dots are removed, so nothing becomes hidden or a traversal', () => {
  const d = dir();
  assert.equal(safeIconName(d, '...hidden.svg'), 'hidden.svg');
  assert.ok(!safeIconName(d, '..svg').startsWith('.'));
});

test('control characters and awkward characters are dropped', () => {
  const d = dir();
  const got = safeIconName(d, 'a\u0000b<c>d:e"f|g?h*i.svg');
  assert.equal(got, 'abcdefghi.svg');
});

/* An icon name is the user's own, and it is percent-encoded wherever it is used,
   so there is no reason to mangle a legible one. */
test('spaces, case and non-Latin names are kept', () => {
  const d = dir();
  assert.equal(safeIconName(d, 'My Icon.SVG'), 'My Icon.svg', 'only the extension is normalised');
  assert.equal(safeIconName(d, 'иконка.svg'), 'иконка.svg');
});

test('a name with nothing usable left still produces a file', () => {
  const d = dir();
  for (const raw of ['   .svg', '...svg', '\u0000.svg']) {
    const got = safeIconName(d, raw);
    assert.ok(got.length > 4, `${JSON.stringify(raw)} produced ${JSON.stringify(got)}`);
    assert.match(got, /\.svg$/);
  }
});

test('a very long name is shortened', () => {
  const d = dir();
  const got = safeIconName(d, `${'x'.repeat(300)}.svg`);
  assert.ok(got.length <= 110, `name is ${got.length} characters`);
  assert.match(got, /\.svg$/);
});

/* ── through the upload route ─────────────────────────────────────────────── */

/* The helper being correct is not the same as the route using it, so this goes
   through the real endpoint and checks what lands on disk. */

const http = require('node:http');
const { test: t2, before, after } = require('node:test');
const { unfinishedUpload } = require('../test-support/unfinished-upload');

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

function upload(filename, contents) {
  const boundary = '----sytest';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/svg+xml\r\n\r\n${contents}\r\n--${boundary}--\r\n`,
  );
  const u = new URL(base + '/api/icons/upload');
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Origin: base,
        },
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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';

t2('uploading the same name twice keeps both files', async () => {
  const first = await upload('dup.svg', SVG);
  assert.equal(first.status, 200);
  assert.equal(first.body.filename, 'dup.svg');

  const second = await upload('dup.svg', SVG);
  assert.equal(second.status, 200);
  assert.equal(second.body.filename, 'dup-2.svg', 'the response must name what was saved');

  assert.ok(fs.existsSync(path.join(uploadDir, 'dup.svg')), 'the first file must survive');
  assert.ok(fs.existsSync(path.join(uploadDir, 'dup-2.svg')));
});

t2('an upload never writes outside the icons directory', async () => {
  const r = await upload('..\\..\\escaped.svg', SVG);
  assert.equal(r.status, 200);
  assert.ok(!r.body.filename.includes('..'), `saved as ${r.body.filename}`);
  assert.ok(fs.existsSync(path.join(uploadDir, r.body.filename)));
});

/* ── what the upload route lets through ───────────────────────────────────── */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** @param {Buffer} body @returns {Promise<{status:number, body:any}>} */
function postMultipart(body, boundary = '----sytest') {
  const u = new URL(base + '/api/icons/upload');
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Origin: base,
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    r.end(body);
  });
}

/** @param {...[string, Buffer]} files @returns {Buffer} */
function parts(...files) {
  const b = '----sytest';
  return Buffer.concat([
    ...files.flatMap(([name, data]) => [
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      data,
      Buffer.from('\r\n'),
    ]),
    Buffer.from(`--${b}--\r\n`),
  ]);
}

const saved = name => fs.readFileSync(path.join(uploadDir, name), 'utf8');

t2('script and event handlers are removed from an uploaded svg', async () => {
  const r = await upload(
    'hostile.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><path d="M0 0"/></svg>',
  );
  assert.equal(r.status, 200);
  const stored = saved(r.body.filename);
  assert.doesNotMatch(stored, /<script|onload/i);
  assert.match(stored, /<path/);
});

t2('a file that is not svg, png or ico is refused by its name', async () => {
  const r = await postMultipart(parts(['page.html', Buffer.from('<svg/>')]));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /only \.svg, \.png, \.ico/);
  assert.ok(!fs.existsSync(path.join(uploadDir, 'page.html')));
});

t2('a png or ico name on bytes that are neither is refused', async () => {
  for (const name of ['fake.png', 'fake.ico']) {
    const r = await postMultipart(parts([name, Buffer.from('<svg onload="alert(1)"/>')]));
    assert.equal(r.status, 400, name);
    assert.match(r.body.error, /not a valid PNG or ICO/);
    assert.ok(!fs.existsSync(path.join(uploadDir, name)), name);
  }
});

t2('a real png is stored unchanged', async () => {
  const r = await postMultipart(parts(['real.png', PNG]));
  assert.equal(r.status, 200);
  assert.deepEqual(fs.readFileSync(path.join(uploadDir, r.body.filename)), PNG);
});

t2('an icon over 2 MB is refused', async () => {
  const r = await postMultipart(parts(['big.png', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])]));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /too large/);
  assert.ok(!fs.existsSync(path.join(uploadDir, 'big.png')));
});

t2('two files in one upload are refused', async () => {
  const r = await postMultipart(parts(['one.png', PNG], ['two.png', PNG]));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /only one file/);
  assert.ok(!fs.existsSync(path.join(uploadDir, 'one.png')));
});

t2('an icon upload past the stream cap is answered before the body ends', { timeout: 10_000 }, async () => {
  const r = await unfinishedUpload(base + '/api/icons/upload', 8 * 1024 * 1024, 3 * 1024 * 1024);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /too large/);
});
