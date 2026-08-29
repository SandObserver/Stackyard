import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const preload = read('../js/mobile-class.js');
const layout = read('../js/layout.js');
const adminHtml = read('../admin/index.html');

test('the preload script repeats the layout rule exactly', () => {
  /* Read the width from layout.js rather than pin it here, so the two files
     stay compared with each other when the cutoff moves. */
  const width = layout.match(/MOBILE_QUERY = '(\(max-width:\d+px\))'/);
  assert.ok(width, 'layout.js no longer declares MOBILE_QUERY as a width query');
  for (const literal of [`'${width[1]}'`, "'(orientation:portrait)'", '/iPhone|iPod|Android/i']) {
    assert.ok(layout.includes(literal), `layout.js no longer contains ${literal}`);
    assert.ok(preload.includes(literal), `mobile-class.js no longer contains ${literal}`);
  }
});

test('the preload script is not a module', () => {
  assert.ok(!/\b(import|export)\b/.test(preload));
});

test('admin loads the preload script before its stylesheets', () => {
  const script = adminHtml.indexOf('/js/mobile-class.js');
  const stylesheet = adminHtml.indexOf('rel="stylesheet"');
  assert.ok(script > -1, 'admin/index.html does not load mobile-class.js');
  assert.ok(script < stylesheet);
  assert.ok(!/mobile-class\.js[^>]*\b(defer|async|type="module")/.test(adminHtml));
});
