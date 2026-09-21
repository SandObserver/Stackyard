/* The API's `error` field is prose written for a log or a curl. It is never
   translated, so rendering it puts English on a screen in any language.

   This is a ratchet. The frontend reads `kind`, `code` and `detail` and writes
   every user-visible sentence itself. A render site that reaches for the
   server's own text reintroduces the defect, so any new one fails here. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

/* Reading the field is fine; putting it on screen is not. */
const RENDERS = /\.textContent\s*=|setHtml\(|setUserText\(|toast\(/;
const SERVER_TEXT = /\b(?:advice|err|error|e|res|body|data|j|r)\s*(?:\??\.)\s*error\b/;

/* Keys that legitimately name the field while building a request or a log. */
const READS_ONLY = /log\.|console\.|JSON\.stringify|catch|throw/;

function offendingLines(file) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  return src.split('\n').flatMap((line, i) => {
    if (!RENDERS.test(line) || !SERVER_TEXT.test(line)) return [];
    if (READS_ONLY.test(line)) return [];
    return [`${file}:${i + 1}: ${line.trim()}`];
  });
}

test('no render site puts the API error prose on screen', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const offenders = files.flatMap(offendingLines);
  assert.deepEqual(offenders, [], 'translate it: read kind/code/detail and write the sentence with t()');
});

/* The advice module is the one place that turns an API error into something to
   show, and it must not learn to pass prose through. */
test('admin-error.js never reads the server message', () => {
  const src = fs.readFileSync(path.join(JS_DIR, 'admin-error.js'), 'utf8');
  for (const field of ['.error', '.message', 'vouched']) {
    assert.equal(src.includes(field), false, `admin-error.js reads ${field}`);
  }
});

/* `tagged` rebuilds the API's error as an Error. A field it forgets is
   invisible: the advice falls back to the kind and the screen says something
   true but never the specific sentence. */
test('the fetch wrapper forwards every structured field the API sends', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { errorBody, KIND } = require('../../api/src/api-error.js');

  const emitted = Object.keys(
    errorBody(Object.assign(new Error('x'), { kind: KIND.UPSTREAM, detail: { status: 404 } })),
  );
  const src = fs.readFileSync(path.join(JS_DIR, 'admin-shared.js'), 'utf8');
  const tagged = src.slice(src.indexOf('function tagged('), src.indexOf('function tagged(') + 700);

  for (const field of emitted) {
    if (field === 'error') continue; /* prose, deliberately not carried onto the UI */
    assert.match(tagged, new RegExp(`body\\.${field}\\b`), `tagged() drops ${field}, so advice falls back to the kind`);
  }
});
