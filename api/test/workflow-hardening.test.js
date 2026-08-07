/* P17-5 and P17-10: how much a workflow is trusted with, and what it runs.

   test.yml declared no permissions, and this repository's default is write, so
   a job that runs npm install and docker build had a token that could push to
   the repository. Dependency code executes in that job. It needs to read the
   tree and nothing else. codeql.yml and release.yml were already scoped; this
   one had been missed.

   Every third-party action was pinned to a moving tag. actions/checkout@v4 is
   whatever commit that tag points at today, so a retagged or compromised
   release runs with whatever the job grants, before any of our own code. They
   are pinned to a commit now, with the version in a trailing comment.

   Dependabot already watches github-actions weekly and understands SHA pins, so
   these stay current without hand-editing; that is what makes pinning viable
   here rather than a slow rot.

   Read as text rather than parsed: no YAML dependency, and enough to pin the
   properties that matter. GitHub is the only thing that truly validates a
   workflow. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const wfDir = path.join(root, '.github', 'workflows');
const actionsDir = path.join(root, '.github', 'actions');

const workflows = fs.readdirSync(wfDir).filter(f => f.endsWith('.yml'))
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
  const missing = workflows.filter(([, s]) => !/^permissions:/m.test(s) && !/^\s+permissions:/m.test(s))
    .map(([f]) => f);
  assert.deepEqual(missing, [],
    `These inherit the repository default, which is write:\n  ${missing.join('\n  ')}`);
});

test('the test workflow can only read', () => {
  const [, src] = workflows.find(([f]) => f.endsWith('test.yml'));
  const block = src.slice(src.indexOf('permissions:'));
  assert.match(block, /contents: read/);
  assert.ok(!/write/.test(block.split('jobs:')[0]),
    'the test workflow must not grant any write scope');
});

/* Only the release publishes, and only to the package registry. */
test('no workflow grants a write scope it does not need', () => {
  const allowed = {
    'workflows/release.yml': ['packages: write'],
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
  assert.deepEqual(unpinned, [],
    `Pin to a full commit SHA with the version in a trailing comment:\n  ${unpinned.join('\n  ')}`);
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
  assert.match(cfg, /package-ecosystem:\s*github-actions/,
    'pinned SHAs need Dependabot to update them');
});
