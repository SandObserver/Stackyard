/* Regression test for the config export, which could not report a failure.

   The export set an anchor's href to /api/config/export and clicked it, which
   hands the request to the browser. The page then never learns the outcome: a
   refusal, a server error or an expired session was written to disk as an error
   body under the backup's own filename, and the try/catch around the click
   could not observe any of it. The failure surfaces when the backup is needed,
   which is the worst moment to find out.

   Fetching it instead means the response is checked before anything is saved,
   and going through `ag` means an expired session raises the sign-in box and
   the export finishes afterwards.

   Scanned from the source rather than driven, because the download itself is
   browser machinery: what matters is which of the two routes the code takes. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');

/* The handler only, so an unrelated mention of the endpoint elsewhere in the
   file cannot pass or fail this. */
function exportHandler() {
  const start = admin.indexOf("el('btn-exp').onclick");
  assert.notEqual(start, -1, 'the export handler moved; this test needs updating');
  const end = admin.indexOf("el('imp').onchange", start);
  assert.notEqual(end, -1, 'the export handler moved; this test needs updating');
  return admin.slice(start, end);
}

test('the export never reaches the endpoint by navigating to it', () => {
  const body = exportHandler();
  assert.ok(
    !/\.href\s*=\s*[^;]*\/api\/config\/export/.test(body),
    'assigning the endpoint to an href hands the request to the browser, which cannot report a failure',
  );
});

test('the export goes through the shared helper, so a failure is visible', () => {
  const body = exportHandler();
  assert.match(
    body,
    /await ag\(\s*'\/api\/config\/export'\s*\)/,
    'the response has to be checked before anything is saved',
  );
});

test('the export reports a failure it can now see', () => {
  assert.match(exportHandler(), /toast\(\s*t\('toast\.exportFailed'/);
});

test('the object URL is released rather than leaked', () => {
  const body = exportHandler();
  assert.match(body, /createObjectURL/);
  assert.match(body, /revokeObjectURL/, 'a blob URL held for the page lifetime pins the whole config in memory');
});

test('the download keeps the filename users already know', () => {
  assert.match(exportHandler(), /download\s*=\s*'stackyard-config\.json'/);
});
