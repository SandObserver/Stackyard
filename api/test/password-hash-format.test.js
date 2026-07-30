/* Regression tests for P2-5: the stored hash recorded no parameters.

   It was `<hex salt>:<hex key>` with scrypt's node defaults left implicit, which
   meant the work factor could never be raised: a higher cost derives a different
   key from the same salt, so every existing password would stop verifying and
   every install would lock out. Recording the parameters is what makes a work
   factor adjustable at all.

   The format is the modular PHC string that OWASP's Password Storage Cheat Sheet
   points to:

     $scrypt$ln=14,r=8,p=5$<base64 salt>$<base64 key>

   Parameters come from OWASP's scrypt table, which lists five settings it treats
   as equivalent and which trade RAM for parallelism. The 16 MiB row is the
   default: memory is the constraint that fails outright rather than merely being
   slow on the small hardware this runs on, and 16 MiB is what the old parameters
   already used, so the footprint is unchanged while the work factor rises
   fivefold.

   Legacy hashes must keep verifying, and must be rewritten on the next
   successful login, or they would sit in the old format forever. */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const _tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-hash-'));
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { hashPassword, verifyPassword, needsRehash, parseHash, HASH_PROFILES, DEFAULT_PROFILE } = require('../src/auth');

/* A hash in the format used before this change: scrypt with node's defaults, and
   the salt fed in as its hex string rather than as decoded bytes. */
function legacyHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

/* ── the format ───────────────────────────────────────────────────────────── */

test('a new hash records the algorithm and its parameters', async () => {
  const h = await hashPassword('correct-horse');
  assert.match(h, /^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
});

test('the default parameters are the 16 MiB row from OWASP', async () => {
  assert.equal(DEFAULT_PROFILE, '16mib');
  const { ln, r, p } = HASH_PROFILES[DEFAULT_PROFILE];
  assert.deepEqual({ ln, r, p }, { ln: 14, r: 8, p: 5 });
  assert.match(await hashPassword('x'), /^\$scrypt\$ln=14,r=8,p=5\$/);
});

/* Each label must describe the memory that row actually costs, since that is the
   number an operator picks by. */
test('every profile label matches the memory it costs', () => {
  for (const [label, params] of Object.entries(HASH_PROFILES)) {
    const mib = (128 * (2 ** params.ln) * params.r) / 1048576;
    assert.equal(`${mib}mib`, label, `${label} actually uses ${mib} MiB`);
  }
});

/* OWASP calls these settings a "similar minimal level of defense", not an
   identical one: the work factors span about 1.6x across the five rows. Worth
   pinning, because it is why moving to a heavier row can legitimately trigger a
   rehash and moving to a lighter one never does. */
test('the profiles are comparable in work without being identical', () => {
  const work = ({ ln, r, p }) => (2 ** ln) * r * p;
  const all = Object.values(HASH_PROFILES).map(work);
  const spread = Math.max(...all) / Math.min(...all);
  assert.ok(spread > 1, 'the rows are not all identical, so ordering matters');
  assert.ok(spread <= 2, `the rows should stay comparable, spread is ${spread}`);
});

test('every profile is at least as strong as the old implicit parameters', () => {
  /* The old format was N=2^14, r=8, p=1. No row may be a downgrade on that. */
  const work = ({ ln, r, p }) => (2 ** ln) * r * p;
  const before = work({ ln: 14, r: 8, p: 1 });
  for (const [label, params] of Object.entries(HASH_PROFILES)) {
    assert.ok(work(params) > before, `${label} is weaker than what it replaces`);
  }
});

test('the salt differs every time, so equal passwords hash differently', async () => {
  const a = await hashPassword('same');
  const b = await hashPassword('same');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('same', a));
  assert.ok(await verifyPassword('same', b));
});

/* ── verification ─────────────────────────────────────────────────────────── */

