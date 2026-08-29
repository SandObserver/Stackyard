const { tmpDir } = require('../test-support/tmp');

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* Required, not imported: this is the same file the browser loads, and the point
   of the test is that the server can load it. */
const shared = require('../../ui/js/link-url.js');
const { isSafeLinkUrl, firstUnsafeLink, sanitizeItemLinks } = shared;

/* ── what must be refused ─────────────────────────────────────────────────── */

const UNSAFE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'JAVASCRIPT:alert(1)',
  '  javascript:alert(1)',
  '\tjavascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\rscript:alert(1)',
  'javascript\u0000:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'blob:https://example.com/uuid',
  'filesystem:https://example.com/temporary/x',
];

test('every script-bearing scheme is refused', () => {
  for (const v of UNSAFE) assert.equal(isSafeLinkUrl(v), false, `${JSON.stringify(v)} should be refused`);
});

/* Browsers discard control characters and whitespace before reading the scheme,
   so a check that reads the raw string sees a scheme the browser will not. */
test('interior whitespace and control characters do not hide a scheme', () => {
  assert.equal(isSafeLinkUrl('j a v a s c r i p t:alert(1)'), false);
  assert.equal(isSafeLinkUrl('\u000bjavascript:alert(1)'), false);
});

/* ── what must keep working ───────────────────────────────────────────────── */

/* A denylist rather than an allowlist, because a homelab dashboard legitimately
   links to protocol handlers the user has registered. Allowlisting http and https
   would break these for no gain: the browser hands them to the OS, not to our
   origin. */
test('protocol handlers a homelab actually uses are allowed', () => {
  for (const v of [
    'ssh://host',
    'vnc://host:5900',
    'rdp://host',
    'smb://nas/share',
    'sftp://host',
    'steam://run/440',
    'obsidian://open?vault=x',
    'mailto:me@example.com',
    'tel:+15551234',
  ])
    assert.equal(isSafeLinkUrl(v), true, `${v} should be allowed`);
});

test('ordinary and relative URLs are allowed', () => {
  for (const v of ['https://example.com', 'http://svc:8080/path?a=b#c', '/relative', './x', '../x', '#anchor', '?q=1'])
    assert.equal(isSafeLinkUrl(v), true, `${v} should be allowed`);
});

/* A colon after a path or query separator is not a scheme. */
test('a colon later in a relative URL is not read as a scheme', () => {
  for (const v of ['/go?to=javascript:alert(1)', '#javascript:alert(1)', '/a/b:c', '?x=data:text/html'])
    assert.equal(isSafeLinkUrl(v), true, `${v} should be allowed`);
});

test('an absent link is allowed, and a non-string is not', () => {
  for (const v of [null, undefined, '']) assert.equal(isSafeLinkUrl(v), true);
  for (const v of [0, 1, {}, [], true]) assert.equal(isSafeLinkUrl(v), false, `${JSON.stringify(v)}`);
});

/* ── firstUnsafeLink, used to reject a save ───────────────────────────────── */

test('an unsafe link is reported with the field that holds it', () => {
  assert.deepEqual(firstUnsafeLink({ href: 'javascript:alert(1)' }), { field: 'href', value: 'javascript:alert(1)' });
  assert.equal(firstUnsafeLink({ url: 'data:text/html,x' }).field, 'url');
  assert.equal(firstUnsafeLink({ widgetConfig: { linkUrl: 'javascript:x' } }).field, 'widgetConfig.linkUrl');
  assert.equal(firstUnsafeLink({ widgetConfig: { scrutinyHref: 'javascript:x' } }).field, 'widgetConfig.scrutinyHref');
});

test('a clean item reports nothing', () => {
  assert.equal(firstUnsafeLink({ href: 'https://example.com', widgetConfig: { linkUrl: 'ssh://h' } }), null);
  assert.equal(firstUnsafeLink({}), null);
  assert.equal(firstUnsafeLink(null), null);
});

/* ── the module is loadable outside a browser ─────────────────────────────── */

test('the shared rule loads on the server and exports what both sides need', () => {
  for (const name of ['isSafeLinkUrl', 'firstUnsafeLink', 'sanitizeItemLinks']) {
    assert.equal(typeof shared[name], 'function', `${name} should be exported`);
  }
  for (const name of ['UNSAFE_LINK_SCHEMES', 'LINK_FIELDS', 'WIDGET_LINK_FIELDS']) {
    assert.ok(Array.isArray(shared[name]), `${name} should be exported`);
  }
});

test('the shared rule references nothing only a browser provides', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../ui/js/link-url.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [/\bwindow\b/, /\bdocument\b/, /\blocation\b/, /^\s*import\s/m]) {
    assert.doesNotMatch(body, forbidden, `the shared rule must not use ${forbidden}`);
  }
});

