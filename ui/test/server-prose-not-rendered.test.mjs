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

/* Reading the field is fine; putting it on screen is not. A translated
   sentence, or a ShownError, counts as on screen. */
const RENDERS = /\.textContent\s*=|setHtml\(|setUserText\(|toast\(|\bt\(|ShownError\(/;
/* An Error from the fetch wrapper carries the field as its message. */
const SERVER_TEXT = /\b\w+\s*\??\.\s*(?:error|message)\b/;

/* Keys that legitimately name the field while building a request or a log. */
const READS_ONLY = /log\.|console\.|JSON\.stringify/;

/* One statement per entry, so a call wrapped over several lines is read whole. */
function statements(src) {
  return src.split(/;\s*\n|(?:\)|=>|else|try)\s*\{\s*\n|^\s*\}.*\n/m);
}

function offendersIn(src, file) {
  return statements(src).flatMap(stmt => {
    const code = stmt.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    if (!RENDERS.test(code) || !SERVER_TEXT.test(code)) return [];
    if (READS_ONLY.test(code)) return [];
    return [`${file}: ${stmt.trim().replace(/\s+/g, ' ')}`];
  });
}

const offendingLines = file => offendersIn(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), file);

test('the check sees a thrown, chained or wrapped render of the server text', () => {
  const forms = [
    "  throw new ShownError(t('k', { err: e.message }));\n",
    "  p.catch(x => toast(t('k', { err: x.message })));\n",
    "  toast(\n    t('k', {\n      err: failure.error,\n    }),\n    'err',\n  );\n",
    "  st.textContent = '✗ ' + res.error;\n",
  ];
  for (const src of forms) assert.equal(offendersIn(src, 'probe.js').length, 1, src);
  assert.deepEqual(offendersIn("  toast(t('toast.error', { err: errorText(e) }), 'err');\n", 'probe.js'), []);
});

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
