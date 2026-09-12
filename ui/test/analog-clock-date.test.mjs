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
  assert.match(src, /for\(const n of _dateTexts\) n\.textContent=d;/);
});