test('the Dockerfile puts the shared rule where the server can require it', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../../Dockerfile'), 'utf8');
  /* The image mirrors the repository layout, so the same relative path resolves
     in both. If either line changes without the other, the API cannot start. */
  assert.match(dockerfile, /COPY --chown=node:node api\/ \/app\/api\//);
  assert.match(dockerfile, /COPY --chown=node:node ui\/js\/link-url\.js \/app\/ui\/js\/link-url\.js/);
  const supervisord = fs.readFileSync(path.join(__dirname, '../../supervisord.conf'), 'utf8');
  assert.match(supervisord, /command=node \/app\/api\/src\/server\.js/);
});

test('sanitizeItemLinks blanks an unsafe link and leaves the rest alone', () => {
  const items = [
    { id: 'a', href: 'javascript:alert(1)' },
    { id: 'b', href: 'https://example.com' },
    { id: 'c', url: 'data:text/html,x' },
    {
      id: 'd',
      type: 'widget',
      widgetConfig: { linkUrl: 'javascript:x', scrutinyHref: 'https://ok.example', other: 'kept' },
    },
  ];
  sanitizeItemLinks(items);
  assert.equal(items[0].href, '');
  assert.equal(items[1].href, 'https://example.com');
  assert.equal(items[2].url, '');
  assert.equal(items[3].widgetConfig.linkUrl, '');
  assert.equal(items[3].widgetConfig.scrutinyHref, 'https://ok.example');
  assert.equal(items[3].widgetConfig.other, 'kept', 'unrelated config must not be touched');
});

test('sanitizeItemLinks does not invent fields that were absent', () => {
  const items = [{ id: 'a', type: 'app' }];
  sanitizeItemLinks(items);
  assert.deepEqual(items[0], { id: 'a', type: 'app' });
});

test('sanitizeItemLinks tolerates junk', () => {
  assert.doesNotThrow(() => sanitizeItemLinks([null, undefined, 'x', 5, {}]));
  assert.doesNotThrow(() => sanitizeItemLinks(null));
});

/* ── the save path ────────────────────────────────────────────────────────── */

test('a config save is rejected when an item carries an unsafe link', async () => {
  const http = require('node:http');
  process.env.CONFIG_PATH = path.join(tmpDir('link'), 'apps.json');

  require('../src/routes');
  const { dispatch } = require('../src/router');
  const { saveConfig, loadConfig } = require('../src/config');
  saveConfig({ items: [], settings: {} });

  const server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = body =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const u = new URL(base + '/api/config');
      const r = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
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
      r.end(data);
    });

  try {
    const bad = await post({
      items: [{ id: 'a1', type: 'app', name: 'X', href: 'javascript:alert(1)' }],
      settings: {},
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /a1/, 'the message should name the item');
    assert.match(bad.body.error, /javascript/i, 'and the scheme');
    assert.equal(
      loadConfig().items.find(i => i.id === 'a1'),
      undefined,
      'nothing may be stored',
    );

    const ok = await post({ items: [{ id: 'a2', type: 'app', name: 'Y', href: 'ssh://host' }], settings: {} });
    assert.equal(ok.status, 200, 'a protocol handler must still save');
    assert.equal(loadConfig().items.find(i => i.id === 'a2').href, 'ssh://host');
  } finally {
    await new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    });
  }
});

test('a config save is rejected when a badge row is malformed', async () => {
  const http = require('node:http');
  process.env.CONFIG_PATH = path.join(tmpDir('rows'), 'apps.json');

  require('../src/routes');
  const { dispatch } = require('../src/router');
  const { saveConfig, loadConfig } = require('../src/config');
  saveConfig({ items: [], settings: {} });

  const server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = body =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const u = new URL(base + '/api/config');
      const r = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
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
      r.end(data);
    });

  try {
    const bad = await post({
      items: [{ id: 'a1', type: 'app', badge: { headers: [{ key: 'A', value: '1' }, null] } }],
      settings: {},
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /a1/);
    assert.match(bad.body.error, /badge\.headers\[1\]/);
    assert.equal(
      loadConfig().items.find(i => i.id === 'a1'),
      undefined,
      'nothing may be stored',
    );

    const ok = await post({
      items: [{ id: 'a2', type: 'app', badge: { headers: [{ key: 'A', value: '1', secret: false }] } }],
      settings: {},
    });
    assert.equal(ok.status, 200, 'a clean item must still save');
  } finally {
    await new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    });
  }
});

