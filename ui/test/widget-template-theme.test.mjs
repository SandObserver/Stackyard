import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const page = fs.readFileSync(new URL('../../docs/widget-template/index.html', import.meta.url), 'utf8');

/* The card is white in the light theme. A copied template with fixed light ink
   draws text nobody can read there. */
test('the widget template follows the dashboard theme', () => {
  const script = page.search(/<script src="\/js\/widget-theme\.js[^"]*"><\/script>/);
  assert.ok(script > -1 && script < page.indexOf('<style>'), 'widget-theme.js must load before the styles');
  assert.match(page, /html\[data-theme="light"\] body\s*\{[^}]*color:/);
});
