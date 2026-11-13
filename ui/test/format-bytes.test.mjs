/* Sizes and transfer rates count in steps of 1000 and read in the reader's
   digits and unit words. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

async function withLocale(tag, fn, language) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { language: tag }, configurable: true });
  try {
    const mod = await import(`../js/format-number.js?locale=${encodeURIComponent(tag)}&lang=${language ?? ''}`);
    if (language) mod.setNumberLanguage(language);
    return fn(mod);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

test('1,500,000 bytes a second is 1.5 MB/s', async () => {
  await withLocale('en', ({ formatByteRate }) => {
    assert.equal(formatByteRate(1_500_000), '1.5 MB/s');
    assert.equal(formatByteRate(1_500_000, { fixed: true }), '1.5 MB/s');
    assert.equal(formatByteRate(2_000_000, { fixed: true }), '2.0 MB/s');
    assert.equal(formatByteRate(2_000_000), '2 MB/s');
  });
});

test('a unit starts at 1000 of the one below it', async () => {
  await withLocale('en', ({ formatBytes, formatByteRate }) => {
    assert.equal(formatByteRate(999, { min: 'kilobyte' }), '1 kB/s');
    assert.equal(formatBytes(999), '999 byte');
    assert.equal(formatBytes(1000), '1 kB');
    assert.equal(formatBytes(999_000), '999 kB');
    assert.equal(formatBytes(1_000_000), '1 MB');
    assert.equal(formatBytes(1e9), '1 GB');
    assert.equal(formatBytes(1e12), '1 TB');
  });
});

test('a figure that rounds up to 1000 moves to the next unit', async () => {
  await withLocale('en', ({ formatBytes, formatByteRate }) => {
    assert.equal(formatBytes(999_600), '1 MB');
    assert.equal(formatByteRate(999_999, { fixed: true }), '1.0 MB/s');
    assert.equal(formatBytes(999_600, { max: 'kilobyte' }), '1,000 kB');
  });
});

test('the unit range and the digits per unit are the caller’s', async () => {
  await withLocale('en', ({ formatBytes, byteScale }) => {
    assert.equal(formatBytes(20e6, { min: 'gigabyte' }), '0 GB');
    assert.equal(formatBytes(1500e12, { max: 'terabyte' }), '1,500 TB');
    const cap = { digits: (v, u) => (u === 'terabyte' && v < 10 ? 1 : 0) };
    assert.equal(formatBytes(4.5e12, cap), '4.5 TB');
    assert.equal(formatBytes(14.5e12, cap), '15 TB');
    assert.deepEqual(byteScale(2.5e9), { value: 2.5, unit: 'gigabyte', digits: 1 });
  });
});

test('the unit words follow the reader’s locale', async () => {
  await withLocale('fr-FR', ({ formatBytes, formatByteRate }) => {
    assert.equal(formatByteRate(1_500_000).replace(/\s/g, ' '), '1,5 Mo/s');
    assert.equal(formatBytes(2.5e9).replace(/\s/g, ' '), '2,5 Go');
  });
});

test('Persian chosen in Stackyard gets Persian digits in a size and a rate', async () => {
  await withLocale(
    'en-US',
    ({ formatBytes, formatByteRate }) => {
      assert.match(formatByteRate(1_500_000), /^۱٫۵ MB/);
      assert.match(formatBytes(2e12), /^۲ TB$/);
    },
    'fa',
  );
});

test('anything but a finite number is written as it came', async () => {
  await withLocale('en', ({ formatBytes, formatByteRate }) => {
    assert.equal(formatBytes(NaN), 'NaN');
    assert.equal(formatByteRate(Infinity), 'Infinity');
  });
});
