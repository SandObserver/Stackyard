const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const wfDir = path.join(root, '.github', 'workflows');
const actionsDir = path.join(root, '.github', 'actions');

const workflows = fs
  .readdirSync(wfDir)
  .filter(f => f.endsWith('.yml'))
  .map(f => [`workflows/${f}`, fs.readFileSync(path.join(wfDir, f), 'utf8')]);

function compositeActions() {
  const out = [];
  if (!fs.existsSync(actionsDir)) return out;
  for (const d of fs.readdirSync(actionsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(actionsDir, d.name, 'action.yml');
    if (fs.existsSync(p)) out.push([`actions/${d.name}`, fs.readFileSync(p, 'utf8')]);
  }
  return out;
}

const all = [...workflows, ...compositeActions()];

test('the scan finds the workflows', () => {
  assert.ok(workflows.length >= 3, `only ${workflows.length} workflows found`);
  assert.ok(compositeActions().length >= 1, 'the shared checks action should be found');
});

/* A workflow with no permissions block inherits the repository default, which
   here is write. */
test('every workflow declares its permissions', () => {
  const missing = workflows
    .filter(([, s]) => !/^permissions:/m.test(s) && !/^\s+permissions:/m.test(s))
    .map(([f]) => f);
  assert.deepEqual(missing, [], `These inherit the repository default, which is write:\n  ${missing.join('\n  ')}`);
});

test('the test workflow can only read', () => {
  const [, src] = workflows.find(([f]) => f.endsWith('test.yml'));
  const block = src.slice(src.indexOf('permissions:'));
  assert.match(block, /contents: read/);
  assert.ok(!/write/.test(block.split('jobs:')[0]), 'the test workflow must not grant any write scope');
});

/* Only the release publishes, and only to the package registry. */
test('no workflow grants a write scope it does not need', () => {
  /* id-token: write is not a write scope over anything in the repository. It
     lets the job mint a short-lived OIDC token, which is what cosign exchanges
     for a Sigstore certificate when it signs the released image. Keyless
     signing needs it, and it is the reason there is no private key to hold. */
  const allowed = {
    'workflows/release.yml': ['packages: write', 'id-token: write'],
    'workflows/codeql.yml': ['security-events: write'],
  };
  const bad = [];
  for (const [f, src] of workflows) {
    for (const m of src.matchAll(/^\s*([\w-]+): write$/gm)) {
      const scope = `${m[1]}: write`;
      if (!(allowed[f] || []).includes(scope)) bad.push(`${f}: ${scope}`);
    }
  }
  assert.deepEqual(bad, [], `Unexpected write scope:\n  ${bad.join('\n  ')}`);
});

/* The supply-chain half. A tag can be moved; a commit cannot. */
test('every third-party action is pinned to a commit', () => {
  const unpinned = [];
  for (const [f, src] of all) {
    for (const m of src.matchAll(/uses:\s*(\S+)/g)) {
      const ref = m[1];
      if (ref.startsWith('./')) continue; /* our own composite action */
      const at = ref.lastIndexOf('@');
      const rev = at === -1 ? '' : ref.slice(at + 1);
      if (!/^[0-9a-f]{40}$/.test(rev)) unpinned.push(`${f}: ${ref}`);
    }
  }
  assert.deepEqual(
    unpinned,
    [],
    `Pin to a full commit SHA with the version in a trailing comment:\n  ${unpinned.join('\n  ')}`,
  );
});

/* A bare SHA is unreadable, and a reviewer cannot tell v4 from v7. */
test('every pin says which version it is', () => {
  const bare = [];
  for (const [f, src] of all) {
    for (const line of src.split('\n')) {
      if (!/uses:\s*\S+@[0-9a-f]{40}/.test(line)) continue;
      if (!/#\s*v?[\w.]+/.test(line)) bare.push(`${f}: ${line.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(bare, [], `Add "# vX.Y.Z" after the SHA:\n  ${bare.join('\n  ')}`);
});

/* Nothing pushes with the checkout token: the release authenticates to the
   registry separately. Leaving it in the runner's git config is a credential
   sitting where later steps, including dependency code, can reach it. */
test('checkout does not leave its credentials behind', () => {
  const leaky = [];
  for (const [f, src] of workflows) {
    const parts = src.split(/uses:\s*actions\/checkout@/).slice(1);
    for (const p of parts) {
      const next = p.split(/\n\s*- name:/)[0];
      if (!/persist-credentials:\s*false/.test(next)) leaky.push(f);
    }
  }
  assert.deepEqual(leaky, [], `Add "persist-credentials: false":\n  ${leaky.join('\n  ')}`);
});

/* Dependabot is what keeps the pins current. Without it they would freeze at
   whatever was current the day they were written. */
test('dependabot watches the actions', () => {
  const cfg = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');
  assert.match(cfg, /package-ecosystem:\s*github-actions/, 'pinned SHAs need Dependabot to update them');
});

/* Dependency code runs in these jobs, and the release build publishes what they
   pass. `npm install` re-resolves every range on each run, so what the checks
   ran against was never quite what the last run saw. `npm ci` installs the
   committed lockfile exactly, and fails outright if the two files disagree. */
test('the lockfile is committed and CI installs from it', () => {
  const lock = path.join(root, 'package-lock.json');
  assert.ok(fs.existsSync(lock), 'package-lock.json is missing');
  assert.ok(
    !/^\s*package-lock\.json\s*$/m.test(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')),
    '.gitignore excludes the lockfile, so npm ci has nothing to install from',
  );

  const loose = [];
  for (const [f, src] of all) {
    for (const line of src.split('\n')) {
      if (/run:\s*npm install\b/.test(line)) loose.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(loose, [], `Use npm ci so CI installs the lockfile:\n  ${loose.join('\n  ')}`);
});
