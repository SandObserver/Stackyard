import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { SETTINGS, SERVER, TOP } = await import('../js/settings-schema.js');
const { GENERAL_SERVER_FIELDS, GENERAL_TOP_FIELDS, applyGeneralFields, generalServerFields, planFieldSave } =
  await import('../js/admin-save-logic.js');

/* admin-settings.js needs a DOM to import, so its field list is read from source. */
const formKeys = () => {
  const src = readFileSync(new URL('../js/admin-settings.js', import.meta.url), 'utf8');
  const body = src.match(/const readGeneralFields = \(\) => \(\{([\s\S]*?)\n\}\);/)?.[1];
  assert.ok(body, 'readGeneralFields was not found');
  return [...body.matchAll(/^\s+([A-Za-z]+):/gm)].map(m => m[1]);
};

test('every field the General form reads is a General key in the schema', () => {
  const keys = formKeys();
  assert.ok(keys.length > 0);
  assert.deepEqual([...keys].sort(), [...GENERAL_SERVER_FIELDS, ...GENERAL_TOP_FIELDS].sort());
  for (const key of keys) {
    const spec = SETTINGS.find(s => s.key === key && s.general);
    assert.ok(spec, `${key} is not a General key in the schema`);
  }
});

test('each General field is written in the place the schema names', () => {
  for (const key of formKeys()) {
    const settings = { server: {} };
    applyGeneralFields(settings, [key], { [key]: 'v' });
    const place = SETTINGS.find(s => s.key === key)?.place;
    if (place === TOP) assert.deepEqual(settings, { [key]: 'v', server: {} }, key);
    else {
      assert.equal(place, SERVER, key);
      assert.deepEqual(settings, { server: { [key]: 'v' } }, key);
    }
  }
});

test('a General field changed here and on the server is a conflict, for every field', () => {
  for (const key of formKeys()) {
    const place = SETTINGS.find(s => s.key === key)?.place;
    const stored = v => (place === TOP ? { [key]: v, server: {} } : { server: { [key]: v } });
    const serverBase = generalServerFields(stored('a'));
    const server = generalServerFields(stored('b'));
    const formBase = { ...serverBase };
    const form = { ...formBase, [key]: 'c' };
    assert.deepEqual(planFieldSave({ formBase, form, serverBase, server }), { changed: [key], conflicts: [key] }, key);
  }
});
