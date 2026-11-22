/* The behaviour the rate drives inside a widget is covered in
   widget-toolbox-poll.test.mjs. */

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolbox = fs.readFileSync(path.join(root, 'js/widget-toolbox.js'), 'utf8');

const dom = installDom({ markup: pageBody('index.html') });
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createPager } = await import('../js/dashboard-pager.js');
const strip = dom.document.getElementById('pages');
strip.innerHTML = '<div class="page"></div><div class="page"></div><div class="page"></div>';

/** A widget frame on page `n` that records the rates it is told. */
function frame(n) {
  const ifr = dom.document.createElement('iframe');
  const rates = [];
  ifr.contentWindow = { __setPollRate: r => rates.push(r) };
  strip.children[n].appendChild(ifr);
  return { ifr, rates };
}
const frames = [frame(0), frame(1), frame(2)];
const dash = createDashboardState();
dash.totalPages = 3;
const { goTo } = createPager(dash);
const qa = (node, sel) => Array.from(node.querySelectorAll(sel));

test('the toolbox exposes the rate hook the dashboard calls', () => {
  assert.match(toolbox, /window\)\.__setPollRate = setPollRate/);
});

test('a page change runs the shown page at full rate and slows the others', () => {
  goTo(1, false);
  assert.deepEqual(
    frames.map(f => f.rates.at(-1)),
    [4, 1, 4],
  );
  goTo(0, false);
  assert.deepEqual(
    frames.map(f => f.rates.at(-1)),
    [1, 4, 4],
  );
});

test('a frame that loads later is told its rate', () => {
  const late = frame(2);
  assert.deepEqual(late.rates, []);
  late.ifr.dispatchEvent({ type: 'load' });
  assert.deepEqual(late.rates, [4]);
});

test('a frame with no reachable window does not stop the others', () => {
  const ifr = dom.document.createElement('iframe');
  Object.defineProperty(ifr, 'contentWindow', {
    get() {
      throw new Error('navigating');
    },
  });
  strip.children[0].prepend(ifr);
  goTo(2, false);
  assert.equal(frames[2].rates.at(-1), 1);
});

test('a refreshing widget on a page out of view reloads at the slow rate and catches up on return', async () => {
  const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    goTo(0, false);
    const card = dom.document.createElement('div');
    strip.children[1].appendChild(card);
    mountScaledWidget(card, {
      src: 'http://svc/w',
      title: 'w',
      design: [400, 300],
      iframeOpts: { refreshInterval: 1000 },
    });
    const loaded = () => qa(card, 'iframe').length;
    goTo(0, false);
    mock.timers.tick(2500);
    assert.equal(loaded(), 1, 'an off-page widget reloaded at its full rate');
    goTo(1, false);
    assert.equal(loaded(), 2, 'a widget that missed its refresh did not catch up on return');
  } finally {
    teardownWidgets();
    mock.timers.reset();
  }
});
