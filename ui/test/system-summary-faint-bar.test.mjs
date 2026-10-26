import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const html = fs.readFileSync(new URL('../widgets/system-summary/index.html', import.meta.url), 'utf8');
const toolbox = fs.readFileSync(new URL('../js/widget-toolbox.js', import.meta.url), 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

/** @param {string} selector */
function declarations(selector) {
  const out = {};
  for (const m of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map(s => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
}

test('a faint bar is sized by width and does not slide', () => {
  const d = declarations('.faint .tb-bar-fill');
  assert.equal(d.width, 'var(--tb-pct)');
  assert.equal(d.transform, 'none');
});

test('a faint bar animates its width with the toolbox duration and curve', () => {
  assert.equal(
    declarations('.faint .tb-bar-fill')['transition-property'],
    'width !important',
    'the inline transition from barFill names transform, so only the property is replaced',
  );
});

test('a faint bar keeps its edge ring', () => {
  assert.match(declarations('.faint .tb-bar-fill')['box-shadow'] ?? '', /^inset 0 0 0 1px /);
});

test('other bars still slide by transform', () => {
  assert.match(toolbox, /\.tb-bar-fill\{transform:translateX\(calc\(var\(--tb-pct\) - 100%\)\)\}/);
  assert.match(toolbox, /transition:transform \.4s/);
  assert.deepEqual(
    Object.keys(declarations('.tb-bar-fill')).filter(k => /width|transform|transition/.test(k)),
    [],
    'no page rule outside .faint changes how a bar moves',
  );
});
