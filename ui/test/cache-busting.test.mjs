/* Regression tests for P17-9: an unstamped asset reference stayed unstamped.

   Browsers cache JavaScript and CSS, so each reference carries a ?v= stamp that
   changes with the file's contents. The script that maintains those stamps only
   matched references that already had one, so a reference written without one
   was invisible to it and never became cache-busted. A browser then kept serving
   that file from cache after an upgrade while every other file was refreshed,
   leaving a page running mixed versions, which is an awkward thing to diagnose.

   One reference was in that state: spotlight.js imported utils.js unstamped.

   Fixing the reference alone would leave the tool unable to see the problem it
   exists to prevent, so the pattern accepts a missing stamp and `--check` fails
   on one. This test is the same rule, so a failure is visible from the test suite
   rather than only from the build. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
    `these will never cache-bust:\n${missing.join('\n')}\nAdd ?v=1; the build keeps it current.`,
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
    assert.match(workflow, /uses: \.\/\.github\/actions\/checks/, `${name} bypasses the shared checks`);
  }
});

/* The documented rule, against the mechanism.

   docs/frontend.md told contributors that the widget `?v=` was manual and to
   bump it by hand when a widget's files changed. It has not been manual since
   entryVersions existed: the release hashes each entry file into the manifest
   and widget-types.js reads it from there. A contributor following the document
   would have hand-edited a value the build owns.

   Pinned by mechanism rather than by sentence: what must stay true is that no
   widget URL carries a literal stamp and that the manifest is where the value
   comes from. */
test('the widget cache version comes from the manifest, not a hand-written literal', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-types.js'), 'utf8');
  assert.match(src, /entryVersions\?\.\[file\]/, 'widget-types.js no longer reads the manifest hash');
  const literal = /['"`]\/widgets\/[^'"`]*\?v=\d/.exec(src);
  assert.equal(literal, null, `a hand-written widget stamp is back: ${literal && literal[0]}`);
});

test('the frontend guide describes the mechanism that exists', () => {
  const doc = fs.readFileSync(path.join(root, '..', 'docs', 'frontend.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## Cache busting'));
  assert.match(section, /entryVersions/, 'the guide does not mention where the widget hash lives');
  assert.doesNotMatch(section, /is manual/, 'the guide tells contributors to bump a stamp the build owns');
});
