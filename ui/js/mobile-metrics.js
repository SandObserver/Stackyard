/* Every size must derive from sc. Raw px here, or CSS without var(--sc), breaks
   rendering at one physical size whatever page scale the browser reports. */

const BASE_VW = 393;

export function mobileMetrics(vw, vh, insetTop = 0, insetBottom = 0) {
  const sc = vw / BASE_VW;
  const sm = Math.round(18 * sc);
  const sb = Math.max(Math.round(insetTop), Math.round(18 * sc));
  const safe = Math.max(Math.round(insetBottom), Math.round(8 * sc));
  const dh = Math.round(108 * sc);
  const pillH = Math.round(34 * sc);
  const pillGap = Math.round(10 * sc);
  /* Reserving less lets the pill sit on top of the last row. */
  const dz = pillGap + pillH + Math.round(8 * sc);
  const avail = vh - sb - safe - dh - dz;
  return {
    sc,
    sm,
    sb,
    safe,
    dh,
    pillH,
    pillGap,
    dz,
    avail,
    rh: avail / 6,
    cw: (vw - sm * 2) / 4,
  };
}

export function pillBottom(m) {
  return m.safe + m.dh + m.pillGap;
}

/* Distance from the viewport bottom to the first pixel the grid may paint. */
export function contentBottom(m) {
  return m.safe + m.dh + m.dz;
}
