const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const supervisord = read('supervisord.conf');
const dockerfile = read('Dockerfile');
const entrypoint = read('docker-entrypoint.sh');
const listener = read('scripts/exit-on-fatal.py');

/* ── the listener is registered and will be reached ───────────────────────── */

test('an event listener is registered for FATAL', () => {
  assert.match(supervisord, /^\[eventlistener:exit-on-fatal\]$/m);
  assert.match(
    supervisord,
    /^events=PROCESS_STATE_FATAL$/m,
    'without this event the listener never hears about a program giving up',
  );
});

test('the listener starts, and restarts if it dies', () => {
  const block = supervisord.slice(supervisord.indexOf('[eventlistener:exit-on-fatal]'));
  assert.match(block, /^autostart=true$/m);
  assert.match(block, /^autorestart=true$/m, 'a listener that has died protects nothing');
});

/* Started before the programs it watches, so a program that fails immediately is
   not missed. */
test('the listener has priority over the programs it watches', () => {
  const priority = section => {
    const at = supervisord.indexOf(section);
    const m = /^priority=(\d+)$/m.exec(supervisord.slice(at, supervisord.indexOf('\n[', at + 1)));
    return m ? Number(m[1]) : Infinity;
  };
  const listenerPriority = priority('[eventlistener:exit-on-fatal]');
  for (const program of ['[program:nginx]', '[program:api]']) {
    assert.ok(listenerPriority < priority(program), `the listener must start before ${program}`);
  }
});

/* ── the failure reaches the container's exit code ────────────────────────── */

/* supervisord always exits 0 on SIGTERM, so the marker is what carries the
   failure out. Without it a dead API would read as a normal shutdown. */
test('the listener writes a marker and the entrypoint reads the same one', () => {
  const inListener = /SUPERVISOR_FATAL_MARKER',\s*'([^']+)'/.exec(listener);
  const inEntrypoint = /SUPERVISOR_FATAL_MARKER:-([^}]+)\}/.exec(entrypoint);
  assert.ok(inListener, 'the listener does not define a marker path');
  assert.ok(inEntrypoint, 'the entrypoint does not read one');
  assert.equal(inListener[1], inEntrypoint[1].trim(), 'the two must agree or the failure never reaches the exit code');
});

test('the entrypoint exits non-zero when the marker is present', () => {
  assert.match(entrypoint, /if \[ -f "\$MARKER" \]/);
  assert.match(entrypoint, /exit 1/);
});

test('the marker is cleared at startup and after being read', () => {
  /* A marker left behind would fail every subsequent start. */
  assert.ok(
    (entrypoint.match(/rm -f "\$MARKER"/g) || []).length >= 2,
    'the marker must be cleared before running and after reading it',
  );
});

/* ── shutdown still works ─────────────────────────────────────────────────── */

test('signals are forwarded to supervisord', () => {
  assert.match(
    entrypoint,
    /trap '[^']*kill -TERM "\$child"[^']*' TERM INT/,
    'docker stop would otherwise not reach supervisord',
  );
  assert.match(entrypoint, /wait "\$child"/);
});

test('the entrypoint reports the real exit code when nothing failed', () => {
  assert.match(entrypoint, /exit "\$status"/, 'an ordinary shutdown must not be reported as a failure');
});

/* ── the image ships what the config names ────────────────────────────────── */

test('the listener script is copied into the image at the path the config uses', () => {
  const m = /^command=(\S+) (\S+)$/m.exec(supervisord.slice(supervisord.indexOf('[eventlistener:exit-on-fatal]')));
  assert.ok(m, 'the listener has no command');
  const [, interpreter, script] = m;
  assert.ok(dockerfile.includes(`${script}`), `${script} is not copied into the image`);
  assert.ok(
    dockerfile.includes(interpreter),
    `${interpreter} is never asserted to exist, so the listener could fail to start silently`,
  );
});

