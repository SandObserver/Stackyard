/* The image starts as root or as any other UID, including one with no passwd
   entry. Started as root it switches nginx workers and the API to their own
   accounts. Started as any other UID it cannot switch, so it must not try:
   supervisord refuses to start with user= set, and nginx cannot write under
   /var/lib/nginx.

   id, chown and nginx are stood in for here. What is being tested is what the
   entrypoint renders and refuses for each account, not nginx or supervisord. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { entrypointArgs } = require('../../api/test-support/entrypoint');
const { tmpDir } = require('../../api/test-support/tmp');

const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* floor: null for Docker's 0, 'absent' for a kernel without the file, or the
   file's content.
   @returns {{ status: number, started: boolean, stderr: string, runtime: string, tmpdir: string, file: (name: string) => string }} */
function run({ uid = 0, env = {}, floor = null, inet6 = null, setup = () => {} } = {}) {
  const dir = tmpDir('entrypoint-any-user');
  const binDir = path.join(dir, 'bin');
  const runtime = path.join(dir, 'run');
  fs.mkdirSync(binDir);
  fs.mkdirSync(runtime);
  fs.chmodSync(runtime, 0o1777);
  setup({ dir, runtime });

  const stub = (name, body) => {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(p, 0o755);
    return p;
  };
  stub('nginx', 'exit 0');
  stub('id', `echo ${uid}`);
  stub('chown', 'exit 0');
  stub('su', 'while [ "$1" != -c ]; do shift; done\nsh -c "$2"');
  const started = path.join(dir, 'started');
  const handoff = stub('handoff', 'printf %s "$TMPDIR" > "$SY_STARTED"');

  const paths = { runtime };
  if (inet6) paths.inet6 = inet6;
  if (floor !== null) {
    paths.floor = path.join(dir, 'floor');
    if (floor !== 'absent') fs.writeFileSync(paths.floor, `${floor}\n`);
  }

  const r = spawnSync('sh', entrypointArgs(dir, paths, [handoff]), {
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      SY_STARTED: started,
      ...env,
    },
    encoding: 'utf8',
  });
  return {
    status: r.status,
    started: fs.existsSync(started),
    stderr: r.stderr,
    runtime,
    tmpdir: fs.existsSync(started) ? fs.readFileSync(started, 'utf8') : '',
    file: name => fs.readFileSync(path.join(runtime, name), 'utf8'),
  };
}

/* ── LISTEN_PORT ──────────────────────────────────────────────────────────── */

