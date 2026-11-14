/* A span of time reads in the reader's digits and unit words, two units at most. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

async function withLocale(tag, fn, language) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  try {
    const mod = await import(`../js/format-number.js?duration=${encodeURIComponent(tag)}&lang=${language ?? ''}`);
    if (language) mod.setNumberLanguage(language);
    return fn(mod);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

test('the two largest units are shown, and a zero second unit is left out', async () => {
  await withLocale('en', ({ formatDuration }) => {
    assert.equal(formatDuration(3 * 1440 + 4 * 60 + 7), '3 days 4 hr');
    assert.equal(formatDuration(3 * 1440), '3 days');
    assert.equal(formatDuration(5 * 60 + 12), '5 hr 12 min');
    assert.equal(formatDuration(120), '2 hr');
    assert.equal(formatDuration(8), '8 min');
    assert.equal(formatDuration(0), '0 min');
  });
});

test('part fractions and negative spans are floored to whole minutes', async () => {
  await withLocale('en', ({ formatDuration }) => {
    assert.equal(formatDuration(8.9), '8 min');
    assert.equal(formatDuration(-5), '0 min');
  });
});

test('unit words come from the locale, not from English', async () => {
  await withLocale('de', ({ formatDuration }) => {
    assert.equal(formatDuration(3 * 1440 + 4 * 60), '3 Tg. 4 Std.');
  });
  await withLocale(
    'fa',
    ({ formatDuration }) => {
      assert.doesNotMatch(formatDuration(3 * 1440 + 4 * 60), /[a-z]/i);
    },
    'fa',
  );
});

test("each unit passes through the caller's wrapper", async () => {
  await withLocale('en', ({ formatDuration }) => {
    assert.equal(
      formatDuration(65, 'long', s => `[${s}]`),
      '[1 hour] [5 minutes]',
    );
  });
});

test('a narrow unit written in Latin letters falls back to the short unit word', async () => {
  await withLocale(
    'fa',
    ({ formatDuration }) => {
      assert.equal(formatDuration(4 * 60 + 7, 'narrow'), formatDuration(4 * 60 + 7, 'short'));
      assert.doesNotMatch(formatDuration(4 * 60 + 7, 'narrow'), /[a-z]/i);
    },
    'fa',
  );
  await withLocale('en', ({ formatDuration }) => {
    assert.equal(formatDuration(4 * 60 + 7, 'narrow'), '4h 7m');
  });
  await withLocale('zh-Hans', ({ formatDuration }) => {
    assert.equal(formatDuration(4 * 60 + 7, 'narrow'), '4小时 7分钟');
  });
});

test('unit words follow the interface language, not the browser language', async () => {
  await withLocale(
    'en-US',
    ({ formatDuration }) => {
      assert.equal(formatDuration(3 * 1440 + 4 * 60), '۳ روز ۴ ساعت');
      assert.equal(formatDuration(4 * 60 + 7, 'narrow'), '۴ ساعت ۷ دقیقه');
    },
    'fa',
  );
  await withLocale(
    'en-US',
    ({ formatDuration }) => {
      assert.equal(formatDuration(3 * 1440 + 4 * 60), '3 Tg. 4 Std.');
    },
    'de',
  );
  await withLocale(
    'fa-IR',
    ({ formatDuration }) => {
      assert.equal(formatDuration(3 * 1440 + 4 * 60), '3 days 4 hr');
    },
    'en',
  );
});

test('without a usable interface language, unit words follow the browser language', async () => {
  await withLocale('de', ({ formatDuration }) => {
    assert.equal(formatDuration(3 * 1440 + 4 * 60), '3 Tg. 4 Std.');
  });
  await withLocale(
    'de',
    ({ formatDuration }) => {
      assert.equal(formatDuration(3 * 1440 + 4 * 60), '3 Tg. 4 Std.');
    },
    'not a language',
  );
  await withLocale('not a language', ({ formatDuration }) => {
    assert.equal(formatDuration(3 * 1440 + 4 * 60), '3 days 4 hr');
  });
});