test('the script is valid Python, checked at build time', () => {
  /* A listener that cannot start would leave the failure it exists to catch
     undetected, so the build refuses rather than shipping it. */
  assert.match(dockerfile, /python3 -c "import ast/);
});

test('the listener only acts on FATAL', () => {
  assert.match(listener, /PROCESS_STATE_FATAL/);
  /* Anything else is acknowledged and ignored; acting on a normal restart would
     take the container down every time a program blipped. */
  assert.match(listener, /RESULT 2\\nOK/);
});

/* ── the boot log stays quiet without losing the safety net ───────────────── */

const listenerBlock = () => supervisord.slice(supervisord.indexOf('[eventlistener:exit-on-fatal]'));

/* This program's stdout is the event listener protocol channel. Pointing it at
   /dev/stdout makes supervisord copy READY, RESULT and OK into `docker logs`,
   where they read as noise nobody can act on. */
test('the listener protocol does not reach the container log', () => {
  const m = /^stdout_logfile=(\S+)$/m.exec(listenerBlock());
  assert.ok(m, 'the listener has no stdout_logfile');
  assert.notEqual(m[1], '/dev/stdout', 'this puts READY, RESULT and OK in docker logs');
});

/* The other half, and the one that must never be traded away: the "could not be
   started" message goes to stderr, and it is the plainest explanation an
   operator gets once supervisord stops narrating at info. */
test('the listener still reports failure on stderr', () => {
  assert.match(listenerBlock(), /^stderr_logfile=\/dev\/stderr$/m);
});

/* At info, supervisord narrates its own startup in eight lines that say nothing
   an operator acts on. At warn the crash-loop line (`exited: ... not expected`)
   and configuration failures both survive. `gave up: ... entered FATAL state` is
   logged at info and is lost, which is why the two messages above exist. */
test('supervisord logs at warn, not info', () => {
  assert.match(supervisord, /^loglevel=warn$/m);
});

/* ── the script reaches the build context ────────────────────────────────────
   The first attempt at this failed CI: .dockerignore excluded `scripts`, so the
   file was never in the build context and COPY could not find it. A bare
   directory name prunes the directory, and a re-include of a file inside a
   pruned directory has no effect, so the glob form is required. */

test('the listener is not excluded from the build context', () => {
  const ignore = read('.dockerignore');
  assert.match(
    ignore,
    /^!scripts\/exit-on-fatal\.py$/m,
    'without this the COPY fails: the file is not in the build context',
  );
  assert.match(ignore, /^scripts\/\*\*$/m, 'a bare `scripts` prunes the directory and the re-include is ignored');
  assert.doesNotMatch(ignore, /^scripts$/m, 'the bare form would silently defeat the exception above it');
});

test('the exception comes after the exclusion it overrides', () => {
  /* Docker applies every pattern in order and the last match wins. */
  const lines = read('.dockerignore')
    .split('\n')
    .map(l => l.trim());
  const excluded = lines.indexOf('scripts/**');
  const included = lines.indexOf('!scripts/exit-on-fatal.py');
  assert.ok(excluded !== -1 && included !== -1);
  assert.ok(included > excluded, 'the exception must come last or it has no effect');
});

test('the rest of scripts/ is still kept out of the build context', () => {
  const ignore = read('.dockerignore');
  const exceptions = ignore.split('\n').filter(l => l.trim().startsWith('!scripts/'));
  assert.deepEqual(exceptions.map(l => l.trim()), ['!scripts/exit-on-fatal.py', '!scripts/bump-cache-busting.js']);
});

/* The stamping script runs in the first stage only. Copying it into the runtime
   image would ship build tooling to every user. */
test('only the supervisor listener reaches the runtime image', () => {
  const runtime = read('Dockerfile').split(/^FROM node:24-alpine$/m).pop();
  const copied = [...runtime.matchAll(/^COPY (?:--\S+ )*(scripts\/\S+)/gm)].map(m => m[1]);
  assert.deepEqual(copied, ['scripts/exit-on-fatal.py']);
});
