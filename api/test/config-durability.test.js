/* Regression tests for P5-7, P5-11 and P5-12: the config write.

   Writing to a temp file and renaming it into place means no reader ever sees a
   half-written config, and that part was already right. What it does not do on
   its own is get the contents onto the disk: a write lands in the operating
   system's cache and is flushed later, so a power cut in that window can leave
   the rename applied and the contents lost. That is not remote on the hardware
   this targets, where a Pi on an SD card is routinely unplugged rather than shut
   down, and the result is an empty or truncated config: the whole dashboard.

   Two smaller faults in the same function. The in-memory cache was updated even
   when the write threw, so the app went on showing changes that were never
   saved. And a failed write left its temp file behind for good.

   The flushing itself cannot be observed from a test, since the point of it is
   what survives a power cut, so these tests pin the calls that provide it and
   the behaviour around them. */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-durability-'));
process.env.CONFIG_PATH = path.join(dir, 'apps.json');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { saveConfig, loadConfig } = config;

const TMP = process.env.CONFIG_PATH + '.tmp';

beforeEach(() => {
  try { fs.unlinkSync(TMP); } catch {}
  saveConfig({ items: [{ id: 'original', type: 'app', name: 'Original' }], settings: {} });
});

/* ── the ordinary path still works ────────────────────────────────────────── */

test('a saved config reads back', () => {
  saveConfig({ items: [{ id: 'a1', type: 'app', name: 'A' }], settings: { language: 'en' } });
  const got = loadConfig();
  assert.ok(got.items.some(i => i.id === 'a1'));
  assert.equal(got.settings.language, 'en');
});

test('no temp file is left behind after a successful save', () => {
  saveConfig({ items: [], settings: {} });
  assert.equal(fs.existsSync(TMP), false);
});

test('the file on disk is complete and parseable', () => {
  saveConfig({ items: [{ id: 'a1', type: 'app', name: 'A' }], settings: {} });
  const raw = fs.readFileSync(process.env.CONFIG_PATH, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'a truncated write would fail here');
  assert.ok(raw.trimEnd().endsWith('}'), 'the file must be whole');
});

/* ── durability ───────────────────────────────────────────────────────────── */

/* The flush cannot be observed by its effect, so the calls are observed instead.
   Without them the rename can outlive the contents after a power cut. */
test('the contents are flushed before the rename', () => {
  const calls = [];
  const real = { fsync: fs.fsyncSync, rename: fs.renameSync };
  fs.fsyncSync = fd => { calls.push('fsync'); return real.fsync(fd); };
  fs.renameSync = (a, b) => { calls.push('rename'); return real.rename(a, b); };
  try {
    saveConfig({ items: [], settings: {} });
  } finally {
    fs.fsyncSync = real.fsync;
    fs.renameSync = real.rename;
  }
  assert.ok(calls.includes('fsync'), 'nothing was flushed, so a power cut can lose the contents');
  assert.ok(calls.indexOf('fsync') < calls.indexOf('rename'),
    'flushing after the rename does not help: the rename would already be visible');
});

/* A rename changes a directory entry, which needs to reach the disk too, or the
   file can revert to its old name after a crash. */
test('the directory is flushed after the rename', () => {
  const calls = [];
  const real = { fsync: fs.fsyncSync, rename: fs.renameSync };
  fs.fsyncSync = fd => { calls.push('fsync'); return real.fsync(fd); };
  fs.renameSync = (a, b) => { calls.push('rename'); return real.rename(a, b); };
  try {
    saveConfig({ items: [], settings: {} });
  } finally {
    fs.fsyncSync = real.fsync;
    fs.renameSync = real.rename;
  }
  assert.ok(calls.lastIndexOf('fsync') > calls.indexOf('rename'),
    'the directory entry was never flushed');
});

/* Some filesystems refuse to fsync a directory. The contents are already durable
   by then, so that must not fail the save. */
test('a directory that cannot be flushed does not fail the save', () => {
  const real = fs.fsyncSync;
  let seen = 0;
  fs.fsyncSync = fd => { if (++seen > 1) throw new Error('EINVAL'); return real(fd); };
  try {
    assert.doesNotThrow(() => saveConfig({ items: [{ id: 'still-saved' }], settings: {} }));
  } finally {
    fs.fsyncSync = real;
  }
  assert.ok(loadConfig().items.some(i => i.id === 'still-saved'));
});

/* ── a failed write ───────────────────────────────────────────────────────── */

function withFailingRename(fn) {
  const real = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated disk failure'); };
  try { return fn(); } finally { fs.renameSync = real; }
}

test('a failed save reports the failure rather than swallowing it', () => {
  withFailingRename(() => {
    assert.throws(() => saveConfig({ items: [{ id: 'newer' }], settings: {} }), /simulated disk failure/);
  });
});

/* The cache was updated even when the write threw, so the app went on showing
   changes that were never saved: the most misleading of the three faults. */
test('a failed save does not leave the cache claiming it succeeded', () => {
  withFailingRename(() => {
    try { saveConfig({ items: [{ id: 'newer' }], settings: {} }); } catch {}
  });
  const ids = loadConfig().items.map(i => i.id);
  assert.ok(ids.includes('original'), `cache reports ${ids.join(', ')}`);
  assert.ok(!ids.includes('newer'), 'a config that was never written must not appear saved');
});

test('a failed save leaves the file on disk untouched', () => {
  withFailingRename(() => {
    try { saveConfig({ items: [{ id: 'newer' }], settings: {} }); } catch {}
  });
  const raw = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8'));
  assert.ok(raw.items.some(i => i.id === 'original'));
});

test('a failed save cleans up its temp file', () => {
  withFailingRename(() => {
    try { saveConfig({ items: [{ id: 'newer' }], settings: {} }); } catch {}
  });
  assert.equal(fs.existsSync(TMP), false, 'the temp file would otherwise stay behind for good');
});

/* ── the revision still advances ──────────────────────────────────────────── */

test('a successful save bumps the revision', () => {
  const before = loadConfig()._rev;
  saveConfig(loadConfig());
  assert.equal(loadConfig()._rev, before + 1);
});
