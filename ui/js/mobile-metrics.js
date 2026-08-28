/* Every size must derive from sc. Raw px here, or CSS without var(--sc), breaks
   rendering at one physical size whatever page scale the browser reports.

   Safe-area insets are not here. The stylesheet holds them, and the layout
   measures the box the stylesheet produced. The platform reports an inset after the
   first paint, so a value read into JavaScript is stale from the moment it is
   taken. */

const BASE_VW = 393;

/* The grid answers a wider window with more cells, not with bigger ones, so the
   chrome around it must stop growing too. Above this the dock, the pill and the
   margins would be drawn half as large again as anything they sit beside. The
   widest phone reports 430px, which is under the cap, so no phone is affected. */
const MAX_SC = 1.2;

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

   @param {{ gridW: number, gridH: number, sc: number }} o
   @returns {{ cols: number, rows: number }} */
export function gridCellCount({ gridW, gridH, sc }) {
  const cols = Math.max(MIN_COLS, Math.round(gridW / (BASE_CELL_W * sc)));
  const rows = Math.max(MIN_ROWS, Math.round(gridH / (BASE_CELL_H * sc)));
  return { cols, rows };
}

export function mobileMetrics(vw) {
  const sc = Math.min(vw / BASE_VW, MAX_SC);
  const sm = Math.round(18 * sc);
  const dh = Math.round(108 * sc);
  const pillH = Math.round(34 * sc);
  const pillGap = Math.round(10 * sc);
  /* Reserving less lets the pill sit on top of the last row. */
  const dz = pillGap + pillH + Math.round(8 * sc);
  return { sc, sm, dh, pillH, pillGap, dz };
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
