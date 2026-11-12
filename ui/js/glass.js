// @ts-check
import { onFrame, requestFrame, setScripted } from '/js/frame-motion.js?v=1d86154d';
import { createGlassRenderer } from '/js/glass-gpu.js?v=c03a2e48';

/** @typedef {import('/js/glass-gpu.js?v=c03a2e48').GlassLook} GlassLook */
/** @typedef {import('/js/glass-gpu.js?v=c03a2e48').GlassItem} GlassItem */

/* Keep in step with the clear glass list in dashboard.css. */
const GLASS =
  '.glass-surface, #dock, #dots, #mob-search-pill, .widget[data-card="translucent"], .mob-widget-card[data-card="translucent"], .empty-state-btn, .api-error-btn';
const OVERLAY = '.folder-overlay, .folder-overlay-mobile';
const STILL_FRAMES = 20;
let canCheck = false;
/** @type {MediaQueryList|null} */
let forcedColors = null;
const blocked = () => document.documentElement.dataset.transparency === 'reduce' || !!forcedColors?.matches;

/** @typedef {{ canvas: HTMLCanvasElement, gl: ReturnType<typeof createGlassRenderer>, blur: boolean,
      size: [number, number], blurPx: number, last: { items: GlassItem[], look: GlassLook }|null }} Layer */

/** @type {{ bitmap: ImageBitmap, box: number[] }|null} */
let wallpaper = null;
/** @type {Layer|null} */
let base = null;
/** @type {Layer|null} */
let folder = null;
/** @type {Set<Element>} */
const tracked = new Set();
/** @type {WeakMap<Element, { radius: number, w: number, h: number }>} */
const shapes = new WeakMap();
/** @type {GlassLook} */
let look = { bend: 0, dispersion: 0, brightness: 1, tint: [0, 0, 0, 0], frost: [0, 0, 0, 0] };
/** @type {{ el: HTMLElement, ov: HTMLElement, look: GlassLook, radius: number, s0: number }|null} */
let panel = null;
/* The folder panel drops its CSS fill only while this is set. */
const DRAWN = 'data-glass-drawn';
let lastSig = '';
let still = 0;
let source = { img: /** @type {HTMLImageElement|null} */ (null), size: 'cover' };

/** @param {string} className @param {boolean} blur @returns {Layer|null} */
function makeLayer(className, blur) {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  /** @type {Layer} */
  const layer = { canvas, gl: createGlassRenderer(canvas, { blur }), blur, size: [1, 1], blurPx: 0, last: null };
  if (!layer.gl) return null;
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    layer.gl = null;
    if (layer !== folder) return;
    /* Keep. A restore redraws layer.last over the open folder's CSS fill. */
    layer.last = null;
    canvas.hidden = true;
    if (panel) {
      panel.ov.removeAttribute(DRAWN);
      panel = null;
    }
  });
  canvas.addEventListener('webglcontextrestored', () => {
    layer.gl = createGlassRenderer(canvas, { blur });
    layer.gl?.resize(...layer.size);
    const ok = layer.gl?.setWallpaper(wallpaper?.bitmap ?? null, wallpaper?.box ?? [0, 0, 1, 1], layer.blurPx);
    if (!ok) layer.gl = null;
    if (layer.last) layer.gl?.draw(layer.last.items, layer.last.look);
  });
  return layer;
}

/** @param {Layer} layer @param {GlassItem[]} items @param {GlassLook} itemLook */
function drawLayer(layer, items, itemLook) {
  layer.canvas.hidden = !items.length;
  layer.last = { items, look: itemLook };
  layer.gl?.draw(items, itemLook);
}

/** @param {Layer} layer */
function sizeLayer(layer) {
  const size = /** @type {[number, number]} */ ([document.documentElement.clientWidth, innerHeight]);
  if (size[0] === layer.size[0] && size[1] === layer.size[1]) return;
  layer.size = size;
  layer.gl?.resize(...size);
}

/** @param {HTMLElement} el @param {string} name */
const num = (el, name) => Number.parseFloat(getComputedStyle(el).getPropertyValue(name));

function readLook() {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const read = (/** @type {string} */ name) => Number.parseFloat(css.getPropertyValue(name)) || 0;
  look = {
    bend: read('--glass-bend'),
    dispersion: read('--glass-dispersion'),
    brightness: Number.parseFloat(css.getPropertyValue('--bg-brightness')) || 1,
    tint: [0, 0, 0, 0],
    frost: [0, 0, 0, 0],
  };
}

/** @param {HTMLElement} el @param {string} name */
const numbers = (el, name) => getComputedStyle(el).getPropertyValue(name).trim().split(/\s+/).map(Number);

