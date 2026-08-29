/* Digit shape follows the reader's locale, not the interface language.

   Apple's guidance is that numerals take the digits of the user's locale and
   preferences, and that neither Arabic nor Persian always uses native digits:
   it depends on the country and the reader can choose. An iPhone in Arabic with
   a Latin-numeral region shows Latin digits in its badges. So the language
   setting picks the words and the locale picks the digits.

   A number that identifies rather than counts is left alone. So is a number
   that is not read by a person at all: an SVG coordinate or a CSS length in
   Persian digits does not render. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

async function withLocale(tag, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  try {
    /* The module caches one formatter, so it has to be re-imported per locale. */
    const mod = await import(`../js/format-number.js?locale=${encodeURIComponent(tag)}`);
    return fn(mod);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

test('a Persian locale gets Persian digits', async () => {
  await withLocale('fa-IR', ({ formatNumber }) => {
    assert.equal(formatNumber(3), '۳');
    assert.equal(formatNumber(128), '۱۲۸');
  });
});

/* The same language with a Latin-numeral preference, which is the case the
   interface-language approach would have got wrong. */
test('a Persian speaker who asks for Latin digits gets them', async () => {
  await withLocale('fa-IR-u-nu-latn', ({ formatNumber }) => {
    assert.equal(formatNumber(128), '128');
  });
});

test('the other five languages are unaffected', async () => {
  for (const tag of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'zh-Hans-CN']) {
    await withLocale(tag, ({ formatNumber }) => {
      assert.match(formatNumber(128), /^1.?28$/, `${tag} changed shape`);
    });
  }
});

test('a value that is not a finite number is passed through', async () => {
  await withLocale('fa-IR', ({ formatNumber }) => {
    for (const v of [NaN, Infinity, null, undefined, '99+']) {
      assert.equal(formatNumber(/** @type {any} */ (v)), String(v));
    }
  });
});

test('a runtime with no navigator still formats', async () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  delete globalThis.navigator;
  try {
    const { formatNumber } = await import('../js/format-number.js?no-navigator');
    assert.equal(formatNumber(128), '128');
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
  }
});

/* ── where it is and is not applied ───────────────────────────────────────── */

/* badge-logic.js is deliberately import-free, so the formatter is injected the
   way the translator already is. */
test('the badge takes its formatter by injection, not by import', () => {
  const logic = read('js/badge-logic.js');
  assert.doesNotMatch(logic, /^import /m, 'the file must stay import-free');
  assert.match(logic, /format\?: \(value: number\) => string/, 'the option is undeclared');
  assert.match(logic, /typeof format === 'function' \? format : v => String\(v\)/, 'no Latin-digit fallback');
  assert.match(read('js/dashboard.js'), /format: formatNumber/, 'the dashboard passes nothing in');
});

test('widgets take it from the toolbox rather than each inventing one', () => {
  const toolbox = read('js/widget-toolbox.js');
  assert.match(toolbox, /export \{ formatNumber, localiseDigits \}/);
  for (const w of ['dns', 'weather', 'books', 'system-summary', 'disk-health']) {
    const src = read(`widgets/${w}/index.html`);
    assert.match(src, /formatNumber/, `${w} still writes raw digits`);
    assert.match(src, /import \{[^}]*formatNumber[^}]*\} from '\/js\/widget-toolbox/, `${w} does not use the toolbox`);
  }
});

/* toLocaleString with no argument is the same thing until someone passes it a
   language, which is how this drifts back. */
test('no converted widget reaches for toLocaleString on a number', () => {
  for (const w of ['dns', 'weather', 'books', 'system-summary', 'disk-health']) {
    const src = read(`widgets/${w}/index.html`).replace(/new Date\([^)]*\)\.toLocaleString\([^)]*\)/g, '');
    assert.doesNotMatch(src, /\bn\.toLocaleString\(\)/, `${w} formats a number without a locale`);
  }
});

/* A coordinate or a length is not read by a person, and Persian digits in one
   do not render. */
test('geometry is left in Latin digits', () => {
  for (const w of ['dashboard-switch', 'nowplaying']) {
    const src = read(`widgets/${w}/index.html`);
    assert.doesNotMatch(src, /formatNumber/, `${w} localises geometry, which will not render`);
  }
});
