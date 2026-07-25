import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mobileMetrics, pillBottom, contentBottom } from '../js/mobile-metrics.js';

/* Page scale changes innerWidth, so these are the widths one phone can report. */
const WIDTHS = [320, 375, 393, 414, 430, 786, 1024];

test('the reserved bottom zone always clears the pill', () => {
  for (const vw of WIDTHS) {
    const m = mobileMetrics(vw, 852);
    const pillTop = pillBottom(m) + m.pillH;
    assert.ok(
      contentBottom(m) >= pillTop,
      `vw=${vw}: content may paint down to ${contentBottom(m)} but the pill reaches ${pillTop}`,
    );
  }
});

test('a 36px reserve is what let the pill overlap the last row', () => {
  const m = mobileMetrics(393, 852);
  const oldDz = Math.round(36 * m.sc);
  assert.ok(m.dz > oldDz);
  assert.ok(m.safe + m.dh + oldDz < pillBottom(m) + m.pillH);
});

test('sc is 1 at the base width and scales linearly', () => {
  assert.equal(mobileMetrics(393, 852).sc, 1);
  assert.equal(mobileMetrics(786, 1704).sc, 2);
});

test('every metric scales with sc', () => {
  const a = mobileMetrics(393, 852);
  const b = mobileMetrics(786, 852);
  for (const k of ['sm', 'sb', 'safe', 'dh', 'pillH', 'pillGap', 'dz']) {
    assert.equal(b[k], a[k] * 2, `${k} did not double`);
  }
});

test('avail shrinks as the reserve grows', () => {
  const m = mobileMetrics(393, 852);
  assert.equal(m.avail, 852 - m.sb - m.safe - m.dh - m.dz);
  assert.ok(m.avail > 0);
});

test('safe-area insets set the top and bottom reserves', () => {
  const m = mobileMetrics(393, 852, 59, 34);
  assert.equal(m.sb, 59);
  assert.equal(m.safe, 34);
});

test('reserves fall back to a scaled minimum when insets are zero', () => {
  const m = mobileMetrics(393, 695, 0, 0);
  assert.equal(m.sb, 18);
  assert.equal(m.safe, 8);
  const m2 = mobileMetrics(786, 695, 0, 0);
  assert.equal(m2.sb, 36);
  assert.equal(m2.safe, 16);
});

test('a smaller inset than the minimum does not shrink the reserve', () => {
  const m = mobileMetrics(393, 852, 4, 2);
  assert.equal(m.sb, 18);
  assert.equal(m.safe, 8);
});

test('cw fits four columns inside the side margins', () => {
  const m = mobileMetrics(393, 852);
  assert.equal(m.cw * 4 + m.sm * 2, 393);
});
