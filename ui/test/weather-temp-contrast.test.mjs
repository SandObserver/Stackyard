import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const page = fs.readFileSync(new URL('../widgets/weather/index.html', import.meta.url), 'utf8');
const source = /function tempColor\([\s\S]*?\n\}/.exec(page)?.[0];
const tempColor = new Function(`${source}; return tempColor;`)();

function rgbOfHsl(value) {
  const [h, s, l] = /hsl\((\d+),(\d+)%,(\d+)%\)/.exec(value).slice(1).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = n => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const luminance = rgb =>
  rgb
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

/* The reading is large bold text, so 1.4.3 asks for 3:1. */
for (const [card, lightCard, bg] of [
  ['day', true, 1],
  ['night', false, luminance([28 / 255, 28 / 255, 30 / 255])],
]) {
  test(`every temperature clears 3:1 on the ${card} card`, () => {
    assert.ok(source, 'tempColor is not in the weather page');
    const failures = [];
    for (let c = -40; c <= 50; c += 0.5) {
      const fg = luminance(rgbOfHsl(tempColor(c, 'c', lightCard)));
      const r = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (r < 3) failures.push(`${c} °C: ${r.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });
}
