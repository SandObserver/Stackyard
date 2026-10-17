import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../widgets/connections/connections-map.html', import.meta.url), 'utf8');
const rule = sel => src.match(new RegExp(`${sel.replace(/[.:()+]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';
const px = (css, prop) => Number.parseFloat(css.match(new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)px`))?.[1]);

const key = rule('#key');
const hit = rule('button.k::before')
  .match(/inset:(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/)
  .slice(1)
  .map(Number);

test('legend tap areas meet in the gap without overlapping', () => {
  assert.equal(hit[0], -px(key, 'gap') / 2);
  assert.equal(hit[2], -px(key, 'gap') / 2);
});

test('the first and last tap areas reach the card edges beside the legend', () => {
  assert.equal(hit[3], -px(key, 'left'));
  assert.equal(px(rule('button.k:last-child::before'), 'bottom'), -px(key, 'bottom'));
  assert.ok(px(rule('button.k:first-child::before'), 'top') < hit[0]);
});
