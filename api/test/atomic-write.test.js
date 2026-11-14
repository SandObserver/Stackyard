const fs = require('node:fs');
const path = require('node:path');
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { tmpDir } = require('../test-support/tmp');
const { writeFileAtomic } = require('../src/atomic-write');

afterEach(() => mock.restoreAll());

const diskFillsUp = () => {
  const real = fs.writeFileSync;
  return mock.method(fs, 'writeFileSync', (file, data, ...rest) => {
    real(file, Buffer.from(data).subarray(0, 3), ...rest);
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  });
};

test('the file is written whole and nothing else is left in the folder', () => {
  const dir = tmpDir('atomic');
  writeFileAtomic(path.join(dir, 'a.png'), Buffer.from('contents'));
  assert.deepEqual(fs.readdirSync(dir), ['a.png']);
  assert.equal(fs.readFileSync(path.join(dir, 'a.png'), 'utf8'), 'contents');
});

test('a missing folder is created', () => {
  const dir = path.join(tmpDir('atomic'), 'sub');
  writeFileAtomic(path.join(dir, 'a.png'), 'x');
  assert.equal(fs.readFileSync(path.join(dir, 'a.png'), 'utf8'), 'x');
});

test('a failed write leaves neither the final name nor the temp file', () => {
  const dir = tmpDir('atomic');
  diskFillsUp();
  assert.throws(
    () => writeFileAtomic(path.join(dir, 'a.png'), Buffer.from('contents')),
    e => e.code === 'ENOSPC' && e.status === 507 && e.apiCode === 'internal.disk-full',
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a failed write leaves the file it would replace unchanged', () => {
  const dir = tmpDir('atomic');
  const target = path.join(dir, 'a.json');
  fs.writeFileSync(target, 'before');
  diskFillsUp();
  assert.throws(() => writeFileAtomic(target, 'after'), { code: 'ENOSPC' });
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'before');
});

for (const [code, status, apiCode] of [
  ['EDQUOT', 507, 'internal.disk-full'],
  ['EACCES', 500, 'internal.config-not-writable'],
  ['EPERM', 500, 'internal.config-not-writable'],
  ['EROFS', 500, 'internal.config-not-writable'],
]) {
  test(`${code} is reported as ${apiCode}`, () => {
    const dir = tmpDir('atomic');
    mock.method(fs, 'openSync', () => {
      throw Object.assign(new Error(code), { code });
    });
    assert.throws(
      () => writeFileAtomic(path.join(dir, 'a.png'), 'x'),
      e => e.status === status && e.apiCode === apiCode,
    );
  });
}

test('an unknown failure carries no status of its own', () => {
  const dir = tmpDir('atomic');
  mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('EIO'), { code: 'EIO' });
  });
  assert.throws(
    () => writeFileAtomic(path.join(dir, 'a.png'), 'x'),
    e => e.code === 'EIO' && e.status === undefined && e.apiCode === undefined,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('noReplace refuses an existing name and leaves it unchanged', () => {
  const dir = tmpDir('atomic');
  const target = path.join(dir, 'a.png');
  fs.writeFileSync(target, 'first');
  assert.throws(() => writeFileAtomic(target, 'second', { noReplace: true }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'first');
  assert.deepEqual(fs.readdirSync(dir), ['a.png']);
});

test('noReplace writes a free name', () => {
  const dir = tmpDir('atomic');
  writeFileAtomic(path.join(dir, 'a.png'), 'x', { noReplace: true });
  assert.deepEqual(fs.readdirSync(dir), ['a.png']);
});

test('noReplace still refuses an existing name on a folder without hard links', () => {
  const dir = tmpDir('atomic');
  mock.method(fs, 'linkSync', () => {
    throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
  });
  writeFileAtomic(path.join(dir, 'a.png'), 'first', { noReplace: true });
  assert.throws(() => writeFileAtomic(path.join(dir, 'a.png'), 'second', { noReplace: true }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(path.join(dir, 'a.png'), 'utf8'), 'first');
  assert.deepEqual(fs.readdirSync(dir), ['a.png']);
});

test('a fixed temp path left by a crash is replaced, and the mode is applied', () => {
  const dir = tmpDir('atomic');
  const target = path.join(dir, 'apps.json');
  fs.writeFileSync(`${target}.tmp`, 'stale', { mode: 0o644 });
  writeFileAtomic(target, '{}', { tmp: `${target}.tmp`, mode: 0o600 });
  assert.deepEqual(fs.readdirSync(dir), ['apps.json']);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
});

test('the contents are flushed before the name appears, and the folder after', () => {
  const dir = tmpDir('atomic');
  const calls = [];
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  mock.method(fs, 'fsyncSync', fd => {
    calls.push('fsync');
    return realFsync(fd);
  });
  mock.method(fs, 'renameSync', (a, b) => {
    calls.push('rename');
    return realRename(a, b);
  });
  writeFileAtomic(path.join(dir, 'a.png'), 'x');
  assert.deepEqual(calls, ['fsync', 'rename', 'fsync']);
});
