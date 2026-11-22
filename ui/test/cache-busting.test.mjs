/* Every asset reference carries a ?v= stamp that changes with the file's
   contents. A reference written without one is served from cache after an
   upgrade while every other file is refreshed, so the page runs mixed versions.

   The stamping script must therefore match a reference that lacks a stamp, not
   only one that already has it. This test is the same rule, so a failure is
   visible from the test suite rather than only from the build. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Matches the pattern in scripts/bump-cache-busting.js, with the stamp optional
   so an unstamped reference is found rather than skipped. */
const REF = /(["'])(\/(?:css|js)\/[a-zA-Z0-9_.-]+\.(?:css|js))(\?v=[0-9a-zA-Z]+)?/g;

function sources(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'test' && e.name !== 'node_modules') sources(rel, out);
    } else if (/\.(js|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const FILES = sources('.');

function references() {
  const all = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(src))) all.push({ file: f, asset: m[2], stamp: m[3] || null });
  }
  return all;
}

test('the scan finds the references it should', () => {
  const refs = references();
  assert.ok(refs.length > 50, `only found ${refs.length} asset references`);
});

/* The finding. */
test('every asset reference carries a version stamp', () => {
  const missing = references()
    .filter(r => !r.stamp)
    .map(r => `${r.file} -> ${r.asset}`);
  assert.deepEqual(
    missing,
    [],
    `these will never cache-bust:\n${missing.join('\n')}\nRun node scripts/bump-cache-busting.js and commit the result.`,
  );
});

test('every referenced asset exists', () => {
  const broken = references()
    .filter(r => !fs.existsSync(path.join(root, r.asset.slice(1))))
    .map(r => `${r.file} -> ${r.asset}`);
  assert.deepEqual(broken, [], `references to files that are not there:\n${broken.join('\n')}`);
});

/* The script is what keeps the stamps current, so it has to be able to see a
   reference that lacks one. Its pattern making the stamp optional is the fix;
   requiring it again is the bug. */
test('the build script can see an unstamped reference', () => {
  const script = fs.readFileSync(path.resolve(root, '../scripts/bump-cache-busting.js'), 'utf8');
  const line = /const REF_RE = (\/.*\/g);/.exec(script);
  assert.ok(line, 'REF_RE not found in the script');

  /* Evaluated as written rather than reconstructed, so this tests the pattern
     the script actually uses. */
  const pattern = (0, eval)(line[1]);
  for (const sample of ['import { x } from "/js/utils.js"', 'import { x } from "/js/utils.js?v=b81f6875"']) {
    pattern.lastIndex = 0;
    assert.ok(pattern.test(sample), `the script would skip: ${sample}`);
  }
});

/* A stamp naming content the file no longer has is the same failure as a
   missing one, so --check fails on a stale stamp rather than counting it. Run
   against a copy of the tree, since the script rewrites what it is pointed
   at. */
