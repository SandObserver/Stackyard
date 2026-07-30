/* Regression tests for P10-12: a link URL was never checked.

   An item's href is rendered into an <a href> in nine places across ui.js and
   dashboard.js, and a config save stored whatever it was given. A
   javascript: URL therefore executed in the dashboard's own origin when the tile
   was clicked. rel="noopener noreferrer" does nothing about that; the scheme has
   to be refused.

   Enforced at both moments: on save, so an unsafe value is never stored, and on
   render, so a config written before this existed or arriving by import cannot
   fire either.

   Both use the same file. It began as two copies with a test asserting they
   agreed, which detects drift rather than preventing it; the server requires the
   browser's module directly now, so there is one definition. That only works if
   the file stays free of anything only a browser has, which is what loading it
   here proves. */

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

/* Required, not imported: this is the same file the browser loads, and the point
   of the test is that the server can load it. */
const shared = require('../../ui/js/link-url.js');
const { isSafeLinkUrl, firstUnsafeLink, UNSAFE_LINK_SCHEMES, LINK_FIELDS, WIDGET_LINK_FIELDS, sanitizeItemLinks } = shared;



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
  for (const v of ['ssh://host', 'vnc://host:5900', 'rdp://host', 'smb://nas/share',
                   'sftp://host', 'steam://run/440', 'obsidian://open?vault=x',
                   'mailto:me@example.com', 'tel:+15551234'])
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

/* The property that lets one file serve both: no DOM, no window, no imports. If
   any appear, this file stops loading in Node and the test fails rather than the
   API failing to start. */
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
    { id: 'd', type: 'widget', widgetConfig: { linkUrl: 'javascript:x', scrutinyHref: 'https://ok.example', other: 'kept' } },
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
  const os = require('node:os');
  const fs = require('node:fs');
  const http = require('node:http');
  process.env.CONFIG_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sy-link-')), 'apps.json');

  require('../src/routes');
  const { dispatch } = require('../src/router');
  const { saveConfig, loadConfig } = require('../src/config');
  saveConfig({ items: [], settings: {} });

  const server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = body => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(base + '/api/config');
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
    }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    r.end(data);
  });

  try {
    const bad = await post({ items: [{ id: 'a1', type: 'app', name: 'X', href: 'javascript:alert(1)' }], settings: {} });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /a1/, 'the message should name the item');
    assert.match(bad.body.error, /javascript/i, 'and the scheme');
    assert.equal(loadConfig().items.find(i => i.id === 'a1'), undefined, 'nothing may be stored');

    const ok = await post({ items: [{ id: 'a2', type: 'app', name: 'Y', href: 'ssh://host' }], settings: {} });
    assert.equal(ok.status, 200, 'a protocol handler must still save');
    assert.equal(loadConfig().items.find(i => i.id === 'a2').href, 'ssh://host');
  } finally {
    await new Promise(r => { server.closeAllConnections?.(); server.close(r); });
  }
});
