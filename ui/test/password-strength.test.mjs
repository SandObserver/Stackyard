/* P9-5: pwStrength existed in ui/js/admin-auth.js and ui/js/dashboard.js,
   identical apart from two comments, and had no test in either place.

   It also returned hardcoded English labels that both callers put in front of
   the user: the first-run setup dialog wrote one into its hint, and
   admin-settings interpolated one into t('toast.pwWeak'), so a translated
   sentence ended in an English word. It returns a key now. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pwStrength, MIN_PASSWORD_LENGTH } from '../js/password-strength.js';

test('an empty password scores nothing and says nothing', () => {
  const r = pwStrength('');
  assert.equal(r.score, 0);
  assert.equal(r.labelKey, '', 'nothing to say yet, so no hint');
  assert.equal(r.ok, false);
});

test('a password under the minimum is rejected as too short', () => {
  for (const pw of ['a', 'abc', 'Abc1!xy']) {
    const r = pwStrength(pw);
    assert.ok(pw.length < MIN_PASSWORD_LENGTH, pw);
    assert.equal(r.labelKey, 'pwStrength.tooShort', pw);
    assert.equal(r.ok, false, pw);
  }
});

/* The boundary, pinned: eight characters is accepted, seven is not. */
test('the minimum length is the boundary it claims to be', () => {
  assert.equal(pwStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1)).labelKey, 'pwStrength.tooShort');
  assert.notEqual(pwStrength('a'.repeat(MIN_PASSWORD_LENGTH)).labelKey, 'pwStrength.tooShort');
});

test('score rises with length and character variety', () => {
  const weak   = pwStrength('aaaaaaaa');            /* 8 chars, one class */
  const better = pwStrength('aaaaAAAA1111');        /* 12 chars, three classes */
  const best   = pwStrength('aaaaAAAA1111!!!!');    /* 16 chars, four classes */
  assert.ok(weak.score < better.score, 'variety and length must count');
  assert.ok(better.score <= best.score);
  assert.equal(best.labelKey, 'pwStrength.strong');
});

/* The bug both copies carried. The index was Math.min(4, score - 1) against
   four-entry label and colour arrays, so the maximum score indexed past the end
   and returned undefined for both. The setup dialog assigns the label straight
   to hint.textContent, which renders the string "undefined", so the strongest
   possible password was the one that looked broken. */
test('the strongest password still gets a label and a colour', () => {
  const r = pwStrength('aaaaAAAA1111!!!!');
  assert.equal(r.score, 5, 'it must reach the top of the scale');
  assert.equal(r.labelKey, 'pwStrength.strong');
  assert.notEqual(r.labelKey, undefined);
  assert.notEqual(r.color, undefined);
  assert.equal(String(r.labelKey).includes('undefined'), false);
});

/* Nothing in the range may fall off the end of either array. */
test('every reachable score yields a label and a colour', () => {
  const seen = new Set();
  for (const pw of ['aaaaaaaa', 'aaaaaaaaaaaa', 'aaaaAAAAaaaa', 'aaaaAAAA1111',
    'aaaaAAAA1111!!!!', 'aA1!aA1!', 'aA1!aA1!aA1!', 'Aa1!'.repeat(8)]) {
    const r = pwStrength(pw);
    seen.add(r.score);
    assert.equal(typeof r.labelKey, 'string', pw);
    assert.ok(r.labelKey.length, pw);
    assert.equal(typeof r.color, 'string', pw);
  }
  assert.ok(seen.has(5), 'the top score must be covered');
});

test('a long single-class password is still not rejected outright', () => {
  const r = pwStrength('aaaaaaaaaaaa');
  assert.equal(r.ok, true, 'twelve characters clears the bar');
});

test('ok is false only for empty, too short, or the weakest score', () => {
  assert.equal(pwStrength('aaaaaaaa').ok, false, 'the weakest passing length is still not accepted');
  assert.equal(pwStrength('aaaaaaaaaaaa').ok, true);
});

test('the score never exceeds the five bars the markup draws', () => {
  const r = pwStrength('aaaaAAAA1111!!!!$$$$%%%%^^^^&&&&');
  assert.ok(r.score >= 1 && r.score <= 5, `score ${r.score} must fit the bars`);
});

test('a colour is always returned', () => {
  for (const pw of ['', 'abc', 'aaaaaaaa', 'aaaaAAAA1111!!!!']) {
    assert.match(pwStrength(pw).color, /^(#[0-9a-f]{6}|rgba\(.+\))$/i, JSON.stringify(pw));
  }
});

/* The half of the finding that was a live defect: every key it can return has
   to exist in every locale, or a caller's t() falls back to printing the key. */
test('every label key it returns exists in all locales', async () => {
  const keys = new Set();
  for (const pw of ['', 'abc', 'aaaaaaaa', 'aaaaAAAA1111', 'aaaaAAAA1111!!!!', 'aA1!aA1!']) {
    const { labelKey } = pwStrength(pw);
    if (labelKey) keys.add(labelKey);
  }
  assert.ok(keys.size >= 2, 'the test must actually exercise several labels');

  const locales = (await readdir('../i18n')).filter(f => f.endsWith('.json'));
  assert.ok(locales.length >= 6, 'all shipped locales must be checked');

  for (const file of locales) {
    const cat = JSON.parse(await readFile(`../i18n/${file}`, 'utf8'));
    for (const key of keys) {
      const value = key.split('.').reduce((o, part) => (o == null ? o : o[part]), cat);
      assert.equal(typeof value, 'string', `${file} is missing ${key}`);
      assert.ok(value.length, `${file} has ${key} empty`);
    }
  }
});

/* The duplicate is gone rather than merely unused: neither caller may carry its
   own copy again. */
test('neither caller redefines the function', async () => {
  for (const file of ['../js/dashboard.js', '../js/admin-auth.js']) {
    const src = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(!/function pwStrength\s*\(/.test(src), `${file} must import it, not redefine it`);
    assert.match(src, /password-strength\.js/, `${file} must import it`);
  }
});
