// @ts-check
import { onFrame, requestFrame, setScripted } from '/js/frame-motion.js?v=1d86154d';
import { createGlassRenderer } from '/js/glass-gpu.js?v=5787df05';
import { loadSamplingImage } from '/js/label-contrast.js?v=a160c6d1';

/** @typedef {import('/js/glass-gpu.js?v=5787df05').GlassLook} GlassLook */
/** @typedef {import('/js/glass-gpu.js?v=5787df05').GlassItem} GlassItem */
/** @typedef {ReturnType<typeof createGlassRenderer>} Renderer */

/* Keep in step with the rim list in dashboard.css. */
const GLASS =
  '.glass-surface, #dock, #dots, #mob-search-pill, .widget[data-card="translucent"], .mob-widget-card[data-card="translucent"], .empty-state-btn, .api-error-btn';
const OVERLAY = '.folder-overlay, .folder-overlay-mobile';
/** Frames with nothing moving before the layer stops measuring. */
const STILL_FRAMES = 8;
/** The GPU blur radius for a CSS blur radius. It samples a quarter-size copy. */
const GPU_BLUR_SCALE = 0.4;
const RESIZE_SETTLE_MS = 150;
/* dashboard.css clears the folder panel's fill only while this is set. */
const DRAWN = 'data-glass-drawn';

/** @param {number} w @param {number} h @param {string} size @param {number} vw @param {number} vh */
export function wallpaperBox(w, h, size, vw, vh) {
  const s = size === 'contain' ? Math.min(vw / w, vh / h) : Math.max(vw / w, vh / h);
  return [(vw - w * s) / 2, (vh - h * s) / 2, w * s, h * s];
}

/** The bitmap size for a picture shown at coverWidth CSS px: never larger than
    the picture, never larger than the GPU accepts.
    @param {number} w @param {number} h @param {number} coverWidth @param {number} limit
    @returns {[number, number]} */
export function bitmapSize(w, h, coverWidth, limit) {
  const scale = Math.min(1, coverWidth / w, limit / w, limit / h);
  return [Math.max(1, Math.min(limit, Math.round(w * scale))), Math.max(1, Math.min(limit, Math.round(h * scale)))];
}

/** A colour as four numbers from 0 to 1, from rgb(), rgba() or the space form.
    @param {string} text @returns {number[]} */
export function unitColour(text) {
  const [r = 0, g = 0, b = 0, a = 1] = (text.match(/[\d.]+/g) ?? []).map(Number);
  return [r / 255, g / 255, b / 255, a];
}

/** @typedef {{ canvas: HTMLCanvasElement, gl: Renderer, blur: boolean, size: [number, number],
      blurPx: number, last: { items: GlassItem[], look: GlassLook }|null }} Layer */

/** @typedef {{
      doc: Document,
      win: Window & typeof globalThis,
      createRenderer: typeof createGlassRenderer,
      onFrame: typeof onFrame,
      requestFrame: typeof requestFrame,
      setScripted: typeof setScripted,
      corsCopy: (url: string) => Promise<HTMLImageElement|null>,
      log: (...args: unknown[]) => void,
    }} GlassEnv */

/** The GPU glass behind every clear glass surface, and the folder panel's own layer.
    @param {GlassEnv} env */
