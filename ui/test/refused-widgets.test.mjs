import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* A refused widget has to explain itself where it is missing from. Rendering
   the reason only in the config editor of an item already using that widget is
   the one case a new install cannot reach, so the reason stays in the container
   log.

   The wording and filtering are pure and tested in admin-logic.test.mjs. These
   are the wiring. Asserted as source text because the form builds DOM and there
   is no browser here. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const form = fs.readFileSync(path.join(root, 'js/admin-widget-form.js'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8'));

test('the form builds its reason lines with the shared helper', () => {
  assert.match(form, /import \{[^}]*\brejectionLines\b/, 'the helper is not imported');
  /* One construction site, so the picker and the editor cannot diverge. */
  const uses = [...form.matchAll(/\brejectionLines\(/g)];
  assert.equal(uses.length, 1, `rejectionLines is called ${uses.length} times; it should be built in one place`);
});

test('both places that show a refusal go through that one renderer', () => {
  const calls = [...form.matchAll(/appendRejectionReasons\(/g)];
  /* The definition plus the two call sites. */
  assert.equal(calls.length, 3, `expected two call sites, found ${calls.length - 1}`);
});

test('the picker says how many widgets were refused', () => {
  assert.match(form, /t\('widgetCfg\.refused', \{ count:/, 'the picker does not show the count notice');
  for (const k of ['refused_one', 'refused_other']) {
    assert.ok(en.widgetCfg?.[k], `widgetCfg.${k} is missing from en.json`);
    assert.match(en.widgetCfg[k], /\{count\}/, `widgetCfg.${k} should name the count`);
  }
});

/* The notice belongs above the size and config sections, next to the list the
   widget is missing from, not at the bottom of the form. */
test('the notice renders next to the type list', () => {
  const atType = form.indexOf('id="f-wtype"');
  const atNotice = form.indexOf("t('widgetCfg.refused'");
  const atSize = form.search(/sizeHdr\.textContent\s*=\s*t\('widgetCfg\.size'\)/);
  assert.ok(atType !== -1 && atNotice !== -1 && atSize !== -1, 'the form no longer has these parts');
  assert.ok(
    atType < atNotice && atNotice < atSize,
    'the refusal notice should sit between the type list and the size section',
  );
});

/* A validator message is built from names taken out of the manifest, so it is
   text and not markup, in both places. */
test('a reason is written as text', () => {
  assert.match(form, /li\.textContent\s*=\s*line/);
  assert.doesNotMatch(form, /innerHTML\s*=\s*line/);
});
