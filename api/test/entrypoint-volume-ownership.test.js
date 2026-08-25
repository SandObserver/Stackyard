/* A mounted volume replaces the image's /data and /icons with the host's
   directory and the host's ownership. The API runs as node, so a root-owned
   mount fails every config write with EACCES while the dashboard still serves.

   su and chown are stood in for here. What is being tested is when the
   entrypoint takes ownership, which cannot be exercised without root. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { tmpDir } = require('../test-support/tmp');

const ENTRYPOINT = path.join(__dirname, '../../docker-entrypoint.sh');

/* @returns {{ status: number, chowned: string[], stderr: string }} */
function run({ writable = true, chownFails = false, dirs = ['data', 'icons'] } = {}) {
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
  stub('su', writable ? 'exit 0' : 'exit 1');
  stub('chown', `echo "$*" >> ${log}\nexit ${chownFails ? 1 : 0}`);
  const handoff = stub('handoff', 'true');

  const made = dirs.map(name => {
    const p = path.join(dir, name);
    fs.mkdirSync(p);
    return p;
  });

  const r = spawnSync('sh', [ENTRYPOINT, handoff], {
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      REALIP_CONF: path.join(dir, 'realip.conf'),
      LISTEN_CONF: path.join(dir, 'listen-ipv6.inc'),
      INET6_PROC: path.join(dir, 'absent'),
      SUPERVISOR_FATAL_MARKER: path.join(dir, 'fatal'),
      DATA_DIR: path.join(dir, 'data'),
      ICONS_DIR: path.join(dir, 'icons'),
    },
    encoding: 'utf8',
  });
  const status = r.status;
  const stderr = r.stderr;

  const chowned = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
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
