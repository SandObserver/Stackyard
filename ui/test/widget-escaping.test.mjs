/* Regression tests for P14-1: unescaped interpolations in widget frontends.

   Widget iframes are the only CSP context that allows inline script
   (`script-src 'self' 'unsafe-inline'` in nginx/dashboard.conf), so markup
   injected there actually runs. Four sites concatenated values into innerHTML.

   Two kinds of test here:

   safeColor is exercised directly, because a CSS value cannot be made safe by
   escaping and the validator is the whole defence.

   The four call sites are checked as source text. They live in .html files with
   inline modules, so there is no DOM-free way to import and run them; asserting
   they no longer build markup by concatenation is what stops the pattern coming
   back. `chore/typecheck-pure-frontend-modules` and the widget innerHTML ratchet
   are the general versions of this. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
const { safeColor } = await import('../js/widget-toolbox.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const MAP = 'widgets/connections/connections-map.html';
const BACKUP = 'widgets/backup/backup.html';
const STATS = 'widgets/stats/system-stats.html';

/* ── safeColor ────────────────────────────────────────────────────────────── */

test('safeColor accepts the colour formats the widgets actually produce', () => {
  assert.equal(safeColor('#abc', '#000'), '#abc');
  assert.equal(safeColor('#AABBCC', '#000'), '#AABBCC');
  assert.equal(safeColor('rgb(1,2,3)', '#000'), 'rgb(1,2,3)');
  assert.equal(safeColor('rgb( 10 , 20 , 30 )', '#000'), 'rgb( 10 , 20 , 30 )');
  assert.equal(safeColor('  #abc  ', '#000'), '#abc', 'surrounding whitespace is trimmed');
});

test('safeColor rejects a value carrying a second CSS declaration', () => {
  /* The case escaping does not cover: no quote, no angle bracket, nothing for
     esc() to act on, but still a second declaration once parsed. */
  assert.equal(safeColor('red; background-image: url(https://evil.example/)', '#000'), '#000');
  assert.equal(safeColor('rgb(1,2,3);x:y', '#000'), '#000');
  assert.equal(safeColor('#abc;position:fixed;top:0', '#000'), '#000');
});

test('safeColor rejects url() and other non-colour values', () => {
  assert.equal(safeColor('url(javascript:alert(1))', '#000'), '#000');
  assert.equal(safeColor('expression(alert(1))', '#000'), '#000');
  assert.equal(safeColor('var(--x)', '#000'), '#000');
});

test('safeColor rejects rather than repairs a malformed colour', () => {
  assert.equal(safeColor('#abcd', '#000'), '#000', 'four digits is not a valid hex colour');
  assert.equal(safeColor('#ab', '#000'), '#000');
  assert.equal(safeColor('rgb(1,2)', '#000'), '#000');
});

test('safeColor falls back for empty and non-string input', () => {
  for (const v of ['', null, undefined, 0, {}, []]) {
    assert.equal(safeColor(v, '#AF52DE'), '#AF52DE', `expected fallback for ${JSON.stringify(v)}`);
  }
});

/* Named colours are valid CSS but are not accepted, because the widgets only
   ever produce hex or rgb(). Widening the pattern is a deliberate decision, and
   this test is the reminder. */
test('safeColor does not accept named colours', () => {
  assert.equal(safeColor('rebeccapurple', '#000'), '#000');
});

/* ── The four sites ───────────────────────────────────────────────────────── */

/* A ratchet for the three files this branch touches, in the same shape as
   ui/test/innerhtml-ratchet.test.mjs. Clears (`= ''`) write no markup and are
   not counted. backup.html keeps three writes on purpose:

     a literal '&nbsp;<br>&nbsp;' placeholder
     the running-state SVG, which interpolates nothing
     `Last ${last}` / `Next ${next}`, where relTime() returns only '—' or a
     number followed by a unit

   Neither can carry a value from config or from upstream. The general version
   of this, covering all of ui/widgets, is security/extend-innerhtml-ratchet. */
const BUDGET = { [MAP]: 0, [STATS]: 0, [BACKUP]: 3 };

test('no widget frontend touched here exceeds its innerHTML budget', () => {
  const over = [];
  for (const [f, budget] of Object.entries(BUDGET)) {
    const writes = [...read(f).matchAll(/\.innerHTML\s*(\+?)=(?!=)\s*/g)].filter(
      m => !(m[1] === '' && /^(?:''|""|``)\s*[;,)]/.test(read(f).slice(m.index + m[0].length))),
    );
    if (writes.length > budget) over.push(`${f}: ${writes.length} > ${budget}`);
  }
  assert.deepEqual(over, [], `Use setHtml(el, html\`...\`):\n${over.join('\n')}`);
});

test('the upstream users value is escaped, not concatenated', () => {
  const src = read(MAP);
  assert.ok(!src.includes('+info.users+'), 'info.users is still concatenated into markup');
  assert.match(src, /\$\{info\.users\}/, 'info.users should be an html`` interpolation');
});

test('the backup error text is escaped', () => {
  const src = read(BACKUP);
  /* The fallback is a translated string now, so the assertion is on the shape
     that matters: the upstream error goes through html`` and setHtml, never
     concatenation. */
  assert.match(src, /setHtml\(bmeta, html`\$\{err\?\.error\|\|wt\(/);
});

test('the system-stats label falls back through an escaped interpolation', () => {
  const src = read(STATS);
  assert.match(src, /setHtml\(d, html`<div class="chart-lbl">\$\{lbl\}<\/div>/);
});

test('both colour sites validate and assign through named CSSOM properties', () => {
  const src = read(MAP);
  assert.equal((src.match(/safeColor\(/g) || []).length, 2, 'both dots should validate');
  assert.equal((src.match(/\.style\.backgroundColor\s*=/g) || []).length, 2);
  /* The shorthand would accept a url(), so a validated colour must never be
     assigned through it. Literal hover colours elsewhere in the file use the
     shorthand and are fine, hence the check is on the variable, not the property. */
  assert.ok(
    !/\.style\.background\s*=\s*(?!'|")/.test(src),
    'a non-literal is assigned through the background shorthand; use backgroundColor',
  );
});
