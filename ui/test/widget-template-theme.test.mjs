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

/* A copied widget starts from these. Each one is the shared way to do it. */
test('the widget template loads its catalog before it draws', () => {
  const load = page.indexOf('await loadStrings()');
  assert.ok(load > -1, 'loadStrings is not awaited');
  assert.ok(load < page.indexOf('poll({'), 'the catalog loads after polling starts');
  assert.match(page, /wt\('ui\.caption', 'Total'\)/);
});

test('the widget template reports failures through the shared error state and ctx.fail', () => {
  assert.match(page, /errorState\(\{/);
  assert.match(page, /state\.fail\(error/);
  const data = fs.readFileSync(new URL('../../docs/widget-template/data.js', import.meta.url), 'utf8');
  assert.match(data, /ctx\.fail\([^)]*kind: ctx\.KIND\.INVALID/);
});

test('the widget template opens its link through linkTo', () => {
  assert.match(page, /linkTo\(root, data\.link\)/);
});
