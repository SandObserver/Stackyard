/* Every size must derive from sc. Raw px here, or CSS without var(--sc), breaks
   rendering at one physical size whatever page scale the browser reports.

   Safe-area insets are not here. The stylesheet holds them, and the layout
   measures the box the stylesheet produced. The platform reports an inset after the
   first paint, so a value read into JavaScript is stale from the moment it is
   taken. */

const BASE_VW = 393;

export function mobileMetrics(vw) {
  const sc = vw / BASE_VW;
  const sm = Math.round(18 * sc);
  const dh = Math.round(108 * sc);
  const pillH = Math.round(34 * sc);
  const pillGap = Math.round(10 * sc);
  /* Reserving less lets the pill sit on top of the last row. */
  const dz = pillGap + pillH + Math.round(8 * sc);
  return { sc, sm, dh, pillH, pillGap, dz };
}

/* Both are distances above the bottom safe-area inset, which CSS adds. */

export function pillBottom(m) {
  return m.dh + m.pillGap;
}

/* Distance from the reserved bottom to the first pixel the grid may paint. */
export function contentBottom(m) {
  return m.dh + m.dz;
}
