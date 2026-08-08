const fs   = require('node:fs');
const path = require('node:path');
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { tmpPath } = require('../test-support/tmp');
const { translateEntry, translateTree, translatorFor, _resetCache } = require('../src/widget-i18n');

/* A widget's strings live in its own folder so a third-party widget can ship
   its own languages without touching core. These tests cover the resolution
   order and, just as importantly, what happens when a catalog is absent: an
   untranslated manifest carries plain English in `label` and has to keep
   rendering exactly as it did. */

const ROOT = tmpPath('widgets', 'widget-i18n');

function widget(name, catalogs) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(path.join(dir, 'i18n'), { recursive: true });
  for (const [lang, body] of Object.entries(catalogs)) {
    fs.writeFileSync(path.join(dir, 'i18n', lang + '.json'),
      typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

beforeEach(() => _resetCache());
after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} });

test('a key resolves from the active language', () => {
  const dir = widget('a', { en: { 'x.label': 'Server URL' }, fa: { 'x.label': 'نشانی سرور' } });
  const out = translateEntry({ label: 'x.label' }, dir, 'a', 'fa');
  assert.equal(out.label, 'نشانی سرور');
});

test('a key missing from the active language falls back to English', () => {
  const dir = widget('b', { en: { 'x.label': 'Server URL' }, fa: { 'other.label': 'دیگر' } });
  assert.equal(translateEntry({ label: 'x.label' }, dir, 'b', 'fa').label, 'Server URL');
});

test('a key in no catalog renders the manifest text itself', () => {
  /* This is what keeps an untranslated third-party manifest working: its
     `label` is plain English and passes straight through. */
  const dir = widget('c', { en: { 'x.label': 'Server URL' } });
  assert.equal(translateEntry({ label: 'Some Third-Party Label' }, dir, 'c', 'fa').label, 'Some Third-Party Label');
});

test('a widget with no catalogs at all is returned unchanged', () => {
  const dir = path.join(ROOT, 'none');
  fs.mkdirSync(dir, { recursive: true });
  const entry = { label: 'Plain', fields: [{ key: 'k', label: 'Also plain' }] };
  assert.deepEqual(translateEntry(entry, dir, 'none', 'fa'), entry);
});

test('English is served from the English catalog, not the raw key', () => {
  const dir = widget('d', { en: { 'x.label': 'Server URL' } });
  assert.equal(translateEntry({ label: 'x.label' }, dir, 'd', 'en').label, 'Server URL');
});

test('every human-facing key is translated and nothing else is', () => {
  const dir = widget('e', {
    en: {
      'f.label': 'Label', 'f.placeholder': 'Placeholder', 'f.hint': 'Hint',
      'f.rowLabel': 'Row', 'f.fetchLabel': 'Fetch', 'provider': 'TRANSLATED',
    },
  });
  const entry = {
    fields: [{
      key: 'provider', type: 'provider', variant: 'provider', optionsFrom: 'provider',
      label: 'f.label', placeholder: 'f.placeholder', hint: 'f.hint',
      rowLabel: 'f.rowLabel', fetchLabel: 'f.fetchLabel',
      showIf: { field: 'provider', equals: 'provider' },
    }],
  };
  const f = translateEntry(entry, dir, 'e', 'en').fields[0];
  assert.deepEqual(
    { label: f.label, placeholder: f.placeholder, hint: f.hint, rowLabel: f.rowLabel, fetchLabel: f.fetchLabel },
    { label: 'Label', placeholder: 'Placeholder', hint: 'Hint', rowLabel: 'Row', fetchLabel: 'Fetch' });
  /* Identifiers, types and comparison values share the word "provider" and
     must survive untouched, or the lookups they take part in break. */
  assert.deepEqual(
    { key: f.key, type: f.type, variant: f.variant, optionsFrom: f.optionsFrom, showIf: f.showIf },
    { key: 'provider', type: 'provider', variant: 'provider', optionsFrom: 'provider',
      showIf: { field: 'provider', equals: 'provider' } });
});

test('option labels nested in arrays are translated', () => {
  const dir = widget('f', { en: { 'p.opt.adguard': 'AdGuard Home' }, de: { 'p.opt.adguard': 'AdGuard Home (DE)' } });
  const out = translateEntry({ fields: [{ key: 'p', options: [{ value: 'adguard', label: 'p.opt.adguard' }] }] }, dir, 'f', 'de');
  assert.equal(out.fields[0].options[0].label, 'AdGuard Home (DE)');
  assert.equal(out.fields[0].options[0].value, 'adguard');
});

test('the source entry is not modified', () => {
  const dir = widget('g', { en: { 'x.label': 'Server URL' } });
  const entry = { label: 'x.label' };
  translateEntry(entry, dir, 'g', 'en');
  assert.equal(entry.label, 'x.label', 'the cached manifest must not be rewritten in place');
});

test('a malformed catalog is ignored rather than throwing', () => {
  const dir = widget('h', { en: 'not json at all', fa: '[]' });
  assert.equal(translateEntry({ label: 'Plain' }, dir, 'h', 'fa').label, 'Plain');
});

test('a catalog key named after an inherited property does not resolve', () => {
  const dir = widget('i', { en: {} });
  assert.equal(translateEntry({ label: 'constructor' }, dir, 'i', 'en').label, 'constructor');
  assert.equal(translateEntry({ label: 'toString' }, dir, 'i', 'en').label, 'toString');
});

test('an empty translation falls through rather than blanking the label', () => {
  const dir = widget('j', { en: { 'x.label': 'Server URL' }, fa: { 'x.label': '' } });
  assert.equal(translateEntry({ label: 'x.label' }, dir, 'j', 'fa').label, 'Server URL');
});

test('translateTree preserves structure, arrays and non-string values', () => {
  const t = translatorFor(path.join(ROOT, 'none'), 'none', 'en');
  const entry = { sizes: ['small', 'medium'], card: null, n: 3, ok: true, nested: { deep: [{ label: 'x' }] } };
  assert.deepEqual(translateTree(entry, t), entry);
});
