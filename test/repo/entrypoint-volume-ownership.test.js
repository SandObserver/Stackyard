/* A mounted volume replaces the image's /data and /icons with the host's
   directory and the host's ownership. Started as root, the API runs as node, so
   a root-owned mount fails every config write with EACCES while the dashboard
   still serves. Started as any other UID, nothing in the container can change
   ownership.

   id, su and chown are stood in for here. What is being tested is when the
   entrypoint takes ownership, which cannot be exercised without root. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { entrypointArgs } = require('../../api/test-support/entrypoint');
const { tmpDir } = require('../../api/test-support/tmp');

/* @returns {{ status: number, chowned: string[], stderr: string }} */
function run({ uid = 0, writable = true, readOnly = false, chownFails = false, dirs = ['data', 'icons'] } = {}) {
  const dir = tmpDir('entrypoint-ownership');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  const log = path.join(dir, 'chown.log');

  const stub = (name, body) => {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
    return p;
  };
  stub('nginx', 'exit 0');
  stub('id', `echo ${uid}`);
  stub('su', `case "$*" in *mkdir*) exit 0 ;; esac\nexit ${writable ? 0 : 1}`);
  stub('chown', `echo "$*" >> ${log}\n[ "$1" = -R ] || exit 0\nexit ${chownFails ? 1 : 0}`);
  const handoff = stub('handoff', 'true');
  if (readOnly) {
    stub('mktemp', 'case "$1" in */data/* | */icons/*) exit 1 ;; esac\nPATH="${PATH#*:}" exec mktemp "$@"');
  }

  const made = dirs.map(name => {
    const p = path.join(dir, name);
    fs.mkdirSync(p);
    if (uid !== 0 && !writable) fs.chmodSync(p, 0o555);
    return p;
  });

  const r = spawnSync(
    'sh',
    entrypointArgs(dir, { data: path.join(dir, 'data'), icons: path.join(dir, 'icons') }, [handoff]),
    {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    },
  );
  const status = r.status;
  const stderr = r.stderr;

  const chowned = fs.existsSync(log)
    ? fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(line => line.startsWith('-R '))
    : [];
  return { status, chowned, stderr, dirs: made };
}

test('a root-owned mount is taken over for the node user', () => {
  const r = run({ writable: false });
  assert.equal(r.status, 0);
  assert.equal(r.chowned.length, 2);
  for (const call of r.chowned) assert.match(call, /^-R node:node /);
});

test('a volume node can already write is left alone', () => {
  const r = run({ writable: true });
  assert.equal(r.status, 0);
  assert.deepEqual(r.chowned, []);
});

test('a directory that does not exist is skipped', () => {
  const r = run({ writable: false, dirs: ['data'] });
  assert.equal(r.status, 0);
  assert.equal(r.chowned.length, 1);
  assert.match(r.chowned[0], /\/data$/);
});

/* The dashboard still serves read-only, so a failure here must not stop the
   container. set -eu would end the script on an unguarded chown. */
test('a chown that fails warns and starts the container anyway', () => {
  const r = run({ writable: false, chownFails: true });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /cannot take ownership/);
});

test('started as another UID, a volume it cannot write is reported, not taken over', () => {
  const r = run({ uid: 2000, writable: false });
  assert.equal(r.status, 0);
  assert.deepEqual(r.chowned, []);
  assert.equal((r.stderr.match(/UID 2000 cannot write/g) || []).length, 2);
});

test('started as another UID, a volume it can write is used quietly', () => {
  const r = run({ uid: 2000, writable: true });
  assert.equal(r.status, 0);
  assert.deepEqual(r.chowned, []);
  assert.equal(r.stderr, '');
});

/* A read-only mount keeps mode bits that grant write. */
test('started as another UID, a read-only volume is reported', () => {
  const r = run({ uid: 2000, writable: true, readOnly: true });
  assert.equal(r.status, 0);
  assert.equal((r.stderr.match(/UID 2000 cannot write/g) || []).length, 2);
});
