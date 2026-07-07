import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirFor, t, getLang, LANGUAGES } from '../js/i18n.js';

test('dirFor returns the listed direction for known locales', () => {
  assert.equal(dirFor('en'), 'ltr');
  assert.equal(dirFor('fa'), 'rtl');
  assert.equal(dirFor('zh-Hans'), 'ltr');
  assert.equal(dirFor('de'), 'ltr');
});

test('dirFor infers rtl for unlisted right-to-left scripts', () => {
  assert.equal(dirFor('ar'), 'rtl');
  assert.equal(dirFor('he'), 'rtl');
  assert.equal(dirFor('ur'), 'rtl');
});

test('dirFor matches on the base subtag and defaults to ltr', () => {
  assert.equal(dirFor('ps-AF'), 'rtl');
  assert.equal(dirFor('en-US'), 'ltr');
  assert.equal(dirFor('xx'), 'ltr');
  assert.equal(dirFor(''), 'ltr');
  assert.equal(dirFor(undefined), 'ltr');
});

test('LANGUAGES entries are well-formed with unique codes', () => {
  const codes = new Set();
  for (const l of LANGUAGES) {
    assert.equal(typeof l.code, 'string');
    assert.equal(typeof l.name, 'string');
    assert.ok(l.dir === 'ltr' || l.dir === 'rtl', `${l.code} has invalid dir`);
    assert.ok(!codes.has(l.code), `duplicate code ${l.code}`);
    codes.add(l.code);
  }
  assert.ok(codes.has('en'));
});

test('t falls back to the key itself when nothing is loaded', () => {
  assert.equal(t('some.missing.key'), 'some.missing.key');
  assert.equal(getLang(), 'en');
});

test('t interpolates provided vars and leaves unmatched placeholders intact', () => {
  assert.equal(t('{name}', { name: 'Sam' }), 'Sam');
  assert.equal(t('{missing}', { name: 'Sam' }), '{missing}');
});
