#!/usr/bin/env node
/* Reads the Changelog section of a pull request description and adds its
   entries to [Unreleased] in CHANGELOG.md.

       **Changelog**

       ### Fixed
       - A thing no longer breaks.

   The description is read from the PR_BODY environment variable.

   Usage:
     node scripts/changelog-pr.js --check   validate, write nothing
     node scripts/changelog-pr.js --apply   add the entries to CHANGELOG.md */

const fs = require('node:fs');
const path = require('node:path');
const cl = require('./changelog.js');

const CHANGELOG = path.join(__dirname, '..', 'CHANGELOG.md');

const SECTIONS = new Map(cl.TYPES.map(t => [t.toLowerCase(), t]));
const START = /^\s*(?:\*\*Changelog:?\*\*|#{1,2}\s+Changelog)\s*:?\s*$/i;
/* The next template heading ends the section. */
const END = /^\s*(?:\*\*[^*]+\*\*\s*:?|#{1,2}\s+\S.*)\s*$/;
const TYPE = /^\s*###\s+(.*?)\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NONE = /^\s*(?:-|[_*]*(?:none|n\/a)\.?[_*]*)\s*$/i;

/** The entries in a pull request description, as { type, entry }, plus what was wrong. */
function parse(body) {
  const errors = [];
  const entries = [];
  const text = String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  const start = lines.findIndex(l => START.test(l));
  if (start === -1) return { entries, errors };

  let type = null;
  let current = null;
  const flush = () => {
    if (current) entries.push({ type: current.type, entry: current.lines.join(' ').trim() });
    current = null;
  };
  for (const line of lines.slice(start + 1)) {
    if (END.test(line)) break;
    const heading = TYPE.exec(line);
    if (heading) {
      flush();
      type = SECTIONS.get(heading[1].toLowerCase()) ?? '';
      if (!type) errors.push(`"${heading[1]}" is not one of ${cl.TYPES.join(', ')}`);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      if (!bullet[1].trim()) continue;
      if (type === '') continue;
      if (!type) {
        errors.push(`"${bullet[1]}" has no ### section heading above it`);
        continue;
      }
      current = { type, lines: [bullet[1].trim()] };
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      current.lines.push(line.trim());
      continue;
    }
    if (NONE.test(line)) continue;
    errors.push(`"${line.trim()}" is not a "- " entry under a ### section heading`);
  }
  flush();
  return { entries, errors };
}

/** Wrap to the width the rest of the file uses, indenting continuations. */
function bullet(entry) {
  const lines = [];
  let line = '-';
  for (const word of entry.split(/\s+/)) {
    if (line !== '-' && `${line} ${word}`.length > 80) {
      lines.push(line);
      line = ' ';
    }
    line += ` ${word}`;
  }
  lines.push(line);
  return lines.join('\n');
}

/** The line index where [Unreleased] stops, which is the next version heading. */
function sectionEnd(lines, unreleased) {
  for (let i = unreleased.line; i < lines.length; i++) {
    if (/^##\s+\[/.test(lines[i])) return i;
  }
  return lines.length;
}

/* An entry already under [Unreleased] is skipped, so a re-run adds nothing. */
function apply(entries, markdown) {
  const present = new Set(
    cl
      .unreleased(cl.parse(markdown))
      .sections.flatMap(s => s.entries.map(e => `${s.type}\n${e.text.replace(/\s+/g, ' ')}`)),
  );
  const byType = new Map();
  for (const e of entries) {
    if (present.has(`${e.type}\n${e.entry}`)) continue;
    byType.set(e.type, [...(byType.get(e.type) || []), bullet(e.entry)]);
  }

  const lines = markdown.split('\n');
  for (const type of [...cl.TYPES].reverse()) {
    const add = byType.get(type);
    if (!add) continue;
    /* Re-parse each time: an insert moves every line below it. */
    const unreleased = cl.unreleased(cl.parse(lines.join('\n')));
    const existing = unreleased.sections.find(s => s.type === type);
    if (existing) {
      const next = unreleased.sections[unreleased.sections.indexOf(existing) + 1];
      const end = next ? next.line - 1 : sectionEnd(lines, unreleased);
      lines.splice(end, 0, ...add.flatMap(e => [e, '']));
    } else {
      const after = unreleased.sections.find(s => cl.TYPES.indexOf(s.type) > cl.TYPES.indexOf(type));
      const at = after ? after.line - 1 : sectionEnd(lines, unreleased);
      lines.splice(at, 0, `### ${type}`, '', ...add.flatMap(e => [e, '']));
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const { entries, errors } = parse(process.env.PR_BODY);
  if (errors.length) {
    for (const e of errors) console.error(`changelog-pr: ${e}`);
    process.exit(1);
  }
  const markdown = fs.readFileSync(CHANGELOG, 'utf8');
  if (!cl.unreleased(cl.parse(markdown))) {
    console.error('changelog-pr: CHANGELOG.md has no [Unreleased] section');
    process.exit(1);
  }
  const out = apply(entries, markdown);
  if (argv.includes('--apply') && out !== markdown) fs.writeFileSync(CHANGELOG, out, 'utf8');
  if (!entries.length) console.log('changelog-pr: no changelog entries');
  for (const e of entries) console.log(`  ${e.type.padEnd(10)} ${e.entry}`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parse, apply, bullet };