test('a new hash verifies the right password and rejects a wrong one', async () => {
  const h = await hashPassword('correct-horse');
  assert.equal(await verifyPassword('correct-horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('', h), false);
});

test('a hash made before this change still verifies', async () => {
  const h = legacyHash('correct-horse');
  assert.equal(await verifyPassword('correct-horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
});

/* Verification must use the parameters the hash was made with, not the current
   ones. This is the whole reason for recording them. */
test('a hash made with different parameters still verifies', async () => {
  const prev = process.env.PASSWORD_HASH_MEMORY;
  try {
    process.env.PASSWORD_HASH_MEMORY = '8mib';
    const weaker = await hashPassword('correct-horse');
    assert.match(weaker, /ln=13,r=8,p=10/);
    process.env.PASSWORD_HASH_MEMORY = '32mib';
    assert.equal(await verifyPassword('correct-horse', weaker), true,
      'raising the cost must not invalidate existing hashes');
  } finally {
    if (prev === undefined) delete process.env.PASSWORD_HASH_MEMORY;
    else process.env.PASSWORD_HASH_MEMORY = prev;
  }
});

test('a malformed hash fails the login rather than throwing', async () => {
  const cases = [
    '', 'nocolon', 'salt:', ':key', 'salt:nothex',
    '$scrypt$ln=14,r=8,p=5$onlyonefield',
    '$scrypt$ln=14,r=8$salt$key',
    '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    '$scrypt$ln=14,r=8,p=5$$',
    null, undefined, 0, {}, [],
  ];
  for (const h of cases) {
    assert.equal(await verifyPassword('anything', h), false, `should be false for ${JSON.stringify(h)}`);
  }
});

/* A hand-edited or corrupted hash must not be able to ask for an allocation big
   enough to take the process down instead of failing a login. */
test('absurd parameters are refused rather than attempted', async () => {
  for (const h of ['$scrypt$ln=31,r=8,p=1$c2FsdA$aGFzaA', '$scrypt$ln=14,r=999,p=1$c2FsdA$aGFzaA',
                   '$scrypt$ln=14,r=8,p=9999$c2FsdA$aGFzaA', '$scrypt$ln=0,r=8,p=1$c2FsdA$aGFzaA']) {
    assert.equal(parseHash(h), null, `${h} should not parse`);
    assert.equal(await verifyPassword('anything', h), false);
  }
});

test('verifying raises no uncaught exception for any malformed input', async () => {
  const seen = [];
  const onErr = e => seen.push(e);
  process.on('uncaughtException', onErr);
  try {
    for (const h of ['salt:nothex', '$scrypt$ln=14,r=8,p=5$c2FsdA$c2hvcnQ', 'x'.repeat(500)]) {
      await verifyPassword('anything', h);
    }
    await new Promise(r => setTimeout(r, 50));
  } finally {
    process.off('uncaughtException', onErr);
  }
  assert.deepEqual(seen, []);
});

/* ── needsRehash ──────────────────────────────────────────────────────────── */

test('a legacy hash is flagged for rewriting', () => {
  assert.equal(needsRehash(legacyHash('x')), true);
});

test('a current hash is not flagged', async () => {
  assert.equal(needsRehash(await hashPassword('x')), false);
});

test('a weaker hash is flagged, a stronger one is not', async () => {
  const prev = process.env.PASSWORD_HASH_MEMORY;
  try {
    process.env.PASSWORD_HASH_MEMORY = '8mib';
    const weak = await hashPassword('x');
    process.env.PASSWORD_HASH_MEMORY = '128mib';
    const strong = await hashPassword('x');

    process.env.PASSWORD_HASH_MEMORY = '32mib';
    assert.equal(needsRehash(weak), true, 'a lower work factor should be upgraded');
    assert.equal(needsRehash(strong), false, 'a higher one must be left alone');
  } finally {
    if (prev === undefined) delete process.env.PASSWORD_HASH_MEMORY;
    else process.env.PASSWORD_HASH_MEMORY = prev;
  }
});

/* 8mib and 16mib carry the same work factor, so moving between them is not an
   upgrade and must not cause a pointless rewrite. */
test('switching between rows of equal work does not force a rewrite', async () => {
  const prev = process.env.PASSWORD_HASH_MEMORY;
  try {
    process.env.PASSWORD_HASH_MEMORY = '8mib';
    const h = await hashPassword('x');
    process.env.PASSWORD_HASH_MEMORY = '16mib';
    assert.equal(needsRehash(h), false);
  } finally {
    if (prev === undefined) delete process.env.PASSWORD_HASH_MEMORY;
    else process.env.PASSWORD_HASH_MEMORY = prev;
  }
});

/* Choosing a heavier row is a deliberate decision to raise the work factor, and
   rewriting on next login is how that takes effect for an existing password. */
test('switching to a heavier row does rewrite on the next login', async () => {
  const prev = process.env.PASSWORD_HASH_MEMORY;
  try {
    process.env.PASSWORD_HASH_MEMORY = '16mib';
    const h = await hashPassword('x');
    process.env.PASSWORD_HASH_MEMORY = '128mib';
    assert.equal(needsRehash(h), true);
  } finally {
    if (prev === undefined) delete process.env.PASSWORD_HASH_MEMORY;
    else process.env.PASSWORD_HASH_MEMORY = prev;
  }
});

test('an unverifiable hash is not flagged, since there is nothing to carry over', () => {
  assert.equal(needsRehash('garbage'), false);
  assert.equal(needsRehash(null), false);
});

test('an unrecognised PASSWORD_HASH_MEMORY falls back to the default', async () => {
  const prev = process.env.PASSWORD_HASH_MEMORY;
  try {
    process.env.PASSWORD_HASH_MEMORY = 'enormous';
    assert.match(await hashPassword('x'), /^\$scrypt\$ln=14,r=8,p=5\$/);
  } finally {
    if (prev === undefined) delete process.env.PASSWORD_HASH_MEMORY;
    else process.env.PASSWORD_HASH_MEMORY = prev;
  }
});

/* ── the migration, end to end ────────────────────────────────────────────── */

let server, base;

before(async () => {
  require('../src/routes');
  const { dispatch } = require('../src/router');
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => { server.closeAllConnections?.(); server.close(r); }); });

const { loadConfig, saveConfig } = require('../src/config');

beforeEach(() => saveConfig({ items: [], settings: {} }));

function login(password) {
  const data = JSON.stringify({ password });
  const u = new URL(base + '/api/auth/login');
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
    }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    r.end(data);
  });
}

