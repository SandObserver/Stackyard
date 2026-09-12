/* Card spacing in the editor is owned by each element, never by a pair.

   The editor parks hidden helper elements between cards. `display:none` keeps an
   element in the sibling chain, so a rule written as `.grp + .grp` stops
   matching and the gap silently collapses to nothing. That shipped: the group
   after the label-list wrapper had no top margin at all. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'css', 'admin.css'), 'utf8');
const rules = css.split('\n').filter(l => l.startsWith('#ev-body'));

test('no editor spacing rule depends on a sibling combinator', () => {
  const offenders = rules.filter(l => /#ev-body[^{]*[+~]/.test(l));
  assert.deepEqual(offenders, [], `a hidden element between two cards makes these miss:\n  ${offenders.join('\n  ')}`);
});

test('the editor body is flex, so a hidden child is not a box', () => {
  assert.match(css, /#ev-body\{[^}]*display:flex[^}]*flex-direction:column/);
});

test('a card states its own top gap', () => {
  assert.match(css, /#ev-body > \.grp\{margin-block:44px 0\}/);
  assert.match(css, /#ev-body > :first-child\{margin-top:0\}/);
});

/* Flex margins add rather than collapse, which is what makes the cancellation
   exact. In flow the two would collapse to 44px and the heading would float. */
test('a heading cancels the gap of the card below it', () => {
  assert.match(css, /#ev-body > \.grp-hdr\{margin-bottom:-44px\}/);
});

/* The cancellation is for the flex column only. Applied to every descendant it
   pulls the cards inside a widget config group up over their own headings. */
test('the cancellation does not reach nested headings', () => {
  assert.match(css, /#ev-body \.grp-hdr\{margin-top:36px;padding-top:0\}/, 'a nested heading keeps its own gap');
  const nested = rules.filter(l => /^#ev-body \.grp-hdr/.test(l));
  for (const r of nested) assert.doesNotMatch(r, /-44px/, `${r} reaches inside a card`);
});
