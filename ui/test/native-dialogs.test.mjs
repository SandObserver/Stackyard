/* No module may call the browser's confirm(), alert() or prompt(). Each blocks
   the page until it is dismissed, is drawn in the browser's language rather than
   the chosen one, and cannot be styled. modal.js answers all three.

   Blocking is the severe half: a native dialog stops every script on the page,
   which is what makes an automated session hang rather than fail. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const jsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

/* Comment spans as [start, end) offsets, so a match keeps its true line number
   and an unterminated comment runs to the end as a parser would read it. Not a
   tokenizer: a // inside a string reads as a comment here, which errs towards
   ignoring a match. */
function commentSpans(src) {
  const spans = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      spans.push([i, end === -1 ? src.length : end + 2]);
      i = end === -1 ? src.length : end + 1;
    } else if (src[i] === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      spans.push([i, end === -1 ? src.length : end]);
      i = end === -1 ? src.length : end;
    }
  }
  return spans;
}

/* Anchored so confirmModal, confirmText and a property named prompt do not
   match: the call has to be the bare global. */
const NATIVE = /(^|[^\w.$])(confirm|alert|prompt)\s*\(/g;

test('no module calls a native dialog', () => {
  const offenders = [];
  for (const f of fs.readdirSync(jsDir).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    const spans = commentSpans(src);
    const inComment = at => spans.some(([s, e]) => at >= s && at < e);

    NATIVE.lastIndex = 0;
    for (const m of src.matchAll(NATIVE)) {
      const at = m.index + m[1].length;
      if (inComment(at)) continue;
      const line = src.slice(0, at).split('\n').length;
      offenders.push(`${f}:${line}: ${m[2]}(`);
    }
  }
  assert.deepEqual(offenders, [], `Use modal.js instead. A native dialog blocks the page:\n${offenders.join('\n')}`);
});
