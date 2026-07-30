/* Regression tests for P10-12: a link URL was never checked.

   An item's href is rendered into an <a href> in nine places across ui.js and
   dashboard.js, and a config save stored whatever it was given. A
   javascript: URL therefore executed in the dashboard's own origin when the tile
   was clicked. rel="noopener noreferrer" does nothing about that; the scheme has
   to be refused.

   Enforced at both moments: on save, so an unsafe value is never stored, and on
   render, so a config written before this existed or arriving by import cannot
   fire either. Two copies of the rule exist because those moments are in
   different module systems; the parity test below is what keeps them equal. */

const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const { isSafeLinkUrl, firstUnsafeLink, UNSAFE_LINK_SCHEMES, LINK_FIELDS, WIDGET_LINK_FIELDS } = require('../src/link-url');

const loadUi = () => import(pathToFileURL(path.join(__dirname, '../../ui/js/link-url.js')).href);

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

/* ── the browser copy ─────────────────────────────────────────────────────── */

test('the two copies of the rule list the same schemes', async () => {
  const ui = await loadUi();
  assert.deepEqual([...ui.UNSAFE_LINK_SCHEMES].sort(), [...UNSAFE_LINK_SCHEMES].sort());
  assert.deepEqual([...ui.LINK_FIELDS].sort(), [...LINK_FIELDS].sort());
  assert.deepEqual([...ui.WIDGET_LINK_FIELDS].sort(), [...WIDGET_LINK_FIELDS].sort());
});

test('the two copies agree on every case tested here', async () => {
  const ui = await loadUi();
  const corpus = [...UNSAFE, 'https://example.com', '/relative', 'ssh://h', 'mailto:a@b', '', null, undefined, 0, {},
                  '/go?to=javascript:x', '#javascript:x', 'j a v a s c r i p t:alert(1)'];
  for (const v of corpus) {
    assert.equal(ui.isSafeLinkUrl(v), isSafeLinkUrl(v), `disagreement on ${JSON.stringify(v)}`);
  }
});

test('sanitizeItemLinks blanks an unsafe link and leaves the rest alone', async () => {
  const { sanitizeItemLinks } = await loadUi();
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

test('sanitizeItemLinks does not invent fields that were absent', async () => {
  const { sanitizeItemLinks } = await loadUi();
  const items = [{ id: 'a', type: 'app' }];
  sanitizeItemLinks(items);
  assert.deepEqual(items[0], { id: 'a', type: 'app' });
});

test('sanitizeItemLinks tolerates junk', async () => {
  const { sanitizeItemLinks } = await loadUi();
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
