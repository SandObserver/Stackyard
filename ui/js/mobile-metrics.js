/* Every size must derive from sc. A raw px here breaks rendering at one
   physical size whatever page scale the browser reports.

   Never read a safe-area inset into JavaScript: it is reported after the first
   paint, so the value is stale when it is taken. The stylesheet owns them. */

const BASE_VW = 393;

/* The grid answers a wider window with more cells, not with bigger ones, so the
   chrome around it must stop growing too. Phones scale up to the widest one;
   anything wider keeps the base size. */
const WIDEST_PHONE = 430;

const BASE_VH = 560;

const DOCK_ICON = 64;

/* Cell size at the design viewport, gap included. The grid keeps a cell near
   this and changes how many of them there are. */
export const BASE_CELL_W = 91.5;
export const BASE_CELL_H = 116.8;

/* Every footprint is declared in cells, and the tallest is 6 rows deep. Fewer
   rows than that and it can never be placed. */
const MIN_ROWS = 6;
const MIN_COLS = 4;

/* How many cells fit the measured box, keeping a cell near its design size.

   This is the grid-template equivalent of repeat(auto-fill, minmax()): the cell
   stays put and the count follows the box. Scaling a fixed count instead is what
   stretched four columns across a tablet and squeezed six into a phone.

   @param {{ gridW: number, gridH: number, sc: number, vw?: number, labels?: boolean }} o
   @returns {{ cols: number, rows: number }} */
export function gridCellCount({ gridW, gridH, sc, vw = 0, labels = true }) {
  const cols = Math.max(MIN_COLS, Math.round(gridW / (BASE_CELL_W * sc)));
  const cellH = vw > WIDEST_PHONE && !labels ? gridW / cols : BASE_CELL_H * sc;
  const rows = Math.max(MIN_ROWS, Math.round(gridH / cellH));
  return { cols, rows };
}

/** @param {number} vw @param {boolean} docked @param {number} [vh] */
export function mobileMetrics(vw, docked = true, vh = Infinity) {
  const sc = Math.min(vw > WIDEST_PHONE ? 1 : vw / BASE_VW, vh / BASE_VH);
  const sm = Math.round(18 * sc);
  const dh = docked ? Math.round(108 * sc) : 0;
  const pillH = Math.round(30 * sc);
  const pillGap = Math.round(10 * sc);
  /* Reserving less lets the pill sit on top of the last row. */
  const dz = pillGap + pillH + Math.round(8 * sc);
  return { sc, sm, dh, pillH, pillGap, dz };
}

/** @param {{ iconSz: number, sc: number }} o */
export function dockFit({ iconSz, sc }) {
  return Math.min(1, iconSz / Math.round(DOCK_ICON * sc));
}

/* One column width for the whole home grid.

   A card sized by width alone keeps its full width when its rows are too short,
   loses its aspect, and the scaled iframe is then drawn taller than the card and
   clipped. Narrowing every column by the same amount keeps a card's width
   proportional to its column span, so two small widgets still measure the same
   as one medium.

   @param {{ gridW: number, rowH: number, gap: number, cols: number,
             footprints: { design: [number, number], span: [number, number] }[] }} o
   @returns {number} */
export function gridColumnWidth({ gridW, rowH, gap, cols, footprints }) {
  const full = (gridW - gap * (cols - 1)) / cols;
  let k = full;
  for (const { design, span } of footprints || []) {
    const [sc, sr] = span;
    const cellH = rowH * sr + gap * (sr - 1);
    k = Math.min(k, ((cellH * design[0]) / design[1] - gap * (sc - 1)) / sc);
  }
  return Math.max(0, Math.floor(k));
}

/* Both are distances above the bottom safe-area inset, which CSS adds. */

export function pillBottom(m) {
  return m.dh + m.pillGap;
}

/* Distance from the reserved bottom to the first pixel the grid may paint. */
export function contentBottom(m) {
  return m.dh + m.dz;
}
