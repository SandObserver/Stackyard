/* docs/security.md against the code it describes.

   Three claims on that page had gone stale: it warned about `X-Forwarded-For`,
   which nothing reads any more; it explained the client-address guarantee by
   nginx overwriting the header rather than by the loopback check that actually
   enforces it; and it credited the Compose file with running the API as a
   non-root user, which the image does.

   A security page that is wrong is worse than one that is missing, because it
   is what someone reads before deciding how to expose this. The claims that can
   be checked against the code are checked here, so the same drift fails a test
   rather than sitting on the page.

   The blocked-address table is pinned separately, in blocked-ranges.test.js.

   Prose is deliberately matched loosely, by the value or symbol it names, not
   by sentence. A test that pins wording turns every edit into a test edit and
   gets weakened until it means nothing. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const doc = read('docs/security.md');
const auth = read('api/src/auth.js');
const router = read('api/src/router.js');
const compose = read('docker-compose.yml');
const supervisord = read('supervisord.conf');

test('the scan reads the page', () => {
  assert.ok(doc.length > 2000, 'docs/security.md looks truncated');
  assert.match(doc, /^# Security/);
});

/* ── what the page must not claim ─────────────────────────────────────────── */

/* The header is not read anywhere. Warning about it tells an operator to defend
   against something that cannot happen, and hides what TRUST_PROXY does do. */
test('the page only warns about headers the code actually reads', () => {
  const readsXff = /x-forwarded-for/i.test(auth + router);
  const warnsXff = /`X-Forwarded-For`(?!\s+is not used)/.test(doc);
  assert.equal(warnsXff, readsXff,
    readsXff
      ? 'the code reads X-Forwarded-For; docs/security.md should say so'
      : 'nothing reads X-Forwarded-For; docs/security.md must not warn about it');
});

/* ── the login limit ──────────────────────────────────────────────────────── */

test('the documented login limit is the one in the code', () => {
  /* Whitespace-tolerant: the formatter decides how this declaration is laid
     out, and the numbers are what this test is about. */
  const m = /LOGIN_MAX\s*=\s*(\d+)[\s,]+LOGIN_WINDOW_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(auth);
  assert.ok(m, 'LOGIN_MAX / LOGIN_WINDOW_MS not found in auth.js');
  const [, max, minutes] = m;
  assert.match(doc, new RegExp(`${max} attempts per IP per ${minutes} minutes`),
    `the code allows ${max} attempts per ${minutes} minutes`);
});

test('the documented session lifetime is the one in the code', () => {
  const m = /_maxAgeDays > 0 \? _maxAgeDays : (\d+)/.exec(auth);
  assert.ok(m, 'the default session lifetime was not found in auth.js');
  assert.match(doc, new RegExp(`default ${m[1]} days`));
  assert.match(doc, /SESSION_MAX_AGE_DAYS/);
});

/* ── the client address ───────────────────────────────────────────────────── */

/* The reason matters as much as the fact. nginx overwriting the header is true
   of the shipped container only; the loopback check is what holds regardless. */
test('the page explains the client address by the check that enforces it', () => {
  assert.match(router, /LOOPBACK\.has\(peer\)/,
    'getIp no longer gates X-Real-IP on a loopback peer');
  const at = doc.indexOf('`X-Real-IP`');
  assert.notEqual(at, -1, 'the page does not mention X-Real-IP');
  /* Within the paragraph that makes the claim, not anywhere on the page: the
     blocked-range table names loopback too. */
  const para = doc.slice(at, doc.indexOf('\n\n', at));
  assert.match(para, /loopback/i,
    'the page must say the header is only believed over loopback');
});

/* ── the password hashing profiles ────────────────────────────────────────── */

test('every hash profile the code offers is documented, and no others', () => {
  const block = /const HASH_PROFILES = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(auth);
  assert.ok(block, 'HASH_PROFILES not found in auth.js');
  const inCode = [...block[1].matchAll(/'([\w]+)':/g)].map(m => m[1]).sort();

  const section = doc.slice(doc.indexOf('PASSWORD_HASH_MEMORY'));
  const documented = [...section.matchAll(/`(\d+mib)`/g)].map(m => m[1]);
  assert.deepEqual([...new Set(documented)].sort(), inCode,
    'the profile list in docs/security.md is out of date');

  const dflt = /const DEFAULT_PROFILE = '([\w]+)'/.exec(auth)[1];
  assert.match(section, new RegExp(`\`${dflt}\` \\(default\\)`),
    `${dflt} is the default in the code`);
});

/* ── the container ────────────────────────────────────────────────────────── */

test('the Compose hardening the page claims is in the Compose file', () => {
  assert.match(doc, /Compose file drops all capabilities/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(doc, /`no-new-privileges`/);
  assert.match(compose, /no-new-privileges:true/);
});

/* The Compose file sets no `user:`. Saying it runs the API as a non-root user
   points a reader at the wrong file when they go to verify it. */
test('the page credits the right layer for the process users', () => {
  assert.ok(!/^\s*user:/m.test(compose),
    'the Compose file now sets a user; the page should say so');
  assert.match(supervisord, /^user=node$/m, 'the API should run as node');
  assert.match(doc, /supervisord runs as root/,
    'the page must say which processes run as whom, and where that is set');
  assert.match(doc, /`node` user/);
});

/* ── behaviour a reader has to know before deploying ──────────────────────── */

test('the page documents that auth with no password is treated as off', () => {
  assert.match(auth, /auth\?\.enabled && auth\?\.passwordHash/,
    'authActive no longer requires a stored password');
  assert.match(doc, /Authentication is only in force when a password is stored/);
});

test('the page documents that localhost is blocked by name', () => {
  const proxy = read('api/src/proxy.js');
  assert.match(proxy, /h === 'localhost'/, 'the localhost block is gone from proxy.js');
  assert.match(doc, /`localhost` is blocked/);
});

test('the page documents the escape hatch that turns the SSRF guard off', () => {
  assert.match(read('api/src/proxy.js'), /ALLOW_PRIVATE_IPS/);
  assert.match(doc, /`ALLOW_PRIVATE_IPS=true` disables this guard/);
});
