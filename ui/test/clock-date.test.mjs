import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  clockDateFormatter,
  clockDateParts,
  clockDateWithYear,
  clockSettings,
  msToNextMinute,
  twoDigits,
  zoneOk,
  zoneTime,
} from '../js/clock-date.js';

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

test("the zone time holds inside the browser zone's spring-forward gap", () => {
  const saved = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const t = zoneTime('Europe/London')(new Date('2026-03-29T01:30:00Z'));
    assert.deepEqual(t, { hours: 2, minutes: 30, seconds: 0 });
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('midnight in a zone reads as hour 0', () => {
  assert.equal(zoneTime('UTC')(new Date('2026-10-26T00:05:00Z')).hours, 0);
});

test("the dates follow the clock's zone, not the browser's", () => {
  const d = new Date('2026-10-26T20:00:00Z');
  assert.equal(clockDateWithYear('en', 'Asia/Tokyo')(d), 'October 27, 2026');
  assert.equal(clockDateFormatter('en', 'short', 'Asia/Tokyo')(d), 'Tue, Oct 27');
  assert.equal(clockDateParts('fa', 'long', true, 'Asia/Tokyo')(d).date, '۵ آبان ۲۵۸۵');
});

test('the next minute counts the milliseconds already gone', () => {
  assert.equal(msToNextMinute(new Date(Date.UTC(2026, 10, 13, 10, 15, 42, 750))), 17250);
  assert.equal(msToNextMinute(new Date(Date.UTC(2026, 10, 13, 10, 15, 59, 999))), 1);
  assert.equal(msToNextMinute(new Date(Date.UTC(2026, 10, 13, 10, 16, 0, 0))), 60000);
});

test('an unknown zone is caught before any formatter runs', () => {
  assert.equal(zoneOk(''), true);
  assert.equal(zoneOk('Europe/Berlin'), true);
  assert.equal(zoneOk('Berlin'), false);
});

test('clock figures keep two digits in the language digits', () => {
  assert.equal(twoDigits('en')(7), '07');
  assert.equal(twoDigits('fa')(7), '۰۷');
  assert.equal(twoDigits('not a tag!')(7), '07');
});

test('clock settings fall back to the defaults when the config cannot be read', async () => {
  assert.deepEqual(
    await clockSettings(async () => ({ widgetConfig: { clockTimezone: 'Asia/Tokyo', clockShowDate: false } })),
    {
      timeZone: 'Asia/Tokyo',
      showDate: false,
    },
  );
  assert.deepEqual(await clockSettings(() => Promise.reject(new Error('config HTTP 500'))), {
    timeZone: '',
    showDate: true,
  });
});
