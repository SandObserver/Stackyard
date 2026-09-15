import { smoothRectPath } from '/js/smooth-corner.js?v=b7dda7e1';

const NS = 'http://www.w3.org/2000/svg';
let seq = 0;
const observers = new WeakMap();

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The glass edge line: lighter along top and bottom than down the sides.
    Clip the host to the same path `d`, or half of the stroke paints outside it.
    @param {number} w @param {number} h @param {string} d @returns {SVGSVGElement} */
export function mkGlassRim(w, h, d) {
  const id = `glass-rim-${++seq}`;
  const edge = Math.min(0.5, 14 / h);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'glass-rim');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const line = svgEl('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: h });
  for (const [offset, cls] of [
    [0, 'glass-rim-light'],
    [edge, 'glass-rim-dark'],
    [1 - edge, 'glass-rim-dark'],
    [1, 'glass-rim-light'],
  ]) {
    line.appendChild(svgEl('stop', { offset, class: cls }));
  }
  const defs = svgEl('defs', {});
  defs.appendChild(line);
  svg.appendChild(defs);
  svg.appendChild(svgEl('path', { d, stroke: `url(#${id})`, 'stroke-width': 1.5 }));
  return svg;
}

/** Glass behind a host, redrawn on every resize.
    The host must be positioned and set isolation:isolate, or the layer paints over its content.
    @param {HTMLElement} host @param {number} radius @param {number} smoothing
    @returns {() => void} stops the redraws */
export function observeGlass(host, radius, smoothing) {
  observers.get(host)?.disconnect();
  const layer = document.createElement('div');
  layer.className = 'glass-layer glass-surface';
  host.prepend(layer);
  const draw = () => {
    const w = host.offsetWidth;
    const h = host.offsetHeight;
    if (!w || !h) return;
    const d = smoothRectPath(w, h, radius, smoothing);
    layer.style.clipPath = `path('${d}')`;
    layer.replaceChildren(mkGlassRim(w, h, d));
  };
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  observers.set(host, ro);
  return () => ro.disconnect();
}
