/* The date sits under the hands. Source-shape test: the face is drawn in an
   SVG that needs a browser. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../widgets/clock/analog.html', import.meta.url), 'utf8');

test('the plain date is drawn before any disc', () => {
  assert.ok(src.indexOf('dateOf(null);') < src.indexOf("face.appendChild(discOf('minute'"));
});

test('each disc repeats the date clipped to itself, before the next disc', () => {
  const order = [
    "face.appendChild(discOf('minute',{ fill:DISC.minute.color }));",
    'dateOf(inMinute);',
    "face.appendChild(discOf('hour',{ fill:DISC.hour.color }));",
    'dateOf(inHour);',
    "face.appendChild(discOf('second',{ fill:DISC.second.color }));",
    'dateOf(inSecond);',
    "face.appendChild(tickOf('second'));",
  ].map(s => src.indexOf(s));
  assert.ok(!order.includes(-1), 'a step of the draw order is gone');
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
});

test('every copy of the date shows the same text', () => {
  assert.match(src, /for\(const t of _dateTexts\)\{ t\[key\]\.textContent=text;/);
});

/* Safari draws spaced SVG text one glyph at a time. Persian and Arabic letters
   then lose their joins and run in reverse. */
test('the date on the dial has no letter spacing', () => {
  assert.doesNotMatch(src.match(/\.face text \{[^}]*\}/)[0], /letter-spacing/);
});

test('a date wider than the dial moves to two lines after the weekday', () => {
  assert.match(src, /if\(w<=max\) return;\n\s*set\('weekday', d\.weekday, size\);\n\s*set\('date', d\.date, size\);/);
});

test('two lines still wider than the dial are scaled down to fit', () => {
  assert.match(src, /if\(widest<=max\) return;\n\s*set\('weekday', d\.weekday, size\*max\/widest\);/);
});

/* Safari reorders right-to-left text across tspans. */
test('each line of the date is its own text element', () => {
  assert.doesNotMatch(src, /el\('tspan'/);
  assert.match(src, /_dateTexts\.push\(\{ date:line\(0\), weekday:line\(/);
});
