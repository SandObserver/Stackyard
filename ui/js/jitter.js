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

/** @param {() => unknown} fn @param {number} base milliseconds
    @returns {() => void} stops the loop */
export function repeatJittered(fn, base) {
  let handle;
  let stopped = false;
  const tick = async () => {
    try {
      await fn();
    } catch {}
    /* A stop during a call in flight must hold, or every stop leaks a loop. */
    if (!stopped) handle = setTimeout(tick, jitter(base));
  };
  handle = setTimeout(tick, Math.round(Math.random() * base));
  return () => {
    stopped = true;
    clearTimeout(handle);
  };
}
