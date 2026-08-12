// @ts-check
/* Spread repeated timers, so several pollers started together do not keep
   firing on the same tick. Keep it dependency-free: it is imported inside
   widget frames as well as by the dashboard. */

const SPREAD = 0.15;

/** A delay within ±15% of `base`.
    @param {number} base milliseconds @returns {number} */
export function jitter(base) {
  const n = Number(base);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * (1 + (Math.random() * 2 - 1) * SPREAD));
}
