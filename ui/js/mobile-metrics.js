/* Mobile layout metrics.
   Every size derives from sc, so the layout renders at one physical size no
   matter what page scale the browser reports through innerWidth. Anything
   sized in raw px here (or in CSS without var(--sc)) breaks that.

   insetTop/insetBottom are the real safe-area insets in px. Standalone reports
   the status bar and home indicator there, so the reserves match those exactly.
   Safari already excludes its toolbars from vh and reports 0 insets, so the
   reserves collapse to a small scaled gap instead of subtracting chrome twice. */

const BASE_VW = 393;

export function mobileMetrics(vw, vh, insetTop = 0, insetBottom = 0) {
  const sc = vw / BASE_VW;
  const sm = Math.round(18 * sc);
  const sb = Math.max(Math.round(insetTop), Math.round(18 * sc));
  const safe = Math.max(Math.round(insetBottom), Math.round(8 * sc));
  const dh = Math.round(108 * sc);
  const pillH = Math.round(34 * sc);
  const pillGap = Math.round(10 * sc);
  /* Bottom reserve below the dock: the pill's own gap and height, plus
     clearance. Reserving less lets the pill sit on top of the last row. */
  const dz = pillGap + pillH + Math.round(8 * sc);
  const avail = vh - sb - safe - dh - dz;
  return {
    sc, sm, sb, safe, dh, pillH, pillGap, dz, avail,
    rh: avail / 6,
    cw: (vw - sm * 2) / 4,
  };
}

/* Distance from the viewport bottom to the pill's bottom edge. */
export function pillBottom(m) { return m.safe + m.dh + m.pillGap; }

/* Distance from the viewport bottom to the first pixel the grid may paint. */
export function contentBottom(m) { return m.safe + m.dh + m.dz; }