test('nginx listens on 80 when LISTEN_PORT is unset or empty', () => {
  for (const env of [{}, { LISTEN_PORT: '' }]) {
    const r = run({ env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.file('listen.conf'), /^listen 80;$/m);
  }
});

test('LISTEN_PORT replaces port 80', () => {
  const r = run({ env: { LISTEN_PORT: '8080' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.file('listen.conf'), /^listen 8080;$/m);
  assert.doesNotMatch(r.file('listen.conf'), /listen 80;/);
});

test('LISTEN_PORT reaches the IPv6 listener too', () => {
  const dir = tmpDir('entrypoint-any-user-v6');
  const inet6 = path.join(dir, 'if_inet6');
  fs.writeFileSync(inet6, '00000000000000000000000000000001 01 80 10 80 lo\n');
  const r = run({ inet6, env: { LISTEN_PORT: '8080' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.file('listen.conf'), /^listen \[::\]:8080;$/m);
});

/* A value nginx would reject, or one that collides with the API, must stop the
   container with a message that names the setting. */
test('an unusable LISTEN_PORT stops the container before anything starts', () => {
  for (const value of ['abc', '0', '080', '65536', '999999', '-1', '80 ', '8080;', '3000']) {
    const r = run({ env: { LISTEN_PORT: value } });
    assert.equal(r.status, 1, `"${value}" was accepted`);
    assert.ok(!r.started, `"${value}" started the container`);
    assert.match(r.stderr, /LISTEN_PORT/, `"${value}" gave no reason`);
  }
});

test('the highest and lowest valid ports are accepted', () => {
  for (const value of ['1', '65535']) {
    const r = run({ env: { LISTEN_PORT: value } });
    assert.equal(r.status, 0, `${value}: ${r.stderr}`);
  }
});

/* ── ports below the system's floor ───────────────────────────────────────── */

/* Docker and Podman set the floor to 0 inside a container. Host networking
   keeps the host's 1024, and nginx would then fail to bind with no hint. */
test('a UID other than root is told when the system blocks its port', () => {
  const r = run({ uid: 2000, floor: 1024 });
  assert.equal(r.status, 1);
  assert.ok(!r.started);
  assert.match(r.stderr, /UID 2000 cannot listen on port 80/);
  assert.match(r.stderr, /Set LISTEN_PORT to 1024 or higher/);
});

test('a UID other than root starts on a port the system allows', () => {
  for (const [floor, port] of [
    [0, '80'],
    [1024, '8080'],
    [1024, '1024'],
  ]) {
    const r = run({ uid: 2000, floor, env: { LISTEN_PORT: port } });
    assert.equal(r.status, 0, `floor ${floor}, port ${port}: ${r.stderr}`);
  }
});

test('a kernel without the floor file is held to 1024, as such kernels are', () => {
  for (const floor of ['absent', '', 'garbage']) {
    const refused = run({ uid: 2000, floor });
    assert.equal(refused.status, 1, `floor "${floor}"`);
    assert.match(refused.stderr, /allows ports from 1024 up/, `floor "${floor}"`);
    const allowed = run({ uid: 2000, floor, env: { LISTEN_PORT: '1024' } });
    assert.equal(allowed.status, 0, `floor "${floor}": ${allowed.stderr}`);
  }
});

test('root is not held to the floor', () => {
  const r = run({ uid: 0, floor: 1024 });
  assert.equal(r.status, 0, r.stderr);
});

/* ── account switches ─────────────────────────────────────────────────────── */

test('started as root, nginx workers and the API get their own accounts', () => {
  const r = run({ uid: 0 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.file('nginx-user.conf'), /^user nginx;$/m);
  const sup = r.file('supervisord-user.conf');
  assert.match(sup, /^\[supervisord\]\nuser=root$/m);
  assert.match(sup, /^\[program:api\]\nuser=node$/m);
});

test('started as another UID, no account switch is written', () => {
  const r = run({ uid: 2000 });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.file('nginx-user.conf'), /^\s*user /m);
  assert.doesNotMatch(r.file('supervisord-user.conf'), /user=/);
});

/* ── the runtime folder ───────────────────────────────────────────────────── */

/* The image ships the folder writable by every UID. Started as root, the
   entrypoint writes there with `>`, which follows a link a previous run's API
   could have planted. */
test('started as root, anything left in the runtime folder is removed first', () => {
  const dir = tmpDir('entrypoint-any-user-target');
  const target = path.join(dir, 'target');
  fs.writeFileSync(target, 'untouched\n');
  const r = run({
    uid: 0,
    setup: ({ runtime }) => {
      fs.symlinkSync(target, path.join(runtime, 'realip.conf'));
      fs.writeFileSync(path.join(runtime, 'leftover'), 'x');
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched\n');
  assert.ok(!fs.lstatSync(path.join(r.runtime, 'realip.conf')).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(r.runtime, 'leftover')));
  assert.equal(fs.statSync(r.runtime).mode & 0o7777, 0o755);
});

/* nginx chowns a temp folder it finds owned by another account. A root start
   without CAP_CHOWN then fails. */
test('started as root, every nginx temp folder exists before nginx starts', () => {
  const r = run({ uid: 0 });
  assert.equal(r.status, 0, r.stderr);
  const temp = path.join(r.runtime, 'nginx');
  assert.equal(fs.statSync(temp).mode & 0o777, 0o755);
  const paths = [...read('nginx/dashboard.conf').matchAll(/^\w+_temp_path\s+\/run\/stackyard\/nginx\/(\w+);$/gm)];
  assert.equal(paths.length, 5);
  for (const [, name] of paths) {
    assert.equal(fs.statSync(path.join(temp, name)).mode & 0o777, 0o700, name);
  }
});

test('started as another UID, an unwritable runtime folder stops the container with a reason', () => {
  const r = run({ uid: 2000, setup: ({ runtime }) => fs.chmodSync(runtime, 0o555) });
  assert.equal(r.status, 1);
  assert.ok(!r.started);
  assert.match(r.stderr, /UID 2000 cannot write .*mount a tmpfs on .*\/run/);
});

/* /tmp is writable by every account in the container. Root must not create or
   delete a name there that the API's account could have planted first. */
test('supervisord gets the runtime folder as its temporary folder, for every UID', () => {
  for (const uid of [0, 2000]) {
    const r = run({ uid, env: { TMPDIR: '/nonexistent/tmp' } });
    assert.equal(r.status, 0, `uid ${uid}: ${r.stderr}`);
    assert.equal(r.tmpdir, r.runtime, `uid ${uid}`);
  }
});

test('the entrypoint never touches /tmp', () => {
  const code = read('docker-entrypoint-lib.sh')
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /\/tmp\b|TMPDIR:-/);
});

/* A redirect that fails on a { } group does not end the script under set -e.
   nginx would then start on a stale or missing file. */
test('a generated file that cannot be written stops the container', () => {
  for (const name of ['realip.conf', 'listen.conf', 'nginx-user.conf', 'supervisord-user.conf']) {
    const r = run({ uid: 2000, setup: ({ runtime }) => fs.mkdirSync(path.join(runtime, name)) });
    assert.equal(r.status, 1, name);
    assert.ok(!r.started, name);
    assert.match(r.stderr, new RegExp(`cannot write .*${name.replace('.', '\\.')}`), name);
  }
});

/* Root empties the runtime folder. A path read from the environment would let
   one setting point that at the user's config. */
test('no path the entrypoint writes or deletes can be moved by the environment', () => {
  const decoy = tmpDir('entrypoint-any-user-decoy');
  fs.writeFileSync(path.join(decoy, 'apps.json'), 'keep\n');
  const env = {};
  for (const name of [
    'RUNTIME_DIR',
    'DATA_DIR',
    'ICONS_DIR',
    'REALIP_CONF',
    'LISTEN_CONF',
    'NGINX_USER_CONF',
    'SUPERVISOR_USER_CONF',
    'SUPERVISOR_FATAL_MARKER',
    'MARKER',
  ]) {
    env[name] = decoy;
  }
  const r = run({ uid: 0, env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(decoy), ['apps.json']);
  assert.equal(fs.readFileSync(path.join(decoy, 'apps.json'), 'utf8'), 'keep\n');
  assert.ok(fs.existsSync(path.join(r.runtime, 'realip.conf')));
});

test('the entrypoint reads only documented settings from the environment', () => {
  const lib = read('docker-entrypoint-lib.sh');
  const fromEnv = [...new Set([...lib.matchAll(/\$\{([A-Z_]+):-/g)].map(m => m[1]))].sort();
  assert.deepEqual(fromEnv, ['LISTEN_PORT', 'TRUSTED_PROXY']);
  assert.doesNotMatch(read('docker-entrypoint.sh'), /\$\{?[A-Z_]+/, 'docker-entrypoint.sh must pass literal paths');
});

/* ── the shipped config agrees with the entrypoint ───────────────────────── */

const call = /^stackyard_main (\S+) (\S+) (\S+) (\S+) (\S+) -- "\$@"$/m.exec(read('docker-entrypoint.sh'));
const runtimeDir = call?.[1];
const defaultPath = name => {
  const m = new RegExp(`${name}="\\$RUNTIME_DIR/([^"]+)"`).exec(read('docker-entrypoint-lib.sh'));
  assert.ok(m, `${name} is not under the runtime folder`);
  return `${runtimeDir}/${m[1]}`;
};

test('docker-entrypoint.sh passes the real paths', () => {
  assert.ok(call, 'docker-entrypoint.sh does not call stackyard_main with five paths');
  assert.deepEqual(call.slice(1), [
    '/run/stackyard',
    '/data',
    '/icons',
    '/proc/net/if_inet6',
    '/proc/sys/net/ipv4/ip_unprivileged_port_start',
  ]);
});

test('the image ships the library where docker-entrypoint.sh sources it', () => {
  const sourced = /^\. (\S+)$/m.exec(read('docker-entrypoint.sh'));
  assert.ok(sourced, 'docker-entrypoint.sh sources no library');
  assert.ok(read('Dockerfile').split('\n').includes(`COPY docker-entrypoint-lib.sh ${sourced[1]}`));
});

test('the runtime folder is the one the image creates for every UID', () => {
  assert.equal(runtimeDir, '/run/stackyard');
  assert.match(read('Dockerfile'), /mkdir -p \/run\/stackyard && chmod 1777 \/run\/stackyard/);
});

/* The API's account cannot write the runtime folder on the root path. It gets
   the default temporary folder back. */
test("the API does not inherit supervisord's temporary folder", () => {
  const api = read('supervisord.conf').split('[program:api]')[1].split('\n[')[0];
  assert.match(api, /^environment=.*TMPDIR="\/tmp"/m);
});

test('nginx reads the files the entrypoint writes', () => {
  const dashboard = read('nginx/dashboard.conf');
  assert.ok(dashboard.includes(`include ${defaultPath('LISTEN_CONF')};`));
  assert.ok(dashboard.includes(`include ${defaultPath('REALIP_CONF')};`));
  assert.ok(read('Dockerfile').includes(`include ${defaultPath('NGINX_USER_CONF')};`));
});

test('supervisord reads the file the entrypoint writes, and sets no user itself', () => {
  const supervisord = read('supervisord.conf');
  assert.match(supervisord, new RegExp(`^\\[include\\]\\nfiles=${defaultPath('SUPERVISOR_USER_CONF')}$`, 'm'));
  assert.doesNotMatch(supervisord, /^user=/m);
});

/* Every path nginx and supervisord write at start must be under the runtime
   folder. The Alpine defaults are writable by root or nginx only. */
test('nothing nginx or supervisord writes is outside the runtime folder', () => {
  const dashboard = read('nginx/dashboard.conf');
  for (const kind of ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) {
    assert.match(dashboard, new RegExp(`^${kind}_temp_path\\s+/run/stackyard/nginx/${kind};$`, 'm'), kind);
  }
  const supervisord = read('supervisord.conf');
  for (const key of ['logfile', 'pidfile']) {
    assert.match(supervisord, new RegExp(`^${key}=/run/stackyard/`, 'm'), key);
  }
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /error_log stderr warn;/);
  assert.match(dockerfile, /pid \/run\/stackyard\/nginx\.pid;/);
  assert.match(dockerfile, /access_log off;/);
  assert.match(read('supervisord.conf'), /^command=\/usr\/sbin\/nginx -e stderr /m);
});

/* A health check on a fixed port marks a container with LISTEN_PORT set as
   unhealthy, and an orchestrator then restarts it in a loop. */
test('both health checks follow LISTEN_PORT', () => {
  assert.match(read('Dockerfile'), /http:\/\/127\.0\.0\.1:\$\{LISTEN_PORT:-80\}\/health/);
  assert.match(read('docker-compose.yml'), /http:\/\/localhost:\$\$\{LISTEN_PORT:-80\}\/health/);
});
