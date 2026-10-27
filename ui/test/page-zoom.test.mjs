import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const script = read('../js/page-zoom.js');

/** Runs page-zoom.js against a stand-in page. */
/** Runs page-zoom.js against a stand-in page. `pinch` is the zoom on top of the
    page zoom: it raises the scale and narrows the visual viewport. */
function page({ width, scale }) {
  const props = new Map();
  const listeners = [];
  const root = { clientWidth: width, style: { setProperty: (k, v) => props.set(k, v) } };
  const vv = { scale, width, addEventListener: (type, fn) => type === 'resize' && listeners.push(fn) };
  const window = { visualViewport: vv, addEventListener: (type, fn) => type === 'resize' && listeners.push(fn) };
  vm.runInNewContext(script, { window, document: { documentElement: root } });
  let zoom = scale;
  return {
    props,
    resize({ width: w = root.clientWidth, scale: s = zoom, pinch = 1 }) {
      zoom = s;
      root.clientWidth = w;
      vv.scale = s * pinch;
      vv.width = w / pinch;
      for (const fn of listeners) fn();
    },
  };
}

test('at 100% the insets are used as reported', () => {
  assert.equal(page({ width: 393, scale: 1 }).props.get('--inset-scale'), '1');
});

test('at 50% page zoom each inset doubles', () => {
  assert.equal(page({ width: 786, scale: 0.5 }).props.get('--inset-scale'), '2');
});

test('at 150% page zoom each inset shrinks to two thirds', () => {
  assert.equal(Number(page({ width: 568, scale: 1.5 }).props.get('--inset-scale')).toFixed(4), '0.6667');
});

test('a pinch leaves the insets alone', () => {
  const p = page({ width: 393, scale: 1 });
  p.resize({ pinch: 2.5 });
  assert.equal(p.props.get('--inset-scale'), '1');
});

test('turning the phone while pinched waits for the pinch to end', () => {
  const p = page({ width: 393, scale: 1 });
  p.resize({ pinch: 2 });
  p.resize({ width: 852, pinch: 2 });
  assert.equal(p.props.get('--inset-scale'), '1');
  p.resize({ width: 852, pinch: 1 });
  assert.equal(p.props.get('--inset-scale'), '1');
});

test('turning the phone while pinched at 50% page zoom keeps the page zoom', () => {
  const p = page({ width: 786, scale: 0.5 });
  p.resize({ width: 1704, pinch: 3 });
  assert.equal(p.props.get('--inset-scale'), '2');
  p.resize({ width: 1704, pinch: 1 });
  assert.equal(p.props.get('--inset-scale'), '2');
});

test('a page zoom change after load is picked up', () => {
  const p = page({ width: 393, scale: 1 });
  p.resize({ width: 786, scale: 0.5 });
  assert.equal(p.props.get('--inset-scale'), '2');
});

test('a browser without visualViewport keeps the default', () => {
  const props = new Map();
  vm.runInNewContext(script, {
    window: {},
    document: { documentElement: { clientWidth: 393, style: { setProperty: (k, v) => props.set(k, v) } } },
  });
  assert.equal(props.size, 0);
});

test('the script is not a module', () => {
  assert.ok(!/\b(import|export)\b/.test(script));
});

test('both pages load it before their stylesheets', () => {
  for (const rel of ['../index.html', '../admin/index.html']) {
    const html = read(rel);
    const at = html.indexOf('/js/page-zoom.js');
    assert.ok(at > -1, `${rel} does not load page-zoom.js`);
    assert.ok(at < html.indexOf('rel="stylesheet"'), `${rel} loads page-zoom.js after a stylesheet`);
    assert.ok(!/page-zoom\.js[^>]*\b(defer|async|type="module")/.test(html));
  }
});

test('only the tokens read a safe-area inset directly', () => {
  const dir = fileURLToPath(new URL('../css/', import.meta.url));
  const direct = readdirSync(dir)
    .filter(f => f.endsWith('.css') && f !== 'tokens.css')
    .filter(f => /env\(safe-area-inset-/.test(readFileSync(dir + f, 'utf8')));
  assert.deepEqual(direct, [], 'use var(--safe-top) and its siblings, which follow the page zoom');
  const tokens = read('../css/tokens.css');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.ok(
      tokens.includes(`--safe-${side}: calc(env(safe-area-inset-${side}) * var(--inset-scale, 1));`),
      `--safe-${side} is missing or not scaled`,
    );
  }
});
