/* The environment table in docs/architecture.md against the code that reads it.

   Settings were spread across docs/security.md, docs/demo.md and commented
   lines in docker-compose.yml, and three (LOG_LEVEL, WIDGETS_PATH,
   APP_VERSION) were written down nowhere, so the only complete list was the
   source. A table fixes that once; this keeps it fixed, because a list of
   settings is exactly the kind of prose that goes stale the next time one is
   added.

   INTERNAL below is the escape hatch, and it needs a reason per entry: these
   are read by the entrypoint or by tests, not set by an operator, so listing
   them in an operator-facing table would be noise.

   Defaults are checked too, since a table naming the wrong default is worse
   than one naming none. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

/* Variables the code reads that an operator is not meant to set. */
const INTERNAL = {
  REALIP_CONF: 'entrypoint only: where the generated proxy config is written, overridable so the rendering can be tested',
  SUPERVISOR_FATAL_MARKER: 'internal handoff between the supervisord listener and the entrypoint',
};

function sourceFiles() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk('api/src');
  return out;
}

/* Every process.env read in the API. */
function envInCode() {
  const names = new Set();
  for (const f of sourceFiles()) {
    for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
  }
  return [...names].filter(n => !(n in INTERNAL)).sort();
}

const doc = read('docs/architecture.md');

function tableSection() {
  const at = doc.indexOf('## Environment');
  assert.notEqual(at, -1, 'the Environment section is gone from docs/architecture.md');
  return doc.slice(at, doc.indexOf('\n## ', at + 4));
}

/* [name, default] per row. The default column holds a code span for a literal
   and prose for anything else, so only a code span is compared. */
function documentedRows() {
  const rows = [...tableSection().matchAll(/^\| `([A-Z][A-Z0-9_]*)` \| (.*?) \| /gm)];
  return rows.map(m => [m[1], /^`([^`]+)`$/.exec(m[2].trim())?.[1] ?? null]);
}

test('the scan finds both sides', () => {
  assert.ok(envInCode().length >= 10, 'the env scan found suspiciously few variables');
  assert.ok(documentedRows().length >= 10, 'the environment table looks empty');
});

test('every environment variable the API reads is documented, and no others', () => {
  assert.deepEqual(documentedRows().map(r => r[0]).sort(), envInCode(),
    'the environment table in docs/architecture.md is out of date');
});

/* Each exemption states why, so the list cannot quietly become a dumping
   ground for anything that would otherwise fail the test above. */
test('every internal variable has a reason recorded', () => {
  for (const [name, why] of Object.entries(INTERNAL)) {
    assert.ok(why && why.length > 20, `${name} needs a reason for being exempt`);
  }
});

test('the documented defaults are the ones in the code', () => {
  const defaults = Object.fromEntries(documentedRows());
  const cases = [
    ['CONFIG_PATH', 'api/src/config.js', /process\.env\.CONFIG_PATH \|\| '([^']+)'/],
    ['ICONS_PATH', 'api/src/config.js', /process\.env\.ICONS_PATH\s*\|\|\s*'([^']+)'/],
    ['WIDGETS_PATH', 'api/src/widgets.js', /process\.env\.WIDGETS_PATH \|\| '([^']+)'/],
    ['PORT', 'api/src/server.js', /Number\.isNaN\(_port\) \? (\d+)/],
  ];
  for (const [name, file, re] of cases) {
    const m = re.exec(read(file));
    assert.ok(m, `the default for ${name} was not found in ${file}`);
    assert.equal(defaults[name], m[1], `${name} defaults to ${m[1]}`);
  }
});

test('the documented session and hash defaults match the code', () => {
  const defaults = Object.fromEntries(documentedRows());
  const auth = read('api/src/auth.js');
  assert.equal(defaults.SESSION_MAX_AGE_DAYS,
    /_maxAgeDays > 0 \? _maxAgeDays : (\d+)/.exec(auth)[1]);
  assert.equal(defaults.PASSWORD_HASH_MEMORY,
    /const DEFAULT_PROFILE = '([\w]+)'/.exec(auth)[1]);
});

/* The levels the logger accepts, not the narrower set the Settings screen
   offers, because this row is about the variable. */
test('the documented log levels are the ones the logger accepts', () => {
  const m = /const RANK = \{([^}]+)\}/.exec(read('api/src/log.js'));
  assert.ok(m, 'RANK not found in log.js');
  const levels = [...m[1].matchAll(/(\w+):/g)].map(x => x[1]);
  const row = /^\| `LOG_LEVEL` \|.*$/m.exec(tableSection())[0];
  for (const l of levels) {
    assert.match(row, new RegExp(`\`${l}\``), `LOG_LEVEL accepts ${l}`);
  }
});

/* The Compose file is where most people will set one, and the claim that it
   carries them all is easy to falsify by adding a variable and forgetting. */
test('docker-compose.yml carries every operator variable', () => {
  const compose = read('docker-compose.yml');
  /* Stamped by the release build, so there is nothing for an operator to set. */
  const missing = envInCode().filter(n => n !== 'APP_VERSION' && !compose.includes(n));
  assert.deepEqual(missing, [],
    `The table says docker-compose.yml lists them all. Add a commented line for:\n  ${missing.join('\n  ')}`);
});
