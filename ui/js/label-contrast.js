// @ts-check
/* Icon label colour, measured from the background behind each label. Keep the
   first half free of the DOM: it is the half under test. */

/** WCAG 2.1 relative luminance of an sRGB triple.

    @param {number} r @param {number} g @param {number} b 0-255
    @returns {number} 0-1 */
export function relativeLuminance(r, g, b) {
  const lin = (/** @type {number} */ c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** @param {number} a @param {number} b two relative luminances
    @returns {number} the WCAG contrast ratio, 1-21 */
export function contrastRatio(a, b) {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** The two tones a label can take. */
const TONE_LUM = {
  light: relativeLuminance(255, 255, 255),
  dark: relativeLuminance(0, 0, 0),
};

/** The tone with the best worst-case contrast over the patch a label covers.

    @param {ArrayLike<number>} lums background luminances @returns {'light'|'dark'} */
export function toneForLuminances(lums) {
  if (!lums || lums.length === 0) return 'light';
  let worstLight = Infinity,
    worstDark = Infinity;
  for (let i = 0; i < lums.length; i++) {
    worstLight = Math.min(worstLight, contrastRatio(TONE_LUM.light, lums[i]));
    worstDark = Math.min(worstDark, contrastRatio(TONE_LUM.dark, lums[i]));
  }
  return worstDark > worstLight ? 'dark' : 'light';
}

/** The part of an image `background-size:cover` shows.

    @param {number} iw @param {number} ih the image's natural size
    @param {number} vw @param {number} vh the box it covers
    @returns {{sx:number, sy:number, sw:number, sh:number}} */
export function coverSourceRect(iw, ih, vw, vh) {
  if (!(iw > 0 && ih > 0 && vw > 0 && vh > 0)) return { sx: 0, sy: 0, sw: iw || 1, sh: ih || 1 };
  const scale = Math.max(vw / iw, vh / ih);
  const sw = Math.min(iw, vw / scale),
    sh = Math.min(ih, vh / scale);
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh };
}

/** Where `background-size:contain` puts the whole image.

    @param {number} iw @param {number} ih @param {number} vw @param {number} vh
    @returns {{dx:number, dy:number, dw:number, dh:number}} */
export function containDestRect(iw, ih, vw, vh) {
  if (!(iw > 0 && ih > 0 && vw > 0 && vh > 0)) return { dx: 0, dy: 0, dw: vw, dh: vh };
  const scale = Math.min(vw / iw, vh / ih);
  const dw = iw * scale,
    dh = ih * scale;
  return { dx: (vw - dw) / 2, dy: (vh - dh) / 2, dw, dh };
}

/** How the wallpaper is laid over the viewport.

    @param {number} iw @param {number} ih @param {number} vw @param {number} vh
    @param {string} fit `'fit'` for contain, anything else for cover
    @returns {{sx:number, sy:number, sw:number, sh:number, dx:number, dy:number, dw:number, dh:number}} */
export function drawPlan(iw, ih, vw, vh, fit) {
  if (fit === 'fit') {
    const { dx, dy, dw, dh } = containDestRect(iw, ih, vw, vh);
    return { sx: 0, sy: 0, sw: iw || 1, sh: ih || 1, dx, dy, dw, dh };
  }
  const { sx, sy, sw, sh } = coverSourceRect(iw, ih, vw, vh);
  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: vw, dh: vh };
}

/** CSS `filter:brightness()` multiplies each sRGB channel.

    @param {number} c 0-255 @param {number} amount @returns {number} */
export function applyBrightness(c, amount) {
  return Math.max(0, Math.min(255, c * amount));
}

/** Per-cell luminance of an image drawn at the grid's own size.

    @param {ArrayLike<number>} data RGBA, `cols * rows` pixels
    @param {number} cols @param {number} rows
    @param {number} brightness the wallpaper brightness the page renders at
    @returns {number[]} */
export function gridFromPixels(data, cols, rows, brightness = 1) {
  const out = [];
  for (let i = 0; i < cols * rows; i++) {
    const p = i * 4;
    out.push(
      relativeLuminance(
        applyBrightness(data[p], brightness),
        applyBrightness(data[p + 1], brightness),
        applyBrightness(data[p + 2], brightness),
      ),
    );
  }
  return out;
}

/** The grid cells a viewport rectangle covers, clamped to the grid.

    @param {{left:number, top:number, right:number, bottom:number}} rect
    @param {number} vw @param {number} vh the viewport
    @param {number} cols @param {number} rows
    @returns {number[]} indices into a `gridFromPixels` array */
export function cellsForRect(rect, vw, vh, cols, rows) {
  if (!(vw > 0 && vh > 0)) return [];
  const clamp = (/** @type {number} */ n, /** @type {number} */ max) => Math.max(0, Math.min(max - 1, n));
  const c0 = clamp(Math.floor((rect.left / vw) * cols), cols),
    c1 = clamp(Math.ceil((rect.right / vw) * cols) - 1, cols),
    r0 = clamp(Math.floor((rect.top / vh) * rows), rows),
    r1 = clamp(Math.ceil((rect.bottom / vh) * rows) - 1, rows);
  const out = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * cols + c);
  return out;
}

