/* `docker stop` sends SIGTERM to the entrypoint, which forwards it to
   supervisord. The entrypoint must outlive supervisord's shutdown: once PID 1
   exits, the kernel kills every process left in the container.

   Runs the real entrypoint with a stand-in nginx and a stand-in supervisord
   that takes a moment to shut down. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { tmpDir } = require('../../api/test-support/tmp');

const ENTRYPOINT = path.join(__dirname, '../../docker-entrypoint.sh');

const stub = (dir, name, body) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
};

const waitFor = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 20));
  }
};

/* @returns {Promise<{ code: number|null, stopped: boolean, stderr: string }>}
   `stopped` is whether the stand-in had finished its shutdown when the
   entrypoint exited. */
async function run({ child, signals = ['SIGTERM'], marker = false }) {
  const dir = tmpDir('entrypoint-stop');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  stub(binDir, 'nginx', 'exit 0');
  const handoff = stub(binDir, 'handoff', child);
  const started = path.join(dir, 'started');
  const done = path.join(dir, 'done');
  const fatal = path.join(dir, 'fatal');

  const proc = spawn('sh', [ENTRYPOINT, handoff], {
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      REALIP_CONF: path.join(dir, 'realip.conf'),
      LISTEN_CONF: path.join(dir, 'listen-ipv6.inc'),
      DATA_DIR: path.join(dir, 'no-data'),
      ICONS_DIR: path.join(dir, 'no-icons'),
      SUPERVISOR_FATAL_MARKER: fatal,
      SY_STARTED: started,
      SY_DONE: done,
      SY_FATAL: marker ? fatal : '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', d => {
    stderr += d;
  });
  const exited = new Promise(resolve => proc.on('exit', status => resolve(status)));

  await waitFor(() => fs.existsSync(started));
  for (const [i, sig] of signals.entries()) {
    if (i) await new Promise(r => setTimeout(r, 100));
    proc.kill(sig);
  }
  const code = await exited;
  return { code, stopped: fs.existsSync(done), stderr };
}

/* Shuts down over 300 ms after SIGTERM, then exits 0 as supervisord does. */
const SLOW_STOP = [
  'trap \'sleep 0.3; [ -n "$SY_FATAL" ] && echo api > "$SY_FATAL"; touch "$SY_DONE"; exit 0\' TERM',
  'touch "$SY_STARTED"',
  'while :; do sleep 0.05; done',
].join('\n');

test('docker stop waits for supervisord to finish shutting down', async () => {
  const r = await run({ child: SLOW_STOP });
  assert.ok(r.stopped, 'the entrypoint exited while supervisord was still shutting down');
  assert.equal(r.code, 0, 'a clean stop must exit with supervisord status');
});

test('Ctrl-C in the foreground waits the same way', async () => {
  const r = await run({ child: SLOW_STOP, signals: ['SIGINT'] });
  assert.ok(r.stopped);
  assert.equal(r.code, 0);
});

test('a second signal during shutdown still waits', async () => {
  const r = await run({ child: SLOW_STOP, signals: ['SIGTERM', 'SIGTERM'] });
  assert.ok(r.stopped, 'the entrypoint exited on the second signal');
  assert.equal(r.code, 0);
});

test('a program that could not be started still fails the container after a stop', async () => {
  const r = await run({ child: SLOW_STOP, marker: true });
  assert.ok(r.stopped);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /api could not be started/);
});

test('supervisord exiting on its own passes its status through', async () => {
  const r = await run({ child: 'touch "$SY_STARTED"; sleep 0.1; exit 3', signals: [] });
  assert.equal(r.code, 3);
});
