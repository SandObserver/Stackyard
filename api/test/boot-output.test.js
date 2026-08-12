/* What the container prints at boot.

   Spawned as a real child process rather than by requiring server.js. The
   banner goes out through log.print, which bypasses level filtering and the
   logfmt shape; the server starts listening on require; and both TRUST_PROXY
   branches are decided once inside the listen callback. Reading the real
   process output is the only way to assert on any of that. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { tmpDir } = require('../test-support/tmp');

const SERVER = path.join(__dirname, '../src/server.js');

/* Two widgets, so the count the banner prints is one this test controls rather
   than however many ship in the image. */
function widgetsDir() {
  const dir = tmpDir('boot-widgets');
  for (const name of ['alpha', 'beta']) {
    const d = path.join(dir, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'widget.json'),
      JSON.stringify({
        name,
        label: name,
        sizes: ['medium'],
        views: { main: { src: 'index.html' } },
      }),
    );
    fs.writeFileSync(path.join(d, 'index.html'), '');
  }
  return dir;
}

async function freePort() {
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise(r => srv.close(r));
  return port;
}

/* Runs the server until it reports readiness, gives the warnings that follow in
   the same callback a moment to flush, then stops it. */
async function boot(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(await freePort()),
      CONFIG_PATH: path.join(tmpDir('boot-config'), 'apps.json'),
      WIDGETS_PATH: widgetsDir(),
      APP_VERSION: '9.9.9',
      LOG_LEVEL: 'info',
      TRUST_PROXY: '',
      TRUSTED_PROXY: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`never reported ready:\n${out}`)), 15000);
      child.stdout.on('data', () => {
        if (!out.includes('server ready')) return;
        clearTimeout(timer);
        setTimeout(resolve, 100);
      });
      child.on('exit', code => {
        clearTimeout(timer);
        reject(new Error(`exited with ${code}:\n${out}`));
      });
    });
  } finally {
    child.kill('SIGKILL');
  }
  return out;
}

const trustWarnings = out => out.split('\n').filter(l => l.includes('WRN') && l.includes('TRUST_PROXY'));

test('the banner names the port the container listens on, not the API port', async () => {
  const out = await boot();
  assert.ok(!out.includes('http://localhost'), 'the guessed URL reached nobody and must be gone');
  assert.match(out, /Dashboard {2}:80 in the container/);
});

test('the banner prints the version without a v prefix and without box drawing', async () => {
  const out = await boot();
  assert.match(out, /Stackyard 9\.9\.9 · Node v/);
  assert.ok(!out.includes('v9.9.9'), 'APP_VERSION defaults to "dev", so a v prefix renders "vdev"');
  for (const ch of ['┌', '┐', '└', '┘', '│', '─', '➜']) {
    assert.ok(!out.includes(ch), `box drawing misaligns in narrow terminals: found ${ch}`);
  }
});

test('the banner lines up its labels and drops the truncated widget sample', async () => {
  const out = await boot();
  assert.match(out, /^ {2}Config {5}\S/m);
  assert.match(out, /^ {2}Icons {6}\S/m);
  assert.match(out, /^ {2}Widgets {4}2 loaded$/m);
});

test('one structured readiness record follows the banner', async () => {
  const out = await boot();
  const ready = out.split('\n').filter(l => l.includes('msg="server ready"'));
  assert.equal(ready.length, 1, 'exactly one readiness record');
  assert.match(ready[0], /INF msg="server ready" version=9\.9\.9 port=\d+ widgets=2 node=v/);
});

test('the widget registry inventory is not printed at the default level', async () => {
  const out = await boot();
  assert.ok(!out.includes('widget registry loaded'), 'the count is already in the banner');
});

test('the widget registry inventory is still available at debug', async () => {
  const out = await boot({ LOG_LEVEL: 'debug' });
  assert.match(out, /DBG msg="widget registry loaded"/);
  assert.ok(out.includes('alpha'), 'the names are the reason to turn debug on');
});

test('TRUST_PROXY with TRUSTED_PROXY set warns exactly once', async () => {
  const out = await boot({ TRUST_PROXY: 'true', TRUSTED_PROXY: '10.0.0.0/8' });
  const w = trustWarnings(out);
  assert.equal(w.length, 1, `one warning, got ${w.length}: ${w.join(' | ')}`);
  assert.match(w[0], /forwarded headers are trusted/);
});

test('TRUST_PROXY without TRUSTED_PROXY warns exactly once, naming the fix', async () => {
  const out = await boot({ TRUST_PROXY: 'true' });
  const w = trustWarnings(out);
  assert.equal(w.length, 1, `one warning, got ${w.length}: ${w.join(' | ')}`);
  assert.match(w[0], /set TRUSTED_PROXY to the proxy address/);
});

test('a correctly configured boot warns about neither', async () => {
  const out = await boot();
  assert.deepEqual(trustWarnings(out), []);
});
