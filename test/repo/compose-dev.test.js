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
  assert.equal(dev.network_mode, undefined);
  assert.equal(dev.env_file, undefined);
});

/* The data holds stored secrets and corrupt-config backups. A named volume is
   outside the working tree and belongs to the node account from creation. */
test('dev data lives in named volumes', () => {
  assert.equal(dev.volumes.length, 2);
  for (const v of dev.volumes) assert.doesNotMatch(v, /^[./]/, `${v} is a bind mount`);
});

/* Earlier dev setups kept stored secrets in .dev/. */
test('old dev data stays out of git and the build context', () => {
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
const stages = read('Dockerfile').split(/^FROM /m);
const devStage = stages.find(st => /^runtime AS dev$/m.test(st.split('\n')[0])) || '';

test('the dev Compose file builds the dev stage', () => {
  assert.equal(dev.build.target, 'dev');
  assert.ok(devStage, 'no dev stage in the Dockerfile');
});

/* A build without a target ships the last stage. */
test('the published image is the last stage', () => {
  assert.equal(stages.at(-1).trim(), 'runtime', 'the last stage changes the published image');
  assert.match(read('Dockerfile'), /^FROM scratch AS runtime$/m);
});

test('the dev cache rewrite matches every long-lived cache line in nginx', () => {
  const [, from, to] = /sed -i 's\/([^/]+)\/([^/]*)\/' \/etc\/nginx\/http\.d\/dashboard\.conf/.exec(devStage) || [];
  assert.ok(from, 'no sed substitution in the dev stage');
  assert.equal(to, 'no-cache');
  const lines = read('nginx/dashboard.conf')
    .split('\n')
    .filter(l => /max-age=\d{5,}/.test(l));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(l.includes(from), `not rewritten in dev: ${l.trim()}`);
});

/* The container runs as node, and watch deletes a synced file as that account. */
test('every folder the dev watch syncs into belongs to node in the dev stage', () => {
  const [, owned] = /chown -R node:node ([^\n\\]+)/.exec(devStage) || [];
  assert.ok(owned, 'the dev stage hands nothing to node');
  const dirs = owned.trim().split(/\s+/);
  for (const w of dev.develop.watch.filter(rule => rule.action.startsWith('sync'))) {
    assert.ok(
      dirs.some(d => w.target === d || w.target.startsWith(`${d}/`)),
      `${w.target} is not handed to node`,
    );
  }
  assert.match(devStage, /^USER node$/m);
});

/* Compose skips any watched path that .dockerignore excludes, with no warning. */
test('no watched path is excluded by .dockerignore', () => {
  const toRegex = glob =>
    new RegExp(
      `^${glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\0')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\0/g, '.*')}$`,
    );
  const patterns = read('.dockerignore')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => ({ keep: l.startsWith('!'), re: toRegex(l.replace(/^!/, '')) }));
  for (const { path: watched } of dev.develop.watch) {
    const parts = watched.replace(/^\.\//, '').split('/');
    const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    let excluded = false;
    for (const { keep, re } of patterns) if (prefixes.some(p => re.test(p))) excluded = !keep;
    assert.equal(excluded, false, `${watched} is excluded by .dockerignore`);
  }
});
