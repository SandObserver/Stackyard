import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clockDateFormatter } from '../js/clock-date.js';

const at = s => new Date(`${s}T12:00:00`);

test('Persian shows the Shahanshahi date with its year', () => {
  assert.equal(clockDateFormatter('fa', 'long')(at('2026-10-04')), 'یکشنبه ۱۲ مهر ۲۵۸۵');
  assert.equal(clockDateFormatter('fa', 'short')(at('2026-10-04')), 'یکشنبه ۱۲ مهر ۲۵۸۵');
});

test('the Shahanshahi year turns at Nowruz', () => {
  const fa = clockDateFormatter('fa', 'long');
  assert.equal(fa(at('2026-03-20')), 'جمعه ۲۹ اسفند ۲۵۸۴');
  assert.equal(fa(at('2026-03-21')), 'شنبه ۱ فروردین ۲۵۸۵');
});

test('other languages keep their Gregorian date with no year', () => {
  const d = at('2026-10-04');
  assert.equal(
    clockDateFormatter('en', 'short')(d),
    new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(d),
  );
  for (const lang of ['de', 'es', 'fr', 'zh-Hans']) {
    assert.doesNotMatch(clockDateFormatter(lang, 'long')(d), /2026|2585|1405/, lang);
  }
});

test('an unknown language falls back to English', () => {
  assert.equal(
    clockDateFormatter('not a tag', 'short')(at('2026-10-04')),
    clockDateFormatter('en', 'short')(at('2026-10-04')),
  );
});

test('both clock faces use the shared formatter', () => {
  for (const face of ['digital', 'analog']) {
    const src = fs.readFileSync(new URL(`../widgets/clock/${face}.html`, import.meta.url), 'utf8');
    assert.match(src, /await import\('\/js\/clock-date\.js\?v=[0-9a-f]+'\)/, face);
    assert.doesNotMatch(src, /new Intl\.DateTimeFormat\(_lang/, face);
  }
});