function setStoredHash(hash) {
  const cfg = loadConfig();
  cfg.settings.auth = { enabled: true, secret: 'a'.repeat(64), passwordHash: hash };
  saveConfig(cfg);
}

test('logging in with a legacy hash rewrites it in the new format', async () => {
  setStoredHash(legacyHash('correct-horse'));
  const r = await login('correct-horse');
  assert.equal(r.status, 200);
  const after = loadConfig().settings.auth.passwordHash;
  assert.match(after, /^\$scrypt\$ln=14,r=8,p=5\$/, 'the hash should have been upgraded');
  assert.equal(await verifyPassword('correct-horse', after), true, 'and still verify the same password');
});

test('a failed login does not touch the stored hash', async () => {
  const original = legacyHash('correct-horse');
  setStoredHash(original);
  assert.equal((await login('wrong')).status, 401);
  assert.equal(loadConfig().settings.auth.passwordHash, original);
});

test('logging in with a current hash leaves it alone', async () => {
  const current = await hashPassword('correct-horse');
  setStoredHash(current);
  assert.equal((await login('correct-horse')).status, 200);
  assert.equal(loadConfig().settings.auth.passwordHash, current);
});

test('the upgraded hash is what the next login verifies against', async () => {
  setStoredHash(legacyHash('correct-horse'));
  assert.equal((await login('correct-horse')).status, 200);
  assert.equal((await login('correct-horse')).status, 200);
  assert.equal((await login('wrong')).status, 401);
});
