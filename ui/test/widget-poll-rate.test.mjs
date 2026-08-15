/* dashboard.js runs boot() at import, so the wiring is asserted against the
   source. The behaviour it drives is covered in widget-toolbox-poll.test.mjs. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dashboard = read('js/dashboard.js');
const toolbox = read('js/widget-toolbox.js');

test('the toolbox exposes the rate hook the dashboard calls', () => {
  assert.match(toolbox, /window\)\.__setPollRate = setPollRate/);
  assert.match(dashboard, /__setPollRate\?\.\(rate\)/);
});

test('every page change reapplies the rates', () => {
  const goTo = dashboard.slice(dashboard.indexOf('function goTo('));
  assert.match(goTo.slice(0, goTo.indexOf('\n}')), /applyPollRates\(\)/);
});

test('off-screen pages are slowed rather than left at full rate', () => {
  const m = /const OFF_PAGE_RATE = (\d+)/.exec(dashboard);
  assert.ok(m, 'no off-page rate defined');
  assert.ok(Number(m[1]) > 1, 'an off-page rate of 1 slows nothing');
});

/* A frame that loads after the page change would otherwise keep the rate it
   started with, which is the normal one. */
test('a frame that loads later is told its rate', () => {
  assert.match(dashboard, /addEventListener\('load', applyPollRates\)/);
});
