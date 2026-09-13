const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const compose = read('docker-compose.yml');

/* Variables the code reads that an operator is not meant to set. */
const INTERNAL = {
  REALIP_CONF:
    'entrypoint only: where the generated proxy config is written, overridable so the rendering can be tested',
  SUPERVISOR_FATAL_MARKER: 'internal handoff between the supervisord listener and the entrypoint',
};

function envInCode() {
  const names = new Set();
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        for (const m of read(p).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
      }
    }
  };
  walk('api/src');
  return [...names].filter(n => !(n in INTERNAL)).sort();
}

test('every internal variable has a reason recorded', () => {
  for (const [name, why] of Object.entries(INTERNAL)) {
    assert.ok(why && why.length > 20, `${name} needs a reason for being exempt`);
  }
});

test('docker-compose.yml carries every operator variable', () => {
  assert.ok(envInCode().length >= 10, 'the env scan found suspiciously few variables');
  /* Stamped by the release build. There is nothing for an operator to set. */
  const missing = envInCode().filter(n => n !== 'APP_VERSION' && !compose.includes(n));
  assert.deepEqual(missing, [], `Add a commented line to docker-compose.yml for:\n  ${missing.join('\n  ')}`);
});

/* The one setting in the example that turns a security control off. */
test('the Compose example says what turning off the SSRF guard costs', () => {
  const at = compose.indexOf('ALLOW_PRIVATE_IPS');
  assert.ok(at !== -1, 'the flag is no longer in the Compose example');
  const comment = compose.slice(0, at).split('\n').slice(-4).join('\n');
  assert.match(comment, /SSRF guard/, 'the comment must name the guard it disables');
  assert.match(comment, /stackyard\.sandobserver\.com\/docs\/security\//, 'and link the page that explains it');
  assert.match(
    compose,
    /^\s*- ALLOW_PRIVATE_IPS=\$\{ALLOW_PRIVATE_IPS:-\}$/m,
    'it must default to empty, so the guard is on until an operator sets it',
  );
});

/* A hardcoded value ignores what a Docker UI's environment editor sets. */
test('the Compose file substitutes each operator setting it activates', () => {
  const active = [...compose.matchAll(/^\s*- ([A-Z_]+)=(.*)$/gm)].filter(m => !m[1].startsWith('#'));
  const literal = active.filter(m => !new RegExp(`^\\$\\{${m[1]}:-.*\\}$`).test(m[2])).map(m => m[1]);
  assert.deepEqual(literal, [], `Use \${NAME:-} for:\n  ${literal.join('\n  ')}`);
});

test('the Compose hardening is in place', () => {
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.ok(!/^\s*user:/m.test(compose), 'the Compose file now sets a user');
  assert.match(read('supervisord.conf'), /^user=node$/m, 'the API should run as node');
});
