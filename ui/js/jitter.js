// @ts-check
/* Keep this module free of imports. It is loaded inside widget frames. */

const SPREAD = 0.15;

/** A delay within ±15% of `base`.
    @param {number} base milliseconds @returns {number} */
export function jitter(base) {
  const n = Number(base);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * (1 + (Math.random() * 2 - 1) * SPREAD));
}
