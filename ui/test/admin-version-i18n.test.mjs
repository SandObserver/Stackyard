import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The About version line is translated, so it cannot be written before the
   catalogs are loaded.

   initVersion() ran from the module's startup block, which begins before
   checkAuth(load) resolves. Its /api/version response arrived first, t() found
   no catalog, and the About panel showed the key name instead of the version.
   The call now sits inside load(), after initI18n() has awaited. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8'));

test('initVersion runs after the catalogs load, never from the startup block', () => {
  const calls = [...src.matchAll(/^(\s*)initVersion\(\);$/gm)];
  assert.equal(calls.length, 1, 'initVersion is called exactly once');
  assert.notEqual(calls[0][1], '', 'a top-level call races the catalog fetch');
  const load = src.slice(src.indexOf('async function load()'));
  assert.ok(
    load.indexOf('await initI18n(') < load.indexOf('initVersion()'),
    'initVersion is called before initI18n is awaited',
  );
});

test('both forms of the version line come from the catalog', () => {
  assert.equal(en.about.version, 'Version v{v}');
  assert.equal(en.about.updateTo, 'Update to v{v}');
  const fn = src.slice(src.indexOf('async function initVersion()'), src.indexOf('function initSecToggle()'));
  assert.doesNotMatch(fn, /html`Version |>Update to /, 'the update line is hardcoded English again');
});
