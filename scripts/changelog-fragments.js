#!/usr/bin/env node
/* Folds changelog.d/ fragments into the [Unreleased] section of CHANGELOG.md.

   One file per pull request, so two branches never edit the same lines and
   cannot conflict over an entry. The file name gives the section; the contents
   are the entry.

       changelog.d/fixed-scrutiny-identifiers.md

   Usage:
     node scripts/changelog-fragments.js --check   validate, write nothing
     node scripts/changelog-fragments.js --apply   fold in, delete the files */

const fs = require('node:fs');
const path = require('node:path');
const cl = require('./changelog.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'changelog.d');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

const SECTIONS = new Map(cl.TYPES.map(t => [t.toLowerCase(), t]));
const NAME = /^([a-z]+)-([a-z0-9-]+)\.md$/;

/** Every fragment in `dir`, as { file, type, entry }, plus what was wrong. */
function read(dir = DIR) {
  const errors = [];
  const fail = (file, message) => errors.push(`${file}: ${message}`);
  if (!fs.existsSync(dir)) return { fragments: [], errors };
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (file === 'README.md') continue;
    /* Opening this folder in Finder leaves a .DS_Store behind, which is not a
       fragment anybody wrote and must not fail the gate. */
    if (file.startsWith('.')) continue;
    if (!file.endsWith('.md')) {
      fail(file, 'is not a .md file');
      continue;
    }
    const m = NAME.exec(file);
    if (!m) {
      fail(file, 'name must be <section>-<slug>.md, lowercase and hyphenated');
      continue;
    }
    const type = SECTIONS.get(m[1]);
    if (!type) {
      fail(file, `"${m[1]}" is not one of ${[...SECTIONS.keys()].join(', ')}`);
      continue;
    }
    const entry = fs.readFileSync(path.join(dir, file), 'utf8').trim();
    if (!entry) {
      fail(file, 'is empty');
      continue;
    }
    if (entry.startsWith('-')) {
      fail(file, 'holds the entry text only, without the leading "- "');
      continue;
    }
    out.push({ file, type, entry });
  }
  return { fragments: out, errors };
}

/** Wrap to the width the rest of the file uses, indenting continuations. */
function bullet(entry) {
  const lines = [];
  for (const paragraph of entry.split(/\n{2,}/)) {
    let line = '-';
    for (const word of paragraph.split(/\s+/)) {
      if (line !== '-' && (line + ' ' + word).length > 80) {
        lines.push(line);
        line = ' ';
      }
      line += ' ' + word;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function apply(fragments, markdown) {
  const byType = new Map();
  for (const f of fragments) byType.set(f.type, [...(byType.get(f.type) || []), bullet(f.entry)]);

  const lines = markdown.split('\n');
  for (const type of [...cl.TYPES].reverse()) {
    const entries = byType.get(type);
    if (!entries) continue;
    /* Re-parse each time: an insert moves every line below it. */
    const unreleased = cl.unreleased(cl.parse(lines.join('\n')));
    const existing = unreleased.sections.find(s => s.type === type);
    if (existing) {
      const next = unreleased.sections[unreleased.sections.indexOf(existing) + 1];
      const end = next ? next.line - 1 : sectionEnd(lines, unreleased);
      lines.splice(end, 0, ...entries.flatMap(e => [e, '']));
    } else {
      const after = unreleased.sections.find(s => cl.TYPES.indexOf(s.type) > cl.TYPES.indexOf(type));
      const at = after ? after.line - 1 : sectionEnd(lines, unreleased);
      lines.splice(at, 0, `### ${type}`, '', ...entries.flatMap(e => [e, '']));
    }
  }
  return lines.join('\n');
}

/** The line index where [Unreleased] stops, which is the next version heading. */
function sectionEnd(lines, unreleased) {
  for (let i = unreleased.line; i < lines.length; i++) {
    if (/^##\s+\[/.test(lines[i])) return i;
  }
  return lines.length;
}

/** Validate, or exit non-zero naming every problem. */
function check() {
  const { fragments, errors } = read();
  if (errors.length) {
    for (const e of errors) console.error(`changelog-fragments: ${e}`);
    process.exit(1);
  }
  return fragments;
}

/* Computes the fold and hands back what would be written, so a caller that can
   still abort does not delete the fragments before it does. */
function planFold(markdown = fs.readFileSync(CHANGELOG, 'utf8')) {
  const fragments = check();
  return { fragments, markdown: fragments.length ? apply(fragments, markdown) : markdown };
}

function commitFold(plan) {
  if (!plan.fragments.length) return 0;
  for (const f of plan.fragments) fs.unlinkSync(path.join(DIR, f.file));
  return plan.fragments.length;
}

/** Fold every fragment into [Unreleased] and delete the files. */
function fold() {
  const plan = planFold();
  if (!plan.fragments.length) return 0;
  fs.writeFileSync(CHANGELOG, plan.markdown, 'utf8');
  return commitFold(plan);
}

function main(argv) {
  if (argv.includes('--apply')) {
    const n = fold();
    console.log(
      n ? `changelog-fragments: folded ${n} fragment(s) into [Unreleased]` : 'changelog-fragments: no fragments',
    );
    return;
  }
  const fragments = check();
  if (!fragments.length) {
    console.log('changelog-fragments: no fragments');
    return;
  }
  /* Prove the fold works now rather than at release, when it is too late. */
  apply(fragments, fs.readFileSync(CHANGELOG, 'utf8'));
  console.log(`changelog-fragments: ${fragments.length} fragment(s) fold in cleanly`);
  for (const f of fragments) console.log(`  ${f.type.padEnd(10)} ${f.file}`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { read, apply, bullet, check, fold, planFold, commitFold };
