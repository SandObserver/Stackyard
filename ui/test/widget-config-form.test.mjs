import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const form = fs.readFileSync(new URL('../js/widget-config-form.js', import.meta.url), 'utf8');

test('the config rows draw the pencil from the icon set', () => {
  assert.doesNotMatch(form, /<svg/, 'a glyph drawn here ignores the chosen icon style');
  assert.match(form, /import \{[^}]*\bPE_SVG\b[^}]*\} from '\/js\/admin-shared\.js/);
  assert.equal(form.match(/raw\(PE_SVG\)/g)?.length, 2);
});

test('the Fetch row is built once, and every picker honours fetchLabel', () => {
  assert.equal(form.match(/t\('widgetCfg\.fetching'\)/g)?.length, 1);
  assert.equal(form.match(/await fetchFieldOptions\(field, ctx\)/g)?.length, 1);
  assert.doesNotMatch(form, /textContent = t\('widgetCfg\.fetch'\)/);
  assert.match(form, /btn\.textContent = field\.fetchLabel \|\| t\('widgetCfg\.fetch'\)/);
  for (const picker of ['_picklist', '_select']) {
    const start = form.indexOf(`function ${picker}(`);
    const body = form.slice(start, form.indexOf('\nfunction ', start + 1));
    assert.match(body, /_fetchRow\(field, ctx, /, picker);
  }
});

test('an option Fetch goes through the shared request path', () => {
  assert.doesNotMatch(form, /\bfetch\(/);
  assert.match(form, /await apiPost\(`\/api\/widget-options\//);
});
