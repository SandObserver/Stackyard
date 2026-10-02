/* A slot's value and chart take that slot's colour, whatever its type and
   however many slots there are. Only slots that exist get a colour, so a rule
   that reads another slot's colour falls back to an unreadable default. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../widgets/system-summary/index.html', import.meta.url), 'utf8');
const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];

test('only the rule for slot N reads slot N colour', () => {
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = rule[1].trim();
    for (const ref of rule[2].matchAll(/var\(--(sct?)(\d)/g)) {
      const want = ref[1] === 'sct' ? `.slot-${ref[2]}` : `.bc-${ref[2]}`;
      assert.equal(selector, want, `${selector} reads --${ref[1]}${ref[2]}`);
    }
  }
});

test('every value and bar is marked with its own slot index', () => {
  assert.match(src, /function mkValueEl\(slot, i\) \{[\s\S]*?d\.className = `slot-\$\{i\}`;/);
  assert.match(src, /function mkSmallRow\(slot, i\) \{[\s\S]*?d\.className = `slot-row slot-\$\{i\}`;/);
  assert.equal(src.match(/class="disk-fill bc-\$\{i\}"/g)?.length, 2);
  assert.doesNotMatch(src, /class="v c-/);
});
