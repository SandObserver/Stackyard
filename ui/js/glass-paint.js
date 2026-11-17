// @ts-check

/** @typedef {[number, number, number, number]} Rgba channels 0-255, alpha 0-1 */

export const dpr = () => Math.min(3, window.devicePixelRatio || 1);
export const clamp = (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) =>
  Math.max(a, Math.min(b, v));

/** Reads a computed colour: rgb(), rgba() or color(srgb|display-p3 …).
    @param {string} text @returns {Rgba} */
export function parseColour(text) {
  const fn = /^color\(\s*(?:srgb|display-p3)\s+([^)]*)\)$/i.exec(text.trim());
  if (fn) {
    const [rgb, alpha] = fn[1].split('/');
    const c = rgb.trim().split(/\s+/).map(Number);
    return [c[0] * 255, c[1] * 255, c[2] * 255, alpha == null ? 1 : Number(alpha)];
  }
  const m = text.match(/-?[\d.]+%?/g);
  if (!m || m.length < 3) return [255, 255, 255, 1];
  const a = m[3] == null ? 1 : m[3].endsWith('%') ? Number.parseFloat(m[3]) / 100 : Number(m[3]);
  return [Number(m[0]), Number(m[1]), Number(m[2]), a];
}

/** @type {HTMLElement|null} */
let probe = null;
/** Any CSS colour as the browser computes it.
    @param {string} value @returns {Rgba} */
export function colour(value) {
  if (!probe || !probe.isConnected) {
    probe = document.createElement('i');
    probe.hidden = true;
    probe.setAttribute('aria-hidden', 'true');
    document.documentElement.append(probe);
  }
  probe.style.color = '';
  probe.style.color = value;
  return parseColour(getComputedStyle(probe).color);
}

/** @param {Element} el @param {string} name a custom property @returns {Rgba} */
export const token = (el, name) => colour(getComputedStyle(el).getPropertyValue(name).trim() || '#fff');

/** @param {number[]} a @param {number[]} b @param {number} t @returns {Rgba} */
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];

/** A see-through colour as it shows over `under`. @param {Rgba} c @param {Rgba} under @returns {Rgba} */
export const over = (c, under) => mix(under, c, c[3]);

/** @param {number[]} c */
export const css = c => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
/** @param {number[]} c @returns {[number, number, number]} */
export const unit = c => [c[0] / 255, c[1] / 255, c[2] / 255];
/** @param {number[]} c */
export const isDark = c => (c[0] + c[1] + c[2]) / 765 < 0.5;

/** What shows behind `el`: its ancestors' backgrounds, blended up to the first
    solid one. A fixed bar takes what is under its middle instead.
    @param {Element} el @returns {Rgba} */
export function behind(el) {
  let from = el.parentElement;
  if (getComputedStyle(el).position === 'fixed') {
    const r = el.getBoundingClientRect();
    from = /** @type {HTMLElement|null} */ (
      document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find(n => !el.contains(n)) ?? null
    );
  }
  /** @type {Rgba[]} */
  const layers = [];
  for (let n = from; n; n = n.parentElement) {
    const c = parseColour(getComputedStyle(n).backgroundColor);
    if (c[3] <= 0) continue;
    layers.push(c);
    if (c[3] >= 1) break;
  }
  /** @type {Rgba} */
  let out = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
  return out;
}

/** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} w @param {number} h */
export function pill(g, x, y, w, h) {
  const r = Math.min(w, h) / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A 2D context for a w x h CSS px drawing at the device ratio.
    @param {HTMLCanvasElement} c @param {number} w @param {number} h @param {number} [ratio] */
export function sized(c, w, h, ratio = dpr()) {
  const W = Math.round(w * ratio);
  const H = Math.round(h * ratio);
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  return g;
}
