// @ts-check
import { dpr } from '/js/glass-paint.js?v=800e4865';

const SVG = 'http://www.w3.org/2000/svg';

/** @typedef {{ img: HTMLImageElement|null, ix: number, iy: number, iw: number, ih: number,
               text: string, face: string, color: string, rtl: boolean, lx: number, lw: number, base: number }} TabInk */
/** @typedef {{ items: TabInk[], key: string, pending: boolean }} TabInks */

/** @type {Map<string, [string, string][]>|null} */
let iconRules = null;
/** @type {Map<string, { img: HTMLImageElement, ready: boolean }>} */
const icons = new Map();

function rules() {
  if (iconRules) return iconRules;
  iconRules = new Map();
  for (const sheet of document.styleSheets) {
    /** @type {CSSRuleList} */
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of list) {
      if (!(r instanceof CSSStyleRule) || !/^\.sy-[\w-]+$/.test(r.selectorText)) continue;
      const decls = iconRules.get(r.selectorText.slice(1)) ?? [];
      for (const prop of r.style) decls.push([prop, r.style.getPropertyValue(prop)]);
      iconRules.set(r.selectorText.slice(1), decls);
    }
  }
  return iconRules;
}

/** @param {SVGSVGElement} svg */
function accentOf(svg) {
  const g = document.createElementNS(SVG, 'g');
  g.style.color = 'var(--icon-accent, currentColor)';
  svg.append(g);
  const v = getComputedStyle(g).color;
  g.remove();
  return v;
}

