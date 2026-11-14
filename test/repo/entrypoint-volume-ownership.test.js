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
function run({
  uid = 0,
  writable = true,
  readOnly = false,
  chownFails = false,
  dirs = ['data', 'icons'],
  env = () => ({}),
} = {}) {
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
  /* A folder counts as writable for node once a chown -R has covered it. */
  stub(
    'su',
    [
      'case "$*" in *mkdir*) exit 0 ;; esac',
      writable ? 'exit 0' : '',
      'd="$(printf %s "$5" | sed \'s/^test -w "\\(.*\\)"$/\\1/\')"',
      '[ -e "$d/.chowned" ]',
    ].join('\n'),
  );
  stub(
    'chown',
    [
      `echo "$*" >> ${log}`,
      '[ "$1" = -R ] || exit 0',
      chownFails ? 'exit 1' : 'find "$3" -type d -exec touch {}/.chowned \\;',
    ].join('\n'),
  );
  const handoff = stub('handoff', 'true');
  if (readOnly) {
    stub('mktemp', 'case "$1" in */data/* | */icons/*) exit 1 ;; esac\nPATH="${PATH#*:}" exec mktemp "$@"');
  }

  const made = dirs.map(name => {
    const p = path.join(dir, name);
    fs.mkdirSync(p, { recursive: true });
    if (uid !== 0 && !writable) fs.chmodSync(p, 0o555);
    return p;
  });

  const r = spawnSync(
    'sh',
    entrypointArgs(dir, { data: path.join(dir, 'data'), icons: path.join(dir, 'icons') }, [handoff]),
    {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        ...env(dir),
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
  return { status, chowned, stderr, dir, dirs: made };
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

test('started as root, the folders CONFIG_PATH and ICONS_PATH name are taken over, not the defaults', () => {
  const r = run({
    writable: false,
    dirs: ['data', 'icons', 'config', 'media/icons'],
    env: dir => ({ CONFIG_PATH: `${dir}/config/apps.json`, ICONS_PATH: `${dir}/media/icons` }),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.chowned, [`-R node:node ${r.dir}/config`, `-R node:node ${r.dir}/media/icons`]);
});

/* One volume at /data, as on Railway, with the icons folder not made yet. */
test('started as root, an icons folder inside the data folder is made and taken over once', () => {
  const r = run({ writable: false, dirs: ['data'], env: dir => ({ ICONS_PATH: `${dir}/data/icons` }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.chowned, [`-R node:node ${r.dir}/data`]);
  assert.ok(fs.statSync(path.join(r.dir, 'data', 'icons')).isDirectory());
});

test('started as another UID, the folders CONFIG_PATH and ICONS_PATH name are the ones checked', () => {
  const r = run({
    uid: 2000,
    writable: false,
    dirs: ['config', 'media/icons'],
    env: dir => ({ CONFIG_PATH: `${dir}/config/apps.json`, ICONS_PATH: `${dir}/media/icons` }),
  });
  assert.equal(r.status, 0);
  assert.deepEqual(r.chowned, []);
  assert.match(r.stderr, /UID 2000 cannot write \S+\/config;/);
  assert.match(r.stderr, /UID 2000 cannot write \S+\/media\/icons;/);
});
