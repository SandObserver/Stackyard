/* Regression tests for P11-4 and P11-5: a config card could render empty.

   Fields in a widget's config form can be conditional: a `showIf` hides one
   until another has a particular value. The form hides the field, but not the
   card containing it, so a card whose every field is conditional would render as
   an empty box with a heading and nothing in it.

   That cannot happen today. Every card in every shipped widget has at least one
   field with no `showIf`, almost always the provider or mode selector that
   decides what the rest of the card shows. So the finding describes something
   the code permits rather than something the manifests produce.

   Hiding empty cards at runtime would be code for a case that never occurs, and
   would quietly paper over a manifest written that way. The rule worth stating
   is that a card should always have something to show, and this is where a
   manifest that breaks it gets caught.

   The visibility rule is imported rather than reimplemented, so this tests what
   the form actually does. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { visibleFieldKeys } = await import('../js/admin-logic.js');

const widgets = fs.readdirSync(path.join(root, 'widgets'), { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .filter(n => fs.existsSync(path.join(root, 'widgets', n, 'widget.json')))
  .map(n => ({ name: n, manifest: JSON.parse(fs.readFileSync(path.join(root, 'widgets', n, 'widget.json'), 'utf8')) }));

/* Every card in the tree: the top-level form, and each group or object. */
function cards(manifest) {
  const out = [{ where: 'top level', fields: manifest.fields || [] }];
  for (const f of manifest.fields || []) {
    if ((f.type === 'group' || f.type === 'object') && Array.isArray(f.fields)) {
      out.push({ where: `${f.type} "${f.key}"`, fields: f.fields });
    }
  }
  return out;
}

test('there are widgets to check', () => {
  assert.ok(widgets.length >= 8, `only found ${widgets.length} widget manifests`);
});

/* The invariant. A card with no unconditional field can hide everything at once
   and render as an empty box with a heading. */
test('every card has at least one field that always shows', () => {
  const empty = [];
  for (const { name, manifest } of widgets) {
    for (const card of cards(manifest)) {
      if (!card.fields.length) continue;
      if (!card.fields.some(f => !f.showIf)) {
        empty.push(`${name}: ${card.where} — all ${card.fields.length} fields are conditional`);
      }
    }
  }
  assert.deepEqual(empty, [],
    `these cards can render empty:\n${empty.join('\n')}\n` +
    'Give each card a field with no showIf, usually the selector the others depend on.');
});

/* Stronger than counting: with nothing filled in, which is how a form opens,
   the real visibility rule must still leave something on screen. */
test('a freshly opened form shows something in every card', () => {
  const blank = [];
  for (const { name, manifest } of widgets) {
    for (const card of cards(manifest)) {
      if (!card.fields.length) continue;
      /* No value entered anywhere, the state on first open. */
      const shown = visibleFieldKeys(card.fields, () => undefined);
      if (shown.size === 0) blank.push(`${name}: ${card.where}`);
    }
  }
  assert.deepEqual(blank, [], `these cards open empty:\n${blank.join('\n')}`);
});

/* The selector a card depends on must itself be in that card, or choosing a
   provider would hide fields with no visible way to bring them back. */
test('a conditional field depends on something in the same card', () => {
  const orphans = [];
  for (const { name, manifest } of widgets) {
    for (const card of cards(manifest)) {
      const keys = new Set(card.fields.map(f => f.key));
      const topKeys = new Set((manifest.fields || []).map(f => f.key));
      for (const f of card.fields) {
        const dep = f.showIf?.field;
        if (dep && !keys.has(dep) && !topKeys.has(dep)) {
          orphans.push(`${name}: ${card.where} — "${f.key}" depends on "${dep}", which is nowhere`);
        }
      }
    }
  }
  assert.deepEqual(orphans, [], orphans.join('\n'));
});

/* ── the check itself works ───────────────────────────────────────────────── */

/* A test that passes on a manifest it should reject is worse than none, so the
   rule is exercised against a card that does break it. */
test('the check catches a card where everything is conditional', () => {
  const bad = {
    fields: [
      { key: 'mode', type: 'select', showIf: { field: 'other', equals: 'x' } },
      { key: 'url', type: 'text', showIf: { field: 'mode', equals: 'a' } },
    ],
  };
  const card = cards(bad)[0];
  assert.ok(!card.fields.some(f => !f.showIf), 'this card has no unconditional field');
  assert.equal(visibleFieldKeys(card.fields, () => undefined).size, 0, 'and opens empty');
});

test('the check accepts a card with a selector', () => {
  const good = {
    fields: [
      { key: 'provider', type: 'select' },
      { key: 'url', type: 'text', showIf: { field: 'provider', equals: 'a' } },
    ],
  };
  const card = cards(good)[0];
  assert.ok(card.fields.some(f => !f.showIf));
  assert.ok(visibleFieldKeys(card.fields, () => undefined).size > 0);
});

/* ── the form does hide individual fields ─────────────────────────────────── */

/* The hiding itself works and is not what was in question. */
test('a field is hidden when its condition is not met', () => {
  const fields = [
    { key: 'provider', type: 'select' },
    { key: 'dupUrl', type: 'text', showIf: { field: 'provider', equals: 'duplicati' } },
  ];
  const shown = visibleFieldKeys(fields, k => (k === 'provider' ? 'kopia' : undefined));
  assert.ok(shown.has('provider'));
  assert.ok(!shown.has('dupUrl'));
});

test('the form applies that to the rendered rows', () => {
  const src = fs.readFileSync(path.join(root, 'js/widget-config-form.js'), 'utf8');
  assert.match(src, /b\.el\.style\.display = shown\.has\(b\.field\.key\) \? '' : 'none'/);
});