test('--check fails on a stamp that no longer matches its file', () => {
  const repo = path.resolve(root, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-stamp-'));
  try {
    for (const dir of ['ui', 'scripts', 'nginx']) {
      fs.cpSync(path.join(repo, dir), path.join(tmp, dir), { recursive: true });
    }
    const script = path.join(tmp, 'scripts', 'bump-cache-busting.js');
    const run = () => spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });

    assert.equal(run().status, 0, 'the committed tree should pass before it is broken');

    const index = path.join(tmp, 'ui', 'index.html');
    const before = fs.readFileSync(index, 'utf8');
    const broken = before.replace(/(\/css\/dashboard\.css\?v=)[0-9a-f]+/, '$1deadbeef');
    assert.notEqual(broken, before, 'the fixture reference was not found');
    fs.writeFileSync(index, broken);

    const r = run();
    assert.equal(r.status, 1, 'a stale stamp has to fail the check');
    assert.match(`${r.stdout}${r.stderr}`, /deadbeef/, 'the failure should name the stale reference');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* The checks moved into a composite action so the release build runs the same
   set as a pull request; see .github/actions/checks. Asserted there rather than
   in test.yml, which now just calls it. */
test('the check is wired into CI', () => {
  const action = fs.readFileSync(path.resolve(root, '../.github/actions/checks/action.yml'), 'utf8');
  assert.match(action, /bump-cache-busting\.js --check/, 'without this the check only runs when someone remembers to');
});

test('the workflows call the shared checks rather than listing their own', () => {
  for (const name of ['test.yml', 'release.yml']) {
    const workflow = fs.readFileSync(path.resolve(root, `../.github/workflows/${name}`), 'utf8');
    assert.match(workflow, /uses: \$\/\.github\/actions\/checks/, `${name} bypasses the shared checks`);
  }
});

/* The widget `?v=` is not manual. The release hashes each entry file into the
   manifest and widget-types.js reads it from there, so hand-editing one edits a
   value the build owns.

   Pinned by mechanism rather than by sentence: no widget URL carries a literal
   stamp, and the manifest is where the value comes from. */
test('the widget cache version comes from the manifest, not a hand-written literal', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-types.js'), 'utf8');
  assert.match(src, /entryVersions\?\.\[file\]/, 'widget-types.js no longer reads the manifest hash');
  const literal = /['"`]\/widgets\/[^'"`]*\?v=\d/.exec(src);
  assert.equal(literal, null, `a hand-written widget stamp is back: ${literal && literal[0]}`);
});

/* The widget page is cached for a year with its headers, so a policy change in
   nginx must produce a new stamp even when the page itself is unchanged. */
test('a change to the widget headers changes every widget stamp', () => {
  const repo = path.resolve(root, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-stamp-'));
  try {
    for (const dir of ['ui', 'scripts', 'nginx']) {
      fs.cpSync(path.join(repo, dir), path.join(tmp, dir), { recursive: true });
    }
    const script = path.join(tmp, 'scripts', 'bump-cache-busting.js');
    const manifest = path.join(tmp, 'ui', 'widgets', 'clock', 'widget.json');
    const stamp = () => {
      assert.equal(spawnSync(process.execPath, [script, '--release'], { encoding: 'utf8' }).status, 0);
      return JSON.parse(fs.readFileSync(manifest, 'utf8')).entryVersions;
    };

    const before = stamp();
    const conf = path.join(tmp, 'nginx', 'dashboard.conf');
    fs.writeFileSync(conf, fs.readFileSync(conf, 'utf8').replace("frame-ancestors 'self';", "frame-ancestors 'none';"));
    const after = stamp();

    assert.ok(Object.keys(before).length, 'the clock manifest was not stamped');
    for (const file of Object.keys(before)) assert.notEqual(after[file], before[file], file);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* A copy of the tree, since write mode rewrites what it is pointed at. */
function withTreeCopy(fn) {
  const repo = path.resolve(root, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-stamp-'));
  try {
    for (const dir of ['ui', 'scripts', 'nginx', 'docs/widget-template']) {
      fs.cpSync(path.join(repo, dir), path.join(tmp, dir), { recursive: true });
    }
    const script = path.join(tmp, 'scripts', 'bump-cache-busting.js');
    fn({ tmp, run: (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }) });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function manifests(tmp) {
  const dir = path.join(tmp, 'ui', 'widgets');
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name, 'widget.json');
    if (e.isDirectory() && fs.existsSync(file)) out[e.name] = fs.readFileSync(file, 'utf8');
  }
  return out;
}

test('write mode stamps references and leaves the widget manifests alone', () => {
  withTreeCopy(({ tmp, run }) => {
    const before = manifests(tmp);
    assert.ok(Object.keys(before).length > 5, 'no widget manifests were copied');

    const index = path.join(tmp, 'ui', 'index.html');
    const unstamped = fs.readFileSync(index, 'utf8').replace(/(\/css\/dashboard\.css)\?v=[0-9a-f]+/, '$1');
    fs.writeFileSync(index, unstamped);

    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(manifests(tmp), before, 'write mode changed a widget manifest');
    assert.match(fs.readFileSync(index, 'utf8'), /\/css\/dashboard\.css\?v=[0-9a-f]{8}/);
    assert.equal(run('--check').status, 0, 'the tree write mode leaves must pass the check');
  });
});

test('write mode reports the stamps it added, not missing stamps', () => {
  withTreeCopy(({ tmp, run }) => {
    const index = path.join(tmp, 'ui', 'index.html');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/(\/css\/dashboard\.css)\?v=[0-9a-f]+/, '$1'));
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const out = `${r.stdout}${r.stderr}`;
    assert.doesNotMatch(out, /had no \?v= stamp/);
    assert.match(r.stdout, /added a \?v= stamp to 1 reference\(s\)/);
    assert.match(r.stdout, /ui\/index\.html references \/css\/dashboard\.css/);
    assert.equal(r.stderr, '');
  });
});

test('--release writes entryVersions into every widget manifest', () => {
  withTreeCopy(({ tmp, run }) => {
    const r = run('--release');
    assert.equal(r.status, 0, r.stderr);
    for (const [name, text] of Object.entries(manifests(tmp))) {
      const versions = JSON.parse(text).entryVersions;
      assert.ok(versions && Object.keys(versions).length, `${name} was not stamped`);
      for (const v of Object.values(versions)) assert.match(v, /^[0-9a-f]{8}$/, name);
    }
  });
});

test('--check writes nothing, even with --release', () => {
  withTreeCopy(({ tmp, run }) => {
    const index = path.join(tmp, 'ui', 'index.html');
    const broken = fs.readFileSync(index, 'utf8').replace(/(\/css\/dashboard\.css)\?v=[0-9a-f]+/, '$1');
    fs.writeFileSync(index, broken);
    const before = manifests(tmp);

    const r = run('--check', '--release');
    assert.equal(r.status, 1, 'an unstamped reference has to fail the check');
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /\?v=1\b/, 'the hint must not suggest a stamp the check rejects');
    assert.equal(fs.readFileSync(index, 'utf8'), broken);
    assert.deepEqual(manifests(tmp), before);
  });
});

test('the widget template carries current stamps', () => {
  withTreeCopy(({ tmp, run }) => {
    const page = path.join(tmp, 'docs', 'widget-template', 'widget.js');
    const src = fs.readFileSync(page, 'utf8');
    assert.match(src, /\/js\/widget-toolbox\.js\?v=[0-9a-f]{8}/);
    fs.writeFileSync(
      page,
      src.replace(/(\/js\/widget-toolbox\.js\?v=)[0-9a-f]+/, (_m, ref) => `${ref}1`),
    );
    const r = run('--check');
    assert.equal(r.status, 1, 'a stale template stamp has to fail the check');
    assert.match(r.stderr, /docs\/widget-template\/widget\.js references \/js\/widget-toolbox\.js\?v=1,/);
  });
});

/* A widget page is cached for a year under a stamp of its own text. Its script
   is a separate file, so the page has to name the script's content. */
test('--check fails when a widget page script changes and its page does not', () => {
  withTreeCopy(({ tmp, run }) => {
    const script = path.join(tmp, 'ui', 'widgets', 'dns', 'widget.js');
    fs.appendFileSync(script, '\n');
    const r = run('--check');
    assert.equal(r.status, 1, 'a stale page script stamp has to fail the check');
    assert.match(r.stderr, /ui\/widgets\/dns\/index\.html references widget\.js\?v=[0-9a-f]{8}, but its content is/);
  });
});

test('write mode stamps a widget page script and the check then passes', () => {
  withTreeCopy(({ tmp, run }) => {
    const page = path.join(tmp, 'ui', 'widgets', 'clock', 'analog.html');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(/src="analog\.js\?v=[0-9a-f]+"/, 'src="analog.js"'));
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ui\/widgets\/clock\/analog\.html references analog\.js/);
    assert.match(fs.readFileSync(page, 'utf8'), /<script src="analog\.js\?v=[0-9a-f]{8}"><\/script>/);
    assert.equal(run('--check').status, 0);
  });
});

test('a change to a widget page script changes that page stamp', () => {
  withTreeCopy(({ tmp, run }) => {
    const manifest = path.join(tmp, 'ui', 'widgets', 'github', 'widget.json');
    const stamp = () => {
      assert.equal(run('--release').status, 0);
      return JSON.parse(fs.readFileSync(manifest, 'utf8')).entryVersions;
    };
    const before = stamp();
    fs.appendFileSync(path.join(tmp, 'ui', 'widgets', 'github', 'pullrequests.js'), '\n');
    const after = stamp();
    assert.notEqual(after['pullrequests.html'], before['pullrequests.html']);
    assert.equal(after['contributions.html'], before['contributions.html']);
  });
});

/* A copied template is a widget of someone's own. Its page is not stamped, so
   a stamp on its script would only go stale. */
test('the widget template loads its script without a stamp', () => {
  withTreeCopy(({ tmp, run }) => {
    const page = path.join(tmp, 'docs', 'widget-template', 'index.html');
    const before = fs.readFileSync(page, 'utf8');
    assert.match(before, /src="widget\.js"/);
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(page, 'utf8'), before);
  });
});
