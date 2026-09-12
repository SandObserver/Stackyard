/* Source-shape tests: the layouts are built against a real viewport, which is
   not available here. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dash = read('js/dashboard.js');
const ui = read('js/ui.js');

test('the phone layout rebuilds when the width changes, not the height', () => {
  const handler = dash.slice(dash.indexOf("window.addEventListener('resize'"));
  const mob = handler.slice(0, handler.indexOf('if (MOB) return;'));
  assert.match(mob, /if \(MOB && innerWidth !== _mw\) buildLayout\(\);/, 'a keyboard opening must not rebuild');
  assert.match(dash, /const buildLayout = \(\) => \{\s*_mw = innerWidth;/, 'the width must be recorded at every build');
});

test('the desktop build clears what the phone build left on the dock and pill', () => {
  const build = dash.slice(dash.indexOf('function buildDesktop()'), dash.indexOf('const pages = paginate();'));
  assert.match(build, /resetMobileChrome\(\);/);
  const reset = ui.slice(ui.indexOf('export function resetMobileChrome()'));
  assert.match(reset, /dk\.className = '';/);
  assert.match(reset, /dk\.style\.cssText = '';/);
  assert.match(reset, /pill\.style\.cssText = '';/);
  assert.match(reset, /removeEventListener\('touchend', _mobTeCleanup\)/, 'the phone swipe would page twice');
});
