/* Regression tests for P9-6 and P9-7: unguarded postMessage handlers.

   The dashboard listened for `message` with no origin check, so any window
   holding a handle on it could post {type:'widget-active'} and drive it. The
   widget side posted with target '*', addressing the message to whatever parent
   happened to be there, and its own listener was likewise unchecked.

   Impact is small: the protocol only resets interior widget state, and after the
   frame-ancestors fix the parent is always same-origin. But an unguarded handler
   states the wrong intent, and these are asserted as source text because both
   ends are inline script in a page with no test harness. The general fix for that
   is chore/typecheck-pure-frontend-modules. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const UI = 'js/ui.js';
const WIDGET = 'widgets/stats/disk-health.html';

test('every message listener checks the origin', () => {
  for (const f of [UI, WIDGET]) {
    const src = read(f);
    const listeners = [...src.matchAll(/addEventListener\(\s*'message'\s*,\s*(?:async\s*)?(\w+|\([^)]*\)|\w+\s*=>)/g)];
    assert.ok(listeners.length > 0, `${f} should still have a message listener`);
    for (const m of listeners) {
      /* The check must be inside the handler body, near its start. */
      const body = src.slice(m.index, m.index + 400);
      assert.match(body, /e\.origin !== window\.location\.origin/,
        `a message listener in ${f} does not check e.origin`);
    }
  }
});

test('nothing posts to a wildcard target origin', () => {
  for (const f of [UI, WIDGET]) {
    assert.doesNotMatch(read(f), /postMessage\([^)]*,\s*['"]\*['"]\s*\)/,
      `${f} still posts to '*'`);
  }
});

test('the widget addresses its own origin', () => {
  assert.match(read(WIDGET), /postMessage\(\{ type:'widget-active' \}, window\.location\.origin\)/);
});

test('the protocol itself is unchanged, so widgets keep working', () => {
  assert.match(read(WIDGET), /window\.__clearActive = /);
  assert.match(read(WIDGET), /type === 'widget-clear'/);
  assert.match(read(UI), /type === 'widget-active'/);
});
