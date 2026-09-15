// @ts-check
/* Keep this module free of the DOM, of fetch and of module state. */

/** Whether the open dashboard should reload to pick up a config change. The
    field fingerprint is only a fallback for a page whose loaded copy predates
    `_rev`. It misses any field nobody listed.

    @param {any} loaded the config this page was built from
    @param {any} fetched what the poll just received
    @returns {boolean} */
export function configChanged(loaded, fetched) {
  if (!fetched || typeof fetched !== 'object') return false;
  if (fetched._rev != null && loaded?._rev != null) return fetched._rev !== loaded._rev;
  return fingerprint(fetched) !== fingerprint(loaded);
}

/** @param {any} c */
function fingerprint(c) {
  return JSON.stringify(c?.items?.map(i => `${i?.id}|${i?.label}|${i?.href}`)) + JSON.stringify(c?.settings);
}

/** The page index to open on, clamped to the pages that exist.

    @param {string|null} stored @param {number} totalPages @returns {number} */
/* Desktop tiles keep one size. A narrower window gets fewer columns. */
export const DESKTOP_COL = { width: 152.67, gap: 25, min: 4, max: 6 };

/** @param {number} avail the width the grid may take, in CSS px */
export function desktopCols(avail) {
  /* Half a pixel of slack: six 152.67px columns measure 1041.02px. */
  const fit = Math.floor((avail + DESKTOP_COL.gap + 0.5) / (DESKTOP_COL.width + DESKTOP_COL.gap));
  return Math.max(DESKTOP_COL.min, Math.min(DESKTOP_COL.max, fit));
}

/** Must match the sparse auto-placement of `.grid`, or a tile lands below the page.

    @template T
    @param {T[]} tiles in display order
    @param {(tile: T) => [number, number]} span columns and rows a tile takes
    @param {number} cols @param {number} rows
    @returns {T[][]} */
export function desktopPages(tiles, span, cols, rows) {
  /** @type {T[][]} */
  const pages = [];
  /** @type {T[]} */
  let cur = [];
  /** @type {boolean[][]} */
  let taken = [];
  let r = 0,
    c = 0;
  const free = (
    /** @type {number} */ row,
    /** @type {number} */ col,
    /** @type {number} */ w,
    /** @type {number} */ h,
  ) => {
    for (let y = row; y < row + h; y++) for (let x = col; x < col + w; x++) if (taken[y]?.[x]) return false;
    return true;
  };
  for (const tile of tiles) {
    const [sw, sh] = span(tile);
    const w = Math.min(Math.max(1, sw), cols);
    const h = Math.max(1, sh);
    const place = () => {
      for (;;) {
        for (; c + w <= cols; c++) if (free(r, c, w, h)) return r;
        r++;
        c = 0;
      }
    };
    let row = place();
    if (row + h > rows && cur.length) {
      pages.push(cur);
      cur = [];
      taken = [];
      r = 0;
      c = 0;
      row = place();
    }
    for (let y = row; y < row + h; y++) {
      taken[y] ??= [];
      for (let x = c; x < c + w; x++) taken[y][x] = true;
    }
    c += w;
    cur.push(tile);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function restorePage(stored, totalPages) {
  const n = Number(stored);
  if (stored == null || stored === '' || !Number.isInteger(n) || n < 0) return 0;
  if (!Number.isInteger(totalPages) || totalPages < 1) return 0;
  return Math.min(n, totalPages - 1);
}

/** Where to send the browser once first-run setup is finished.

    @param {unknown} items the dashboard items the page was built from
    @returns {string|null} a path to navigate to, or null to stay put */
export function landingAfterSetup(items) {
  return Array.isArray(items) && items.length === 0 ? '/admin' : null;
}