export function createGlass(env) {
  const { doc, win } = env;
  let canCheck = false;
  /** @type {MediaQueryList|null} */
  let forcedColors = null;
  const blocked = () => doc.documentElement.dataset.transparency === 'reduce' || !!forcedColors?.matches;

  /** @type {{ bitmap: ImageBitmap, box: number[], natural: [number, number] }|null} */
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
  let lastSig = '';
  let still = 0;
  let uploads = 0;
  let resized = false;
  let source = { img: /** @type {HTMLImageElement|null} */ (null), size: 'cover' };

  const css = (/** @type {Element} */ el) => win.getComputedStyle(el);
  /** @param {Element} el @param {string} name */
  const num = (el, name) => Number.parseFloat(css(el).getPropertyValue(name));

  function dropPanel() {
    if (!panel) return;
    panel.ov.removeAttribute(DRAWN);
    panel = null;
  }

  function loseFolderLayer() {
    if (!folder) return;
    folder.gl = null;
    /* Keep. A restore redraws last over the open folder's CSS fill. */
    folder.last = null;
    folder.canvas.hidden = true;
    dropPanel();
  }

  /** @param {string} className @param {boolean} blur @returns {Layer|null} */
  function makeLayer(className, blur) {
    const canvas = doc.createElement('canvas');
    canvas.className = className;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    /** @type {Layer} */
    const layer = { canvas, gl: env.createRenderer(canvas, { blur }), blur, size: [1, 1], blurPx: 0, last: null };
    if (!layer.gl) return null;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      env.log('GPU context lost', className);
      layer.gl = null;
      if (layer === folder) loseFolderLayer();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      layer.gl = env.createRenderer(canvas, { blur });
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
    const size = /** @type {[number, number]} */ ([doc.documentElement.clientWidth, win.innerHeight]);
    if (size[0] === layer.size[0] && size[1] === layer.size[1]) return;
    layer.size = size;
    layer.gl?.resize(...size);
  }

  function readLook() {
    const root = css(doc.documentElement);
    const read = (/** @type {string} */ name) => Number.parseFloat(root.getPropertyValue(name)) || 0;
    look = {
      bend: read('--glass-bend'),
      dispersion: read('--glass-dispersion'),
      brightness: Number.parseFloat(root.getPropertyValue('--bg-brightness')) || 1,
      tint: [0, 0, 0, 0],
      frost: [0, 0, 0, 0],
    };
  }

  /** @param {HTMLElement} ov @returns {GlassLook} */
  function folderLook(ov) {
    const [r, g, b, a] = unitColour(css(ov).backgroundColor);
    return {
      ...look,
      brightness: look.brightness * Math.sqrt(num(ov, '--folder-dim') || 1),
      tint: [r, g, b, a * 0.5],
      frost: unitColour(css(doc.documentElement).getPropertyValue('--glass-folder')),
    };
  }

  /** @param {Element} el */
  function visible(el) {
    if (canCheck) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    if (css(el).visibility === 'hidden') return false;
    for (let n = /** @type {Element|null} */ (el); n && n !== doc.body; n = n.parentElement) {
      if (css(n).opacity === '0') return false;
    }
    return true;
  }

  /** @param {Element} el @param {DOMRect} r */
  function radiusOf(el, r) {
    let m = shapes.get(el);
    if (!m || m.w !== r.width || m.h !== r.height) {
      m = { radius: Number.parseFloat(css(el).borderTopLeftRadius) || 0, w: r.width, h: r.height };
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
      if (!r.width || r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
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
      dropPanel();
      return;
    }
    const rect = panel.el.getBoundingClientRect();
    const s = rect.width / (panel.el.offsetWidth || 1);
    let alpha = panel.s0 < 0.999 ? Math.min(1, Math.max(0, (s - panel.s0) / (1 - panel.s0))) : 1;
    for (let n = /** @type {Element|null} */ (panel.el); n && n !== panel.ov; n = n.parentElement)
      alpha *= Number(css(n).opacity);
    drawLayer(folder, alpha > 0.001 && rect.width ? [{ rect, radius: panel.radius * s, alpha }] : [], panel.look);
  }

  /* Call only from frame(). Resizing a canvas clears it. */
  function fitLayers() {
    resized = false;
    for (const layer of [base, folder]) if (layer) sizeLayer(layer);
    if (!wallpaper) return;
    wallpaper.box = wallpaperBox(...wallpaper.natural, source.size, doc.documentElement.clientWidth, win.innerHeight);
    for (const layer of [base, folder]) layer?.gl?.setBox(wallpaper.box);
    lastSig = '';
  }

  function frame() {
    if (!wallpaper) return;
    if (resized) fitLayers();
    paintFolder();
    if (paintBase()) still = 0;
    else still++;
    if (still < STILL_FRAMES) env.requestFrame();
  }

  function wake() {
    still = 0;
    env.requestFrame();
  }

  /** @param {ParentNode} root */
  function scan(root) {
    const found = [...root.querySelectorAll(GLASS)];
    if (root instanceof win.Element && root.matches(GLASS)) found.push(root);
    for (const el of found) tracked.add(el);
    if (found.length) wake();
  }

  function forgetRemoved() {
    for (const el of tracked) if (!el.isConnected) tracked.delete(el);
  }

  /** A cross-origin image shown without CORS cannot be uploaded to the GPU.
      @param {HTMLImageElement} img @returns {Promise<HTMLImageElement|null>} */
  function readable(img) {
    if (new URL(img.src).origin === win.location.origin || img.crossOrigin) return Promise.resolve(img);
    return env.corsCopy(img.src);
  }

  async function upload() {
    const call = ++uploads;
    const img = source.img;
    sizeLayer(/** @type {Layer} */ (base));
    if (folder) sizeLayer(folder);
    let next = null;
    if (img && !blocked() && base?.gl) {
      const limit = base.gl.maxSize;
      try {
        const pic = await readable(img);
        if (call !== uploads) return;
        if (!pic) throw new Error('no CORS copy of the wallpaper');
        const box = wallpaperBox(
          pic.naturalWidth,
          pic.naturalHeight,
          source.size,
          doc.documentElement.clientWidth,
          win.innerHeight,
        );
        const [resizeWidth, resizeHeight] = bitmapSize(pic.naturalWidth, pic.naturalHeight, box[2], limit);
        const bitmap = await win.createImageBitmap(pic, { resizeWidth, resizeHeight, resizeQuality: 'high' });
        if (call !== uploads) {
          bitmap.close();
          return;
        }
        next = { bitmap, box, natural: /** @type {[number, number]} */ ([pic.naturalWidth, pic.naturalHeight]) };
      } catch (e) {
        env.log('the glass stays CSS:', e);
      }
    }
    wallpaper?.bitmap.close();
    wallpaper = next;
    if (wallpaper && !base?.gl?.setWallpaper(wallpaper.bitmap, wallpaper.box, base.blurPx)) {
      env.log('the GPU refused the wallpaper; the glass stays CSS');
      wallpaper.bitmap.close();
      wallpaper = null;
    }
    if (folder?.gl && !folder.gl.setWallpaper(wallpaper?.bitmap ?? null, wallpaper?.box ?? [0, 0, 1, 1], folder.blurPx))
      loseFolderLayer();
    if (!wallpaper) base?.gl?.setWallpaper(null, [0, 0, 1, 1], 0);
    env.setScripted(!!wallpaper);
    lastSig = '';
    if (wallpaper) {
      prepareFolder();
      wake();
      return;
    }
    dropPanel();
    for (const layer of [base, folder]) if (layer) drawLayer(layer, [], look);
  }

  function prepareFolder() {
    if (folder) return;
    const idle = win.requestIdleCallback ?? /** @type {(fn: () => void) => void} */ (fn => win.setTimeout(fn, 200));
    idle(() => {
      if (folder || !wallpaper) return;
      folder = makeLayer('glass-folder-canvas', true);
      if (!folder) return;
      folder.blurPx = num(doc.body, '--folder-blur') * GPU_BLUR_SCALE;
      sizeLayer(folder);
      if (!folder.gl?.setWallpaper(wallpaper.bitmap, wallpaper.box, folder.blurPx)) folder.gl = null;
      doc.body.append(folder.canvas);
    });
  }

  /** Call again after a theme or brightness change.
      @param {HTMLImageElement|null} img decoded @param {string} size as --bg-size */
  function setWallpaper(img, size) {
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
  function openFolder(ov, el) {
    if (!folder?.gl || !wallpaper) return;
    const blurPx = num(ov, '--folder-blur') * GPU_BLUR_SCALE;
    if (blurPx !== folder.blurPx) {
      folder.blurPx = blurPx;
      if (!folder.gl.setWallpaper(wallpaper.bitmap, wallpaper.box, blurPx)) {
        loseFolderLayer();
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
      radius: Number.parseFloat(css(el).borderTopLeftRadius) || 0,
      s0: Math.min(1, r.width / (el.offsetWidth || 1)),
    };
    wake();
  }

  function start() {
    canCheck = typeof win.Element.prototype.checkVisibility === 'function';
    forcedColors = win.matchMedia('(forced-colors: active)');
    base = makeLayer('glass-canvas', false);
    if (!base) {
      env.log('no WebGL2 renderer; the glass stays CSS');
      return;
    }
    doc.body.prepend(base.canvas);
    env.onFrame(frame);
    scan(doc);
    new win.MutationObserver(records => {
      let removed = false;
      for (const r of records) {
        if (r.type === 'childList') {
          for (const node of r.addedNodes) if (node instanceof win.Element) scan(node);
          removed ||= r.removedNodes.length > 0;
        } else if (r.attributeName === 'class' || r.attributeName === 'data-card') {
          scan(/** @type {Element} */ (r.target));
        }
      }
      if (removed) forgetRemoved();
      wake();
    }).observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-card', 'style', 'hidden', 'open'],
    });
    for (const type of ['transitionrun', 'transitionstart', 'animationstart', 'scroll'])
      win.addEventListener(type, wake, { capture: true, passive: true });
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let resizing;
    win.addEventListener('resize', () => {
      resized = true;
      wake();
      win.clearTimeout(resizing);
      resizing = win.setTimeout(() => {
        if (source.img) upload();
      }, RESIZE_SETTLE_MS);
    });
    forcedColors.addEventListener('change', upload);
    new win.MutationObserver(upload).observe(doc.documentElement, { attributeFilter: ['data-transparency'] });
  }

  /** What the glass holds now. For tests and the console. */
  function stats() {
    return { live: !!wallpaper, tracked: tracked.size, folderLayer: !!folder?.gl, panelDrawn: !!panel };
  }

  return { start, setWallpaper, openFolder, stats };
}

/** @type {ReturnType<typeof createGlass>|null} */
let glass = null;

export function startGlass() {
  glass = createGlass({
    doc: document,
    win: window,
    createRenderer: createGlassRenderer,
    onFrame,
    requestFrame,
    setScripted,
    corsCopy: loadSamplingImage,
    log: (...args) => console.warn('[glass]', ...args),
  });
  glass.start();
}

/** @param {HTMLImageElement|null} img decoded @param {string} size as --bg-size */
export const glassWallpaper = (img, size) => glass?.setWallpaper(img, size);
/** @param {HTMLElement} ov @param {HTMLElement} el */
export const openFolderGlass = (ov, el) => glass?.openFolder(ov, el);
