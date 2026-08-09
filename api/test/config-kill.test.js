/* The config write, interrupted for real.

   config-durability.test.js pins the calls that make a write survive a power
   cut: temp file, fsync, rename, fsync the directory. It cannot show that the
   sequence works, because it never stops the process partway through.

   This does. A child process saves a large config in a loop; the parent kills
   it with SIGKILL, which cannot be caught, deferred or cleaned up after, at a
   randomised moment; the parent then reads what is on disk. The rule the write
   exists to guarantee is that a reader never sees a partial config: whatever
   survives must parse, and must be a config, every time.

   SIGKILL mid-write is the closest a test gets to the case this protects
   against, which is a Pi on an SD card being unplugged. It is not the same
   thing: the kernel still has the page cache, so this proves atomicity of the
   rename rather than durability of the bytes. Durability is what fsync buys and
   nothing in a test can observe it.

   Deliberately slower than the rest of the suite. It runs a handful of
   iterations rather than dozens, and the delays are spread across the range
   where a write is likely to be in flight.

   Whether a given kill lands inside a write or between two of them is not
   controllable, and measuring it beforehand put it at roughly one iteration in
   five. A leftover .tmp is the evidence that one did, so each iteration reports
   whether it interrupted a write. That count is not asserted on: an assertion
   that depends on timing would be retried until it passed, which is worse than
   not having it. The assertion that does hold on every iteration, interrupted
   or not, is that the config on disk is complete. */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir } = require('../test-support/tmp');

const LOOP = path.join(__dirname, '..', 'test-support', 'save-loop.js');
const APPS = 300; /* about 155 KB, a large real dashboard */
const ITERATIONS = 8;

/* Spread across the window where a write is in flight. Fixed rather than
   random, so a failure is reproducible: a flaky durability test is worse than
   none, because it gets retried until it passes. */
const DELAYS_MS = [12, 19, 27, 34, 41, 55, 68, 83];

function runAndKill(configPath, delayMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LOOP, configPath, String(APPS)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false,
      stderr = '';
    child.stderr.on('data', c => {
      stderr += c;
    });
    child.stdout.on('data', c => {
      if (ready || !String(c).includes('ready')) return;
      ready = true;
      /* Only start interrupting once one complete file exists, so a failure
         means a write was corrupted rather than never finished. */
      setTimeout(() => child.kill('SIGKILL'), delayMs);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (!ready) return reject(new Error(`child never became ready (code ${code}, signal ${signal}): ${stderr}`));
      resolve({ signal, stderr });
    });
  });
}

function readConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return { raw, parsed: JSON.parse(raw) };
}

test('a config killed mid-write is never left partial', async t => {
  const dir = tmpDir('config-kill');
  const configPath = path.join(dir, 'apps.json');

  let interrupted = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const delay = DELAYS_MS[i % DELAYS_MS.length];
    const { signal } = await runAndKill(configPath, delay);
    assert.equal(signal, 'SIGKILL', `iteration ${i} exited on its own instead of being killed`);

    assert.ok(fs.existsSync(configPath), `iteration ${i}: the config is gone entirely`);

    /* The whole point: whatever a reader finds must be complete. A truncated
       write would throw here. */
    let parsed;
    try {
      ({ parsed } = readConfig(configPath));
    } catch (e) {
      const size = fs.statSync(configPath).size;
      assert.fail(`iteration ${i}, killed after ${delay}ms: the config did not parse (${size} bytes): ${e.message}`);
    }

    assert.equal(Array.isArray(parsed.items), true, `iteration ${i}: items is not a list`);
    assert.equal(parsed.items.length, APPS, `iteration ${i}: the config is complete but short`);
    assert.equal(parsed.items.at(-1).id, `app_${APPS - 1}`, `iteration ${i}: the last item is truncated`);
    assert.ok(Number.isInteger(parsed._rev), `iteration ${i}: no revision`);
    /* A temp file means the kill landed between opening it and the rename,
       which is the case worth hitting. */
    const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    if (leftovers.length) interrupted++;
    for (const f of leftovers) fs.unlinkSync(path.join(dir, f));

    t.diagnostic(
      `killed after ${delay}ms, generation ${parsed.settings.generation}, ` +
        `${fs.statSync(configPath).size} bytes, ${leftovers.length ? 'mid-write' : 'between writes'}`,
    );
  }
  t.diagnostic(`${interrupted} of ${ITERATIONS} kills landed inside a write`);
});

test('a temp file left by a killed write does not shadow the config', async () => {
  /* The write renames into place, so an interrupted one leaves its temp file
     behind. That is untidy, not dangerous, and the next successful save
     overwrites it: what matters is that the real config is still the one a
     reader gets. */
  const dir = tmpDir('config-kill-tmp');
  const configPath = path.join(dir, 'apps.json');
  await runAndKill(configPath, 20);

  const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  const { parsed } = readConfig(configPath);
  assert.equal(parsed.items.length, APPS, `the config is not intact, with ${leftovers.length} temp file(s) present`);

  /* And loading through the real reader agrees, temp file or not. */
  const previous = process.env.CONFIG_PATH;
  process.env.CONFIG_PATH = configPath;
  try {
    delete require.cache[require.resolve('../src/config')];
    const { loadConfig } = require('../src/config');
    assert.equal(loadConfig().items.length, APPS);
  } finally {
    if (previous === undefined) delete process.env.CONFIG_PATH;
    else process.env.CONFIG_PATH = previous;
    delete require.cache[require.resolve('../src/config')];
  }
});
