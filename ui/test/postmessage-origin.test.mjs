/* The one message protocol between a widget and the dashboard.

   P9-6 and P9-7: both ends were unguarded. The dashboard listened for `message`
   with no origin check, so any window holding a handle on it could post
   {type:'widget-active'} and drive it, and the widget posted to '*', addressing
   whatever parent happened to be there.

   The protocol has one direction. A widget with an interior active state posts
   {type:'widget-active'} when it becomes active, and the dashboard resets every
   other widget. Resetting is a direct call to the widget's own
   window.__clearActive, since the frames are same-origin, so there is no message
   travelling the other way. A `widget-clear` listener survived in the disk
   widget for a while with nothing sending to it, which is the shape this now
   forbids: a receiver with no sender reads as a supported protocol.

   Asserted as source text because both ends are inline script in a page with no
   test harness. The rules are enforced over every widget page, not only the one
   that implements the protocol today, so a new widget copying the pattern is
   held to the same terms. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const UI = 'js/ui.js';
const WIDGETS = 'widgets';

/* Every widget page, so the rules below are not pinned to one widget. */
function widgetPages() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(p);
    }
  };
  walk(WIDGETS);
  return out;
}

const pages = widgetPages();
const MESSAGE_LISTENER = /addEventListener\(\s*'message'\s*,\s*(?:async\s*)?(\w+|\([^)]*\)|\w+\s*=>)/g;

test('the scan finds the widget pages', () => {
  assert.ok(pages.length > 10, `only ${pages.length} widget pages found`);
  assert.ok(pages.includes('widgets/stats/disk-health.html'),
    'the widget that implements the protocol should be in the scan');
});

/* ── the sending direction ────────────────────────────────────────────────── */

test('the dashboard listens for widget-active, and checks the origin', () => {
  const src = read(UI);
  assert.match(src, /type === 'widget-active'/, 'the dashboard no longer listens');
  const listeners = [...src.matchAll(MESSAGE_LISTENER)];
  assert.ok(listeners.length > 0);
  for (const m of listeners) {
    assert.match(src.slice(m.index, m.index + 400), /e\.origin !== window\.location\.origin/,
      'a message listener in ui.js does not check e.origin');
  }
});

test('a widget that posts, posts widget-active to its own origin', () => {
  const senders = pages.filter(p => /postMessage\(/.test(read(p)));
  assert.ok(senders.length > 0, 'no widget posts to the parent any more');
  for (const p of senders) {
    const src = read(p);
    assert.doesNotMatch(src, /postMessage\([^)]*,\s*['"]\*['"]\s*\)/, `${p} posts to '*'`);
    assert.match(src, /postMessage\(\{ type:'widget-active' \}, window\.location\.origin\)/,
      `${p} posts something other than widget-active to its own origin`);
  }
});

/* ── the resetting direction, which is a call and not a message ───────────── */

test('the dashboard resets a widget by calling its __clearActive', () => {
  assert.match(read(UI), /__clearActive\(\)/,
    'the dashboard no longer calls into the widget to reset it');
});

test('a widget that can go active exposes __clearActive', () => {
  for (const p of pages) {
    const src = read(p);
    if (!/postMessage\(\{ type:'widget-active' \}/.test(src)) continue;
    assert.match(src, /window\.__clearActive\s*=/,
      `${p} announces itself active but cannot be reset`);
  }
});

/* The rule the dead listener broke. A widget listening for a message nothing
   sends looks like a protocol a new widget should implement. */
test('no widget listens for a message the dashboard never sends', () => {
  const ui = read(UI);
  const offenders = [];
  for (const p of pages) {
    const src = read(p);
    if (!MESSAGE_LISTENER.test(src)) { MESSAGE_LISTENER.lastIndex = 0; continue; }
    MESSAGE_LISTENER.lastIndex = 0;
    for (const m of src.matchAll(/e\.data\.type === '([\w-]+)'/g)) {
      if (!ui.includes(`type: '${m[1]}'`) && !ui.includes(`type:'${m[1]}'`)) {
        offenders.push(`${p}: '${m[1]}'`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `Nothing in ui.js posts these. Remove the listener, or add the sender:\n  ${offenders.join('\n  ')}`);
});

test('a widget listener, if one is added back, checks the origin', () => {
  for (const p of pages) {
    const src = read(p);
    for (const m of src.matchAll(MESSAGE_LISTENER)) {
      assert.match(src.slice(m.index, m.index + 400), /e\.origin !== window\.location\.origin/,
        `a message listener in ${p} does not check e.origin`);
    }
  }
});

/* ── the contract is written down ─────────────────────────────────────────── */

test('docs/widgets.md documents the protocol a widget author has to implement', () => {
  const doc = fs.readFileSync(path.join(root, '..', 'docs', 'widgets.md'), 'utf8');
  /* Name-anchored, or a renamed hook still matches as a prefix. */
  assert.match(doc, /__clearActive\b/, 'the reset hook is not documented');
  assert.match(doc, /'widget-active'/, 'the message is not documented');
});
