/* What CONTRIBUTING.md tells a contributor to run, against what CI runs.

   P18-7. The pull request template asked for one command, `cd api && node
   --test`, out of the eight checks that decide whether a change merges, and
   neither document mentioned the cache-busting check, which runs first and is
   the one a new contributor is most likely to trip: reference a new stylesheet
   or module without a `?v=` stamp and the build fails with nothing local to
   reproduce it.

   The checks are defined once, in the composite action, so the list can be
   compared rather than described. A check added to CI without being written
   down fails here, which is the only way a list like this stays true.

   Commands are compared as text, and the doc is written to match the action
   verbatim for that reason: a doc that paraphrases a command is a doc someone
   copies and gets wrong. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const action = read('.github/actions/checks/action.yml');
const contributing = read('CONTRIBUTING.md');
const template = read('.github/PULL_REQUEST_TEMPLATE.md');

const SECTION = '## Before opening a PR';

/* Every step the test path runs, as [command, workingDirectory].

   Parsed as YAML rather than split on text. The previous version keyed off the
   exact indentation of "- name:" and "run:", so re-indenting the action, or
   writing a run: as a block scalar, silently produced a shorter list and this
   file agreed with a document it had stopped comparing.

   Release-only steps are skipped: they stamp cache-busting hashes into the tree
   and are the build's job, not a contributor's. */
function ciCommands() {
  const doc = yaml.load(action);
  const steps = doc?.runs?.steps;
  assert.ok(Array.isArray(steps), 'the composite action has no runs.steps');
  const out = [];
  for (const step of steps) {
    if (typeof step?.if === 'string' && step.if.includes("inputs.mode == 'release'")) continue;
    if (typeof step?.run !== 'string') continue; /* uses:, not run: */
    /* A multi-line run is a script, not a command a contributor types. The
       test path has none; if one appears, it needs a decision rather than
       being folded into one line. */
    const command = step.run.trim();
    if (command.includes('\n')) continue;
    out.push([command, step['working-directory'] || null]);
  }
  return out;
}

/* The command as a contributor would type it from the repository root. */
const asTyped = ([cmd, dir]) => (dir ? `cd ${dir} && ${cmd}` : cmd);

function docSection() {
  const at = contributing.indexOf(SECTION);
  assert.notEqual(at, -1, `${SECTION} is gone from CONTRIBUTING.md`);
  const next = contributing.indexOf('\n## ', at + 4);
  return contributing.slice(at, next === -1 ? undefined : next);
}

test('the scan finds the checks and the section', () => {
  const cmds = ciCommands();
  assert.ok(cmds.length >= 7, `only ${cmds.length} CI commands found; the action format may have changed`);
  assert.ok(
    cmds.some(c => /npm run lint/.test(c[0])),
    'lint should be among them',
  );
  assert.ok(docSection().includes('```'), 'the section has no command block');
});

test('every check CI runs is one CONTRIBUTING.md tells you to run', () => {
  const section = docSection();
  const missing = ciCommands()
    .map(asTyped)
    .filter(c => !section.includes(c));
  assert.deepEqual(missing, [], `CI runs these and CONTRIBUTING.md does not list them:\n  ${missing.join('\n  ')}`);
});

/* The other direction. A command that no longer exists is worse than a missing
   one, because it is followed and then trusted. */
test('CONTRIBUTING.md lists no check CI does not run', () => {
  const block = /```\n([\s\S]*?)```/.exec(docSection());
  assert.ok(block, 'the command block is gone');
  const listed = block[1]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const ci = ciCommands().map(asTyped);
  const extra = listed.filter(l => !ci.includes(l));
  assert.deepEqual(extra, [], `Listed in CONTRIBUTING.md but not run by CI:\n  ${extra.join('\n  ')}`);
});

/* The order is what makes the list usable: the cheap checks come first, so a
   contributor finds out about a lint error before waiting for a docker build. */
test('the documented order is the order CI runs them in', () => {
  const block = /```\n([\s\S]*?)```/.exec(docSection())[1];
  const positions = ciCommands()
    .map(asTyped)
    .map(c => block.indexOf(c));
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, sorted, 'the commands are listed out of order');
});

/* The reason for parsing rather than pattern-matching: a formatting change must
   not quietly shrink the list this file compares against. */
test('the step list survives reformatting of the action', () => {
  const doc = yaml.load(action);
  /* Re-emitted with different indentation and line widths, which is what a
     tidy-up or a different editor produces. */
  const reformatted = yaml.dump(doc, { indent: 6, lineWidth: 40, quotingType: '"' });
  const reparsed = yaml.load(reformatted);
  const commands = steps =>
    steps
      .filter(st => !(typeof st?.if === 'string' && st.if.includes("inputs.mode == 'release'")))
      .filter(st => typeof st?.run === 'string' && !st.run.trim().includes('\n'))
      .map(st => [st.run.trim(), st['working-directory'] || null]);
  assert.deepEqual(
    commands(reparsed.runs.steps),
    ciCommands(),
    'the same action formatted differently produced a different list',
  );
});

/* CodeQL blocks a merge like any other check, so a contributor should not meet
   it for the first time on their own PR. */
test('the checks that are not in the composite action are mentioned too', () => {
  assert.ok(
    fs.existsSync(path.join(root, '.github/workflows/codeql.yml')),
    'codeql.yml is gone; the mention in CONTRIBUTING.md should go with it',
  );
  assert.match(docSection(), /CodeQL/);
});

/* The template asked for a fraction of the checks, which is how a contributor
   learns the wrong set. One list, in one place, and the template points at it. */
test('the PR template points at the list rather than naming its own commands', () => {
  assert.match(template, /CONTRIBUTING\.md#before-opening-a-pr/, 'the template should link to the check list');
  const testing = template.slice(template.indexOf('**Testing**'), template.indexOf('**Checklist**'));
  assert.doesNotMatch(testing, /```/, 'the template has its own command block again; it will drift from CI');
});

/* Test code was outside every quality gate: about a megabyte of it, linted by
   nothing. It is inside the linter's globs now, and the exclusion that remains,
   typechecking, is written down rather than silent. */
test('the linter covers the test directories', () => {
  const cfg = JSON.parse(read('biome.json').replace(/^\s*\/\/.*$/gm, ''));
  const globs = cfg.files.includes.join(' ');
  for (const dir of ['api/test', 'api/test-support', 'ui/test']) {
    assert.ok(globs.includes(dir), `${dir} is not linted`);
  }
});

test('the typecheck exclusion is documented, not silent', () => {
  const cfg = JSON.parse(read('tsconfig.json').replace(/^\s*\/\/.*$/gm, ''));
  const included = cfg.include.join(' ');
  if (included.includes('api/test')) return; /* someone did the work; nothing to explain */
  assert.match(
    contributing,
    /not\*\* typechecked|are \*\*not\*\* typechecked/,
    'tests are excluded from typecheck with no reason written down in CONTRIBUTING.md',
  );
});