/** @param {HTMLElement} ov */
function folderLook(ov) {
  const [r = 0, g = 0, b = 0, a = 1] = (getComputedStyle(ov).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
  const frost = numbers(document.documentElement, '--glass-frost');
  return {
    ...look,
    brightness: look.brightness * Math.sqrt(num(ov, '--folder-dim') || 1),
    tint: [r / 255, g / 255, b / 255, a * 0.5],
    frost: frost.length === 4 ? frost : [0, 0, 0, 0],
  };
}

/** @param {Element} el */
function visible(el) {
  if (canCheck) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  if (getComputedStyle(el).visibility === 'hidden') return false;
  for (let n = /** @type {Element|null} */ (el); n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).opacity === '0') return false;
  }
  return true;
}

/** @param {Element} el @param {DOMRect} r */
function radiusOf(el, r) {
  let m = shapes.get(el);
  if (!m || m.w !== r.width || m.h !== r.height) {
    m = { radius: Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w: r.width, h: r.height };
    shapes.set(el, m);
  }
  return m.radius;
}

/** Returns whether anything moved. */
function paintBase() {
  if (!base) return false;
  /** @type {GlassItem[]} */
  const items = [];
  let sig = '';
  for (const el of tracked) {
    if (!el.isConnected || !el.matches(GLASS)) {
      tracked.delete(el);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    if (el.closest(OVERLAY) || !visible(el)) continue;
    const inset = Number.parseFloat(/** @type {HTMLElement} */ (el).style.getPropertyValue('--pill-inset')) || 0;
    const rect = { left: r.left + inset, top: r.top, width: r.width - 2 * inset, height: r.height };
    if (rect.width <= 0) continue;
    const radius = radiusOf(el, r);
    items.push({ rect, radius, alpha: 1 });
    sig += `${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)},${radius}|`;
  }
  if (sig === lastSig) return false;
  lastSig = sig;
  drawLayer(base, items, look);
  return true;
}

function paintFolder() {
  if (!folder || !panel) return;
  if (!panel.el.isConnected) {
    drawLayer(folder, [], panel.look);
    panel.ov.removeAttribute(DRAWN);
    panel = null;
    return;
  }
  const rect = panel.el.getBoundingClientRect();
  const s = rect.width / (panel.el.offsetWidth || 1);
  let alpha = panel.s0 < 0.999 ? Math.min(1, Math.max(0, (s - panel.s0) / (1 - panel.s0))) : 1;
  for (let n = /** @type {Element|null} */ (panel.el); n && n !== panel.ov; n = n.parentElement)
    alpha *= Number(getComputedStyle(n).opacity);
  drawLayer(folder, alpha > 0.001 && rect.width ? [{ rect, radius: panel.radius * s, alpha }] : [], panel.look);
}

function frame() {
  if (!wallpaper) return;
  paintFolder();
  if (paintBase()) still = 0;
  else still++;
  if (still < STILL_FRAMES) requestFrame();
}

function wake() {
  still = 0;
  requestFrame();
}

/** @param {ParentNode} root */
function scan(root) {
  const found = [...root.querySelectorAll(GLASS)];
  if (root instanceof Element && root.matches(GLASS)) found.push(root);
  for (const el of found) tracked.add(el);
  if (found.length) wake();
}

function forgetRemoved() {
  for (const el of tracked) if (!el.isConnected) tracked.delete(el);
}

/** @param {number} w @param {number} h @param {string} size */
export function wallpaperBox(w, h, size) {
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const s = size === 'contain' ? Math.min(vw / w, vh / h) : Math.max(vw / w, vh / h);
  return [(vw - w * s) / 2, (vh - h * s) / 2, w * s, h * s];
}

/** A cross-origin image shown without CORS cannot be uploaded to the GPU. This loads a CORS copy.
    @param {HTMLImageElement} img */
async function readable(img) {
  if (new URL(img.src).origin === location.origin || img.crossOrigin) return img;
  const copy = new Image();
  copy.crossOrigin = 'anonymous';
  copy.src = img.src;
  await copy.decode();
  return copy;
}

/** The bitmap size for a picture shown at coverWidth CSS px: never larger than
    the picture, never larger than the GPU accepts.
    @param {number} w @param {number} h @param {number} coverWidth @param {number} limit
    @returns {[number, number]} */
export function bitmapSize(w, h, coverWidth, limit) {
  const scale = Math.min(1, coverWidth / w, limit / w, limit / h);
  return [Math.max(1, Math.min(limit, Math.round(w * scale))), Math.max(1, Math.min(limit, Math.round(h * scale)))];
}

let uploads = 0;
async function upload() {
  const call = ++uploads;
  const img = source.img;
  sizeLayer(/** @type {Layer} */ (base));
  if (folder) sizeLayer(folder);
  let next = null;
  if (img && !blocked() && base?.gl) {
    try {
      const pic = await readable(img);
      if (call !== uploads) return;
      const box = wallpaperBox(pic.naturalWidth, pic.naturalHeight, source.size);
      const [resizeWidth, resizeHeight] = bitmapSize(pic.naturalWidth, pic.naturalHeight, box[2], base.gl.maxSize);
      const bitmap = await createImageBitmap(pic, { resizeWidth, resizeHeight, resizeQuality: 'high' });
      if (call !== uploads) {
        bitmap.close();
        return;
      }
      next = { bitmap, box };
    } catch {
      next = null;
    }
  }
  wallpaper?.bitmap.close();
  wallpaper = next;
  if (wallpaper && !base?.gl?.setWallpaper(wallpaper.bitmap, wallpaper.box, base.blurPx)) {
    wallpaper.bitmap.close();
    wallpaper = null;
  }
  if (folder?.gl && !folder.gl.setWallpaper(wallpaper?.bitmap ?? null, wallpaper?.box ?? [0, 0, 1, 1], folder.blurPx))
    folder.gl = null;
  if (!wallpaper) base?.gl?.setWallpaper(null, [0, 0, 1, 1], 0);
  setScripted(!!wallpaper);
  lastSig = '';
  if (wallpaper) {
    prepareFolder();
    wake();
    return;
  }
  if (panel) {
    panel.ov.removeAttribute(DRAWN);
    panel = null;
  }
  for (const layer of [base, folder]) if (layer) drawLayer(layer, [], look);
}

function prepareFolder() {
  if (folder) return;
  const idle = window.requestIdleCallback ?? /** @type {() => void} */ (fn => setTimeout(fn, 200));
  idle(() => {
    if (folder || !wallpaper) return;
    folder = makeLayer('glass-folder-canvas', true);
    if (!folder) return;
    folder.blurPx = num(document.body, '--folder-blur') * 0.4;
    sizeLayer(folder);
    if (!folder.gl?.setWallpaper(wallpaper.bitmap, wallpaper.box, folder.blurPx)) folder.gl = null;
    document.body.append(folder.canvas);
  });
}

/** Call again after a theme or brightness change.
    @param {HTMLImageElement|null} img decoded @param {string} size as --bg-size */
export function glassWallpaper(img, size) {
  if (!base) return;
  readLook();
  if (img === source.img && size === source.size) {
    if (panel?.ov.isConnected) panel.look = folderLook(panel.ov);
    lastSig = '';
    wake();
    return;
  }
  source = { img, size };
  upload();
}

/** Call after the open animation has set its first frame.
    @param {HTMLElement} ov @param {HTMLElement} el */
export function openFolderGlass(ov, el) {
  if (!folder?.gl || !wallpaper) return;
  const blurPx = num(ov, '--folder-blur') * 0.4;
  if (blurPx !== folder.blurPx) {
    folder.blurPx = blurPx;
    if (!folder.gl.setWallpaper(wallpaper.bitmap, wallpaper.box, blurPx)) {
      folder.gl = null;
      return;
    }
  }
  ov.prepend(folder.canvas);
  ov.setAttribute(DRAWN, '');
  const r = el.getBoundingClientRect();
  panel = {
    el,
    ov,
    look: folderLook(ov),
    radius: Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
    s0: Math.min(1, r.width / (el.offsetWidth || 1)),
  };
  wake();
}

export function startGlass() {
  canCheck = typeof Element.prototype.checkVisibility === 'function';
  forcedColors = matchMedia('(forced-colors: active)');
  base = makeLayer('glass-canvas', false);
  if (!base) return;
  document.body.prepend(base.canvas);
  onFrame(frame);
  scan(document);
  new MutationObserver(records => {
    let removed = false;
    for (const r of records) {
      if (r.type === 'childList') {
        for (const node of r.addedNodes) if (node instanceof Element) scan(node);
        removed ||= r.removedNodes.length > 0;
      } else if (r.attributeName === 'class' || r.attributeName === 'data-card') {
        scan(/** @type {Element} */ (r.target));
      }
    }
    if (removed) forgetRemoved();
    wake();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-card', 'style', 'hidden', 'open'],
  });
  for (const type of ['transitionrun', 'animationstart', 'scroll'])
    addEventListener(type, wake, { capture: true, passive: true });
  addEventListener('resize', () => {
    if (source.img) upload();
  });
  forcedColors.addEventListener('change', upload);
  new MutationObserver(upload).observe(document.documentElement, { attributeFilter: ['data-transparency'] });
}
