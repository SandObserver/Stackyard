import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clockDateFormatter, clockDateParts, clockDateWithYear } from '../js/clock-date.js';

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

test('a malformed Persian tag falls back instead of throwing', () => {
  assert.equal(
    clockDateFormatter('fa-', 'short')(at('2026-10-04')),
    clockDateFormatter('en', 'short')(at('2026-10-04')),
  );
});

test('both clock faces use the shared formatter', () => {
  for (const face of ['digital', 'analog', 'captain']) {
    const src = fs.readFileSync(new URL(`../widgets/clock/${face}.html`, import.meta.url), 'utf8');
    assert.match(src, /import\('\/js\/clock-date\.js\?v=[0-9a-f]+'\)/, face);
    assert.doesNotMatch(src, /new Intl\.DateTimeFormat\(_lang/, face);
  }
});

test('the parts split the date after the weekday', () => {
  assert.deepEqual(clockDateParts('fa', 'short')(at('2026-10-04')), {
    full: 'یکشنبه ۱۲ مهر ۲۵۸۵',
    weekday: 'یکشنبه',
    date: '۱۲ مهر ۲۵۸۵',
  });
  const en = clockDateParts('en', 'short')(at('2026-10-04'));
  assert.equal(en.full, clockDateFormatter('en', 'short')(at('2026-10-04')));
  assert.equal(en.weekday, 'Sun');
  assert.equal(en.date, 'Oct 4');
});

test('the parts can leave out the Persian year', () => {
  assert.deepEqual(clockDateParts('fa', 'short', false)(at('2026-10-04')), {
    full: 'یکشنبه ۱۲ مهر',
    weekday: 'یکشنبه',
    date: '۱۲ مهر',
  });
  assert.deepEqual(
    clockDateParts('en', 'short', false)(at('2026-10-04')),
    clockDateParts('en', 'short')(at('2026-10-04')),
  );
});

test('the date with its year reads in each language', () => {
  const d = at('2026-10-26');
  assert.equal(clockDateWithYear('en')(d), 'October 26, 2026');
  assert.equal(clockDateWithYear('de')(d), '26. Oktober 2026');
  assert.equal(clockDateWithYear('fr')(d), '26 octobre 2026');
  assert.equal(clockDateWithYear('es')(d), '26 de octubre de 2026');
  assert.equal(clockDateWithYear('zh-Hans')(d), '2026年10月26日');
  assert.equal(clockDateWithYear('fa')(d), '۴ آبان ۲۵۸۵');
});

test('the date with its year turns over at 1 January and at Nowruz', () => {
  assert.equal(clockDateWithYear('en')(at('2027-01-01')), 'January 1, 2027');
  assert.equal(clockDateWithYear('fa')(at('2027-03-20')), '۲۹ اسفند ۲۵۸۵');
  assert.equal(clockDateWithYear('fa')(at('2027-03-21')), '۱ فروردین ۲۵۸۶');
});

test('the date with its year falls back to English for an unknown language', () => {
  assert.equal(clockDateWithYear('not a tag')(at('2026-10-26')), 'October 26, 2026');
});
