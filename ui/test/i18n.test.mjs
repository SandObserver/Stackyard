import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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

/* Catalogs are fetched at runtime, so read them from disk here instead. */
const CATALOG_DIR = new URL('../i18n/', import.meta.url);
const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const load = async code => flatten(JSON.parse(await readFile(new URL(`${code}.json`, CATALOG_DIR), 'utf8')));

test('every locale carries exactly the English key set', async () => {
  const en = Object.keys(await load('en')).sort();
  const codes = (await readdir(CATALOG_DIR)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  assert.ok(codes.length > 1, 'expected more than just the English catalog');
  for (const code of codes) {
    const keys = Object.keys(await load(code)).sort();
    assert.deepEqual(keys, en, `${code}.json key set differs from en.json`);
  }
});

test('no locale leaves a string empty', async () => {
  const codes = (await readdir(CATALOG_DIR)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  for (const code of codes)
    for (const [k, v] of Object.entries(await load(code)))
      assert.ok(typeof v === 'string' && v.trim(), `${code}.json has an empty value for ${k}`);
});