test('a config save is rejected when two items share an id', async () => {
  const http = require('node:http');
  process.env.CONFIG_PATH = path.join(tmpDir('dup'), 'apps.json');

  require('../src/routes');
  const { dispatch } = require('../src/router');
  const { saveConfig, loadConfig } = require('../src/config');
  saveConfig({ items: [], settings: {} });

  const server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = body =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const u = new URL(base + '/api/config');
      const r = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
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
      r.end(data);
    });

  try {
    const bad = await post({
      items: [
        { id: 'dup', type: 'app', name: 'First' },
        { id: 'dup', type: 'app', name: 'Second' },
      ],
      settings: {},
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /duplicate item id: dup/);
    assert.equal(loadConfig().items.filter(i => i.id === 'dup').length, 0, 'nothing may be stored');

    /* Different types, same id, is still a collision: the lookup does not care. */
    const mixed = await post({
      items: [
        { id: 'same', type: 'app', name: 'A' },
        { id: 'same', type: 'folder', label: 'B' },
      ],
      settings: {},
    });
    assert.equal(mixed.status, 400);

    const ok = await post({
      items: [
        { id: 'one', type: 'app', name: 'A' },
        { id: 'two', type: 'app', name: 'B' },
      ],
      settings: {},
    });
    assert.equal(ok.status, 200, 'distinct ids must still save');
    /* Counted by id, not by type: ensureSystemItems adds a `settings` app. */
    const ids = loadConfig().items.map(i => i.id);
    assert.ok(ids.includes('one') && ids.includes('two'));
    assert.equal(new Set(ids).size, ids.length, 'the stored config has no duplicates');
  } finally {
    await new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    });
  }
});

/* ── a folder's children must resolve ─────────────────────────────────────── */

/* A folder draws its children by id. One that resolves to nothing renders an
   empty folder with no way to tell why, and the save used to return 200. A
   hand-edited or partly-merged export is the realistic way to produce one. */
test('a config save is rejected when a folder points at an item that is not there', async () => {
  const http = require('node:http');
  process.env.CONFIG_PATH = path.join(tmpDir('children'), 'apps.json');

  require('../src/routes');
  const { dispatch } = require('../src/router');
  const { saveConfig, loadConfig } = require('../src/config');
  saveConfig({ items: [], settings: {} });

  const server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = body =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const u = new URL(base + '/api/config');
      const r = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
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
      r.end(data);
    });

  try {
    const bad = await post({
      items: [
        { id: 'media', type: 'folder', label: 'Media', children: ['sonarr', 'gone', 'also-gone'] },
        { id: 'sonarr', type: 'app', name: 'Sonarr' },
      ],
      settings: {},
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /media: children point at items that are not here/);
    assert.match(bad.body.error, /gone/, 'the message has to name what is missing to be fixable');
    assert.match(bad.body.error, /also-gone/, 'every dangling id, not just the first');
    assert.equal(loadConfig().items.filter(i => i.id === 'media').length, 0, 'nothing may be stored');

    /* A folder whose children all resolve still saves, and so does an empty one. */
    const ok = await post({
      items: [
        { id: 'media', type: 'folder', label: 'Media', children: ['sonarr'] },
        { id: 'sonarr', type: 'app', name: 'Sonarr' },
        { id: 'empty', type: 'folder', label: 'Empty', children: [] },
      ],
      settings: {},
    });
    assert.equal(ok.status, 200, 'a folder whose children resolve must still save');
    const ids = loadConfig().items.map(i => i.id);
    assert.ok(ids.includes('media') && ids.includes('empty'));
  } finally {
    await new Promise(r => {
      server.closeAllConnections?.();
      server.close(r);
    });
  }
});

/* ── the Node floor that cross-boundary require depends on ────────────────── */

/* require() of an ES module was behind --experimental-require-module on Node
   20.x until 20.19.0. Below that, requiring this file throws and routes/config.js
   fails to load, which takes the whole API down rather than one route. The
   engines floor is the only place the project states what it runs on, so it has
   to be at or above the release where that stopped being true. */
test('the declared Node floor supports requiring an ES module', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const declared = String(pkg.engines?.node || '');
  const m = declared.match(/^>=\s*(\d+)\.(\d+)/);
  assert.ok(m, `engines.node should be a ">=major.minor" floor, got ${JSON.stringify(declared)}`);
  const [major, minor] = [Number(m[1]), Number(m[2])];
  const ok = major > 20 || (major === 20 && minor >= 19);
  assert.ok(ok, `engines.node is ${declared}; require(esm) needs 20.19 or newer`);
});

/* The guard above only matters while a server module requires a browser one.
   If that stops being true, this test is what says the floor can be revisited. */
test('a src module still requires across the CommonJS/ESM boundary', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'config.js'), 'utf8');
  assert.match(
    src,
    /require\(['"][^'"]*ui\/js\/link-url\.js['"]\)/,
    'routes/config.js no longer requires the browser module; revisit the engines floor',
  );
});
