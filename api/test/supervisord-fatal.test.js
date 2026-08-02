/* Regression tests for P16-7: a dead API left the container running.

   supervisord restarts a program that stops, but gives up after startretries and
   marks it FATAL. It then keeps running, because the other program is still
   alive, so the container stayed up with no API behind it and never recovered.

   Docker's healthcheck does notice, since /health is proxied to the API, but
   "unhealthy" is only a label: `restart: unless-stopped` restarts a container
   that exits, not one that is merely unhealthy. So the dashboard was down, the
   container looked like it was running, and nothing brought it back until
   someone noticed.

   PR6 made the API exit non-zero on a fatal error. This is the other half:
   supervisord acting on it.

   The listener's behaviour was verified by running supervisord against a program
   that cannot start; these tests pin the wiring, which is what would silently
   come apart. */

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
  assert.match(supervisord, /^events=PROCESS_STATE_FATAL$/m,
    'without this event the listener never hears about a program giving up');
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
  assert.equal(inListener[1], inEntrypoint[1].trim(),
    'the two must agree or the failure never reaches the exit code');
});

test('the entrypoint exits non-zero when the marker is present', () => {
  assert.match(entrypoint, /if \[ -f "\$MARKER" \]/);
  assert.match(entrypoint, /exit 1/);
});

test('the marker is cleared at startup and after being read', () => {
  /* A marker left behind would fail every subsequent start. */
  assert.ok((entrypoint.match(/rm -f "\$MARKER"/g) || []).length >= 2,
    'the marker must be cleared before running and after reading it');
});

/* ── shutdown still works ─────────────────────────────────────────────────── */

/* The entrypoint cannot exec supervisord any more, since it has to survive to
   read the marker. That means signals no longer reach supervisord on their own:
   without forwarding, a `docker stop` would kill the shell and leave supervisord
   running until the kill timeout, with nothing shut down cleanly. */
test('signals are forwarded to supervisord', () => {
  assert.match(entrypoint, /trap '[^']*kill -TERM "\$child"[^']*' TERM INT/,
    'docker stop would otherwise not reach supervisord');
  assert.match(entrypoint, /wait "\$child"/);
});

test('the entrypoint reports the real exit code when nothing failed', () => {
  assert.match(entrypoint, /exit "\$status"/,
    'an ordinary shutdown must not be reported as a failure');
});

/* ── the image ships what the config names ────────────────────────────────── */

test('the listener script is copied into the image at the path the config uses', () => {
  const m = /^command=(\S+) (\S+)$/m.exec(supervisord.slice(supervisord.indexOf('[eventlistener:exit-on-fatal]')));
  assert.ok(m, 'the listener has no command');
  const [, interpreter, script] = m;
  assert.ok(dockerfile.includes(`${script}`), `${script} is not copied into the image`);
  assert.ok(dockerfile.includes(interpreter),
    `${interpreter} is never asserted to exist, so the listener could fail to start silently`);
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