/** @param {Element} node */
export function referencedIds(node) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const el of [node, ...node.querySelectorAll('*')])
    for (const a of el.attributes)
      for (const m of a.value.matchAll(/url\(\s*["']?#([^)"'\s]+)["']?\s*\)|^#(\S+)$/g)) ids.add(m[1] ?? m[2]);
  return ids;
}

/** A copy whose mask or clip is missing draws nothing.
    @param {Element} symbol @param {string} color @param {string} accent @param {number} w @param {number} h */
export function iconMarkup(symbol, color, accent, w, h) {
  const root = document.createElementNS(SVG, 'svg');
  const box = symbol.getAttribute('viewBox');
  if (box) root.setAttribute('viewBox', box);
  root.setAttribute('width', String(w));
  root.setAttribute('height', String(h));
  root.setAttribute('color', color);
  for (const n of symbol.childNodes) root.append(n.cloneNode(true));
  const defs = document.createElementNS(SVG, 'defs');
  /** @type {Set<string>} */
  const copied = new Set();
  /** @type {Element[]} */
  const todo = [root];
  while (todo.length) {
    for (const id of referencedIds(/** @type {Element} */ (todo.pop()))) {
      if (copied.has(id)) continue;
      copied.add(id);
      if (root.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
      const src = symbol.ownerDocument.getElementById(id);
      if (!src) continue;
      const c = /** @type {Element} */ (src.cloneNode(true));
      defs.append(c);
      todo.push(c);
    }
  }
  if (defs.childNodes.length) root.prepend(defs);
  const r = rules();
  for (const el of root.querySelectorAll('[class]'))
    for (const c of el.classList)
      for (const [prop, value] of r.get(c) ?? [])
        el.setAttribute(prop, value.replace(/var\(--icon-accent[^)]*\)/g, accent));
  return new XMLSerializer().serializeToString(root);
}

/** Tab icons are drawn inline at runtime, not as <use>. Reading only <use> drops them.
    @param {SVGSVGElement} svg */
function iconSource(svg) {
  const href = svg.querySelector(':scope > use')?.getAttribute('href') ?? '';
  return href.startsWith('#') ? document.getElementById(href.slice(1)) : svg;
}

/** @param {Element} source @param {string} color @param {string} accent @param {number} w @param {number} h
    @param {() => void} onReady */
function iconImage(source, color, accent, w, h, onReady) {
  const W = Math.max(1, Math.round(w * dpr()));
  const H = Math.max(1, Math.round(h * dpr()));
  const key = `${source.id || hash(new XMLSerializer().serializeToString(source))}|${color}|${accent}|${W}x${H}`;
  const have = icons.get(key);
  if (have) return have.ready ? have.img : null;
  const symbol = source;
  const img = new Image(W, H);
  const entry = { img, ready: false };
  icons.set(key, entry);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconMarkup(symbol, color, accent, W, H))}`;
  img.decode().then(
    () => {
      entry.ready = true;
      onReady();
    },
    () => icons.delete(key),
  );
  return null;
}

/** @param {string} text */
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h.toString(36);
}

/** Canvas font metrics put the baseline 2 px low. Read it from layout.
    @param {HTMLElement} label */
function baselineOf(label) {
  const mark = document.createElement('i');
  mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  label.append(mark);
  const y = mark.getBoundingClientRect().bottom;
  mark.remove();
  return y;
}

/** @param {HTMLElement[]} tabs @param {DOMRect} bar @param {() => void} onReady @returns {TabInks} */
export function tabInks(tabs, bar, onReady) {
  /** @type {TabInk[]} */
  const items = [];
  let pending = false;
  let key = '';
  for (const tab of tabs) {
    const svg = /** @type {SVGSVGElement|null} */ (tab.querySelector('svg'));
    const source = svg ? iconSource(svg) : null;
    const label = tab.querySelector('span');
    const ink = /** @type {TabInk} */ ({
      img: null,
      ix: 0,
      iy: 0,
      iw: 0,
      ih: 0,
      text: '',
      face: '',
      color: '',
      rtl: false,
      lx: 0,
      lw: 0,
      base: 0,
    });
    if (svg && source) {
      const r = svg.getBoundingClientRect();
      const color = getComputedStyle(svg).color;
      const accent = accentOf(svg);
      Object.assign(ink, { ix: r.left - bar.left, iy: r.top - bar.top, iw: r.width, ih: r.height });
      ink.img = iconImage(source, color, accent, r.width, r.height, onReady);
      if (!ink.img) pending = true;
      key += `${source.id || hash(new XMLSerializer().serializeToString(source))}${color}${accent}${r.left - bar.left},${r.top - bar.top},${r.width};`;
    }
    if (label) {
      const r = label.getBoundingClientRect();
      const cs = getComputedStyle(label);
      ink.text = label.textContent ?? '';
      ink.face = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      ink.color = cs.color;
      ink.rtl = cs.direction === 'rtl';
      Object.assign(ink, { lx: r.left - bar.left, lw: r.width, base: baselineOf(label) - bar.top });
      key += `${ink.text}${ink.face}${ink.color}${ink.lx},${ink.base};`;
    }
    items.push(ink);
  }
  return { items, key, pending };
}

/** @param {CanvasRenderingContext2D} gx @param {TabInk[]} items @param {number} pad */
export function drawTabInks(gx, items, pad) {
  for (const t of items) {
    if (t.img) gx.drawImage(t.img, pad + t.ix, pad + t.iy, t.iw, t.ih);
    if (!t.text) continue;
    gx.font = t.face;
    gx.fillStyle = t.color;
    gx.direction = t.rtl ? 'rtl' : 'ltr';
    gx.textAlign = t.rtl ? 'right' : 'left';
    gx.textBaseline = 'alphabetic';
    gx.fillText(t.text, pad + (t.rtl ? t.lx + t.lw : t.lx), pad + t.base);
  }
}

/** @param {number} cx @param {number} cy @param {number} w @param {number} h */
export function pillPath(cx, cy, w, h) {
  const r = Math.min(w, h) / 2;
  const f = (/** @type {number} */ v) => v.toFixed(2);
  const x0 = cx - w / 2 + r;
  const x1 = cx + w / 2 - r;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return `M${f(x0)} ${f(y0)}H${f(x1)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y1)}H${f(x0)}A${f(r)} ${f(r)} 0 0 1 ${f(x0)} ${f(y0)}Z`;
}
