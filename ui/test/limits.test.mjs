import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampName, NAME_MAX } from '../js/limits.js';

test('a name within the limit is kept as it is', () => {
  assert.equal(clampName('Plex'), 'Plex');
  assert.equal(clampName('N'.repeat(NAME_MAX)), 'N'.repeat(NAME_MAX));
});

test('a long name is cut to the limit', () => {
  assert.equal(clampName('N'.repeat(NAME_MAX + 1)), 'N'.repeat(NAME_MAX));
});

test('a cut never splits a character the reader sees as one', () => {
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const out = clampName(family.repeat(NAME_MAX + 5));
  assert.equal(out, family.repeat(NAME_MAX));
});

test('emoji that fit by count are not cut by their length in code units', () => {
  const name = '\u{1F3AC}'.repeat(NAME_MAX);
  assert.equal(clampName(name), name);
});
