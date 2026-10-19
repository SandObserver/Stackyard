const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const dev = yaml.load(read('docker-compose.dev.yml')).services.stackyard;
const prod = yaml.load(read('docker-compose.yml')).services.stackyard;

/* A fresh instance has no password and answers any request by IP. */
test('the dev instance listens on this computer only', () => {
  assert.ok(dev.ports.length > 0);
  for (const port of dev.ports) assert.match(port, /^127\.0\.0\.1:\d+:80$/, `${port} is reachable from other devices`);
});

test('the dev instance keeps the production limits', () => {
  for (const key of [
    'cap_drop',
    'cap_add',
    'security_opt',
    'privileged',
    'mem_limit',
    'mem_reservation',
    'memswap_limit',
    'cpus',
    'pids_limit',
    'init',
  ]) {
    assert.deepEqual(dev[key], prod[key], `${key} differs from docker-compose.yml`);
  }
});

test('the dev instance turns no guard off and gets no Docker socket', () => {
  const env = (dev.environment || []).join('\n');
  assert.doesNotMatch(env, /ALLOW_PRIVATE_IPS|SOCKET_PROXY_URL|TRUST_PROXY|DEMO_MODE/);
  for (const v of dev.volumes) assert.doesNotMatch(v, /docker\.sock/);
});

/* The data folder holds stored secrets and corrupt-config backups. */
test('dev data stays out of git and the build context', () => {
  for (const v of dev.volumes) assert.match(v, /^\.\/\.dev\//, `${v} is outside .dev/`);
  assert.match(read('.gitignore'), /^\/\.dev\/$/m);
  assert.match(read('.dockerignore'), /^\.dev$/m);
});

/* Otherwise an edit to a shared module never reaches the API. */
test('every module the API shares with the UI is watched', () => {
  const rules = dev.develop.watch;
  const shared = [...read('Dockerfile').matchAll(/^COPY (ui\/js\/\S+) (\/app\/\S+)$/gm)];
  assert.ok(shared.length > 0, 'the Dockerfile scan found no shared modules');
  for (const [, src, dst] of shared) {
    const rule = rules.find(r => r.path === `./${src}`);
    assert.ok(rule, `${src} has no watch rule`);
    assert.equal(rule.target, dst);
    assert.equal(rule.action, 'sync+restart');
  }
});

/* The rewrite fails silently. A changed cache line would serve stale files. */
test('the dev cache rewrite matches every long-lived cache line in nginx', () => {
  const script = dev.entrypoint.find(a => a.startsWith('sed '));
  const from = /s\/([^/]+)\//.exec(script)?.[1];
  assert.ok(from, 'no sed substitution in the dev entrypoint');
  const lines = read('nginx/dashboard.conf')
    .split('\n')
    .filter(l => /max-age=\d{5,}/.test(l));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(l.includes(from), `not rewritten in dev: ${l.trim()}`);
});