/** The tone for one rectangle of the viewport.

    @param {number[]} grid @param {number} cols @param {number} rows
    @param {number} vw @param {number} vh
    @param {{left:number, top:number, right:number, bottom:number}} rect
    @returns {'light'|'dark'} */
export function toneForRect(grid, cols, rows, vw, vh, rect) {
  return toneForLuminances(cellsForRect(rect, vw, vh, cols, rows).map(i => grid[i]));
}

/* ── The DOM half ─────────────────────────────────────────────────────────── */

export const GRID_COLS = 32;
export const GRID_ROWS = 18;

/** Any CSS colour as an sRGB triple. A canvas keeps its previous fillStyle when
    the value does not parse, so two seeds are needed to tell an unreadable value
    from a real one.

    @param {string} value @returns {[number, number, number]|null} */
export function parseCssColor(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const read = (/** @type {string} */ seed) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = seed;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return /** @type {[number, number, number]} */ ([d[0], d[1], d[2]]);
  };
  const a = read('#000000'),
    b = read('#ffffff');
  if (!a || !b) return null;
  if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return null;
  return a;
}

/** An image as a luminance grid.

    @param {HTMLImageElement} img a loaded image
    @param {number} vw @param {number} vh the viewport it covers
    @param {number} brightness
    @param {string} [fit] `'fit'` for contain, anything else for cover
    @param {string} [baseColor] what shows where a fitted image does not reach
    @returns {number[]|null} null when the image cannot be read */
export function sampleImage(img, vw, vh, brightness, fit = 'fill', baseColor = '#0d1117') {
  try {
    const p = drawPlan(img.naturalWidth, img.naturalHeight, vw, vh, fit);
    const cv = document.createElement('canvas');
    cv.width = GRID_COLS;
    cv.height = GRID_ROWS;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    /* Fit leaves two edges showing the colour behind the image. */
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, GRID_COLS, GRID_ROWS);
    const kx = GRID_COLS / vw,
      ky = GRID_ROWS / vh;
    ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx * kx, p.dy * ky, p.dw * kx, p.dh * ky);
    return gridFromPixels(ctx.getImageData(0, 0, GRID_COLS, GRID_ROWS).data, GRID_COLS, GRID_ROWS, brightness);
  } catch {
    return null;
  }
}

/** A second copy of the wallpaper that a canvas may read. Do not request the
    displayed image this way. A host that refuses CORS would fail the wallpaper
    itself.

    @param {string} url @returns {Promise<HTMLImageElement|null>} */
export function loadSamplingImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const LABEL_SELECTOR = '.ilabel, .dyn-mob-label, .dyn-fold-label';

/* A folder overlay lays its own scrim over the background. */
const SCRIM = '.folder-overlay, .folder-overlay-mobile';

/** Where a label sits once its page is the one on screen. Pages are one
    viewport wide, so an off-screen page's labels land on the same patch of the
    fixed wallpaper as the page in view.

    @param {Element} label @param {Element|null} page
    @returns {{left:number, top:number, right:number, bottom:number}} */
function labelViewportRect(label, page) {
  const r = label.getBoundingClientRect();
  if (!page) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const p = page.getBoundingClientRect();
  return { left: r.left - p.left, top: r.top - p.top, right: r.right - p.left, bottom: r.bottom - p.top };
}

/** Tones every label against the current background.

    @param {{grid: number[]|null, tone: 'light'|'dark'|null}} bg a sampled
      wallpaper, or one tone for a solid colour
    @param {Document|HTMLElement} [root] @returns {void} */
export function applyLabelTones(bg, root = document) {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  for (const label of root.querySelectorAll(LABEL_SELECTOR)) {
    if (label.closest(SCRIM)) {
      label.removeAttribute('data-tone');
    } else if (bg.grid) {
      const page = label.closest('.page');
      label.setAttribute(
        'data-tone',
        toneForRect(bg.grid, GRID_COLS, GRID_ROWS, vw, vh, labelViewportRect(label, page)),
      );
    } else if (bg.tone) {
      label.setAttribute('data-tone', bg.tone);
    } else {
      label.removeAttribute('data-tone');
    }
  }
}
