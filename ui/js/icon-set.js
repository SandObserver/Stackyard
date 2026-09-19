const T = { SW: 2, G: 2, R_LG: 4, R_MD: 3, R_SM: 2, BAR: 2, DOT: 2, NODE: 3, PAD: 3 };

const ROLE = { ink: 'i', faint: 'i3', accent: 'a', cut: 'c' };
const rl = r => ROLE[r] || r;

export const rect = (x, y, w, h, r, role = 'ink', o = {}) => ({
  k: 'area',
  t: 'rect',
  x,
  y,
  w,
  h,
  r,
  role: rl(role),
  ...o,
});
export const detail = (x, y, w, h, r, role = 'ink', o = {}) => ({
  k: 'solid',
  t: 'rect',
  x,
  y,
  w,
  h,
  r,
  role: rl(role),
  ...o,
});
export const bar = (x, y, w, role = 'cut') => detail(x, y, w, T.BAR, T.BAR / 2, role);
export const circle = (cx, cy, r, role = 'ink') => ({ k: 'area', t: 'circle', cx, cy, r, role: rl(role) });
export const dot = (cx, cy, r, role = 'ink') => ({ k: 'solid', t: 'circle', cx, cy, r, role: rl(role) });
export const shape = (d, role = 'ink', o = {}) => ({ k: 'area', t: 'path', d, role: rl(role), ...o });
export const line = (d, role = 'ink') => ({ k: 'line', t: 'path', d, role: rl(role) });
export const ring = (cx, cy, r, role = 'ink') => ({ k: 'line', t: 'circle', cx, cy, r, role: rl(role) });

export const STYLES = {
  stroke: { line: true, accent: 'ink' },
  twotone: { line: true, accent: 'accent' },
  duotone: { line: true, accent: 'accent', accentFill: true },
  solid: { line: false, accent: 'accent' },
  bulk: { line: false, accent: 'ink', inkFaint: true },
};

function colour(role, st) {
  if (role === 'a') return st.accent === 'ink' ? 'i' : 'a';
  if (role === 'i3') return 'i3';
  return st.inkFaint ? 'i3' : 'i';
}
function strokeAttrs(sharp, w = T.SW) {
  return ` stroke-width="${w}" stroke-linecap="${sharp ? 'square' : 'round'}" stroke-linejoin="${sharp ? 'miter' : 'round'}"`;
}
function geom(p, sharp, inset) {
  const tr = p.transform ? ` transform="${p.transform}"` : '';
  if (p.t === 'rect') {
    const d = inset ? 1 : 0;
    const r = sharp ? 0 : Math.max(0, p.r - d);
    return `<rect x="${p.x + d}" y="${p.y + d}" width="${p.w - 2 * d}" height="${p.h - 2 * d}" rx="${r}"${tr}`;
  }
  if (p.t === 'circle') return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r - (inset ? 1 : 0)}"${tr}`;
  return `<path d="${p.d}"${tr}`;
}
function draw(p, st, sharp) {
  const cls = colour(st.line && p.role === 'c' ? 'i' : p.role, st);
  const outlined = st.line && p.k === 'area' && !(st.accentFill && p.role === 'a');
  if (p.k === 'line' || outlined)
    return `${geom(p, sharp, outlined)} class="sy-${cls}s" fill="none"${strokeAttrs(sharp)}/>`;
  if (p.rj) return `${geom(p, sharp, false)} class="sy-${cls} sy-${cls}s"${strokeAttrs(sharp)}/>`;
  return `${geom(p, sharp, false)} class="sy-${cls}"/>`;
}
function hole(p, sharp, grow) {
  if (p.k === 'line')
    return `${geom(p, sharp, false)} fill="none" stroke="#000"${strokeAttrs(sharp, T.SW + 2 * grow)}/>`;
  return `${geom(p, sharp, false)} fill="#000"${grow ? ` stroke="#000"${strokeAttrs(sharp, 2 * grow)}` : ''}/>`;
}
function mask(id, content) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>${content}</mask>`;
}

export function symbol(id, ic, styleId = 'solid', sharp = false) {
  const st = STYLES[styleId];
  const gap = ic.gap ?? T.G;
  const sid = `sy-${styleId}${sharp ? '-sharp' : ''}-${id}`;
  const shapes = ic.shapes.map(p => (st.line && p.lineAlt ? { ...p, ...p.lineAlt } : p));
  const ink = shapes.filter(p => p.role !== 'a' && (st.line || p.role !== 'c'));
  const acc = shapes.filter(p => p.role === 'a');
  let holes = st.line
    ? ''
    : shapes
        .filter(p => p.role === 'c')
        .map(p => hole(p, sharp, 0))
        .join('');
  if (ic.inkMask !== false) holes += acc.map(p => hole(p, sharp, gap)).join('');
  let defs = '';
  let inkAttr = '';
  let accAttr = '';
  if (holes) {
    defs += mask(`${sid}-m`, holes);
    inkAttr = ` mask="url(#${sid}-m)"`;
  }
  if (ic.accentCut) {
    defs += mask(`${sid}-am`, ic.accentCut.map(p => hole(p, sharp, p.grow ?? 0)).join(''));
    accAttr = ` mask="url(#${sid}-am)"`;
  }
  const body = `<g${inkAttr}>${ink.map(p => draw(p, st, sharp)).join('')}</g><g${accAttr}>${acc.map(p => draw(p, st, sharp)).join('')}</g>`;
  return { defs, sym: `<symbol id="${sid}" viewBox="0 0 24 24">${body}</symbol>` };
}

const knob = (x, y) => detail(x, y, 10, 4, 2, 'ink', { lineAlt: { x: x + 1, y: y + 1, w: 8, h: 2, r: 1 } });
const TOGGLES = {
  inkMask: false,
  shapes: [rect(2, 3, 20, 8, 4, 'accent'), knob(10, 5), rect(2, 13, 20, 8, 4, 'faint'), knob(4, 15)],
  accentCut: [detail(10, 5, 10, 4, 2)],
};
const CLOUD = 'M6 20h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.2A3.5 3.5 0 0 0 6 20z';

function sizeIcon(k) {
  const [x, y, w, h] = { small: [5, 5, 14, 14], medium: [2, 7, 20, 10], large: [3, 3, 18, 18], xlarge: [5, 2, 14, 20] }[
    k
  ];
  const ix = x + T.PAD;
  const iw = w - 2 * T.PAD;
  const shapes = [rect(x, y, w, h, T.R_LG)];
  if (k === 'medium') {
    const cy = y + (h - T.BAR) / 2;
    shapes.push(bar(ix, cy, 6, 'accent'), bar(ix + 6 + T.G, cy, iw - 6 - T.G));
    return { gap: 0, shapes };
  }
  const rows = Math.floor((h - 2 * T.PAD + T.G) / (T.BAR + T.G));
  shapes.push(bar(ix, y + T.PAD, Math.min(8, iw - 2), 'accent'));
  for (let i = 1; i < rows; i++)
    shapes.push(bar(ix, y + T.PAD + i * (T.BAR + T.G), i === rows - 1 && rows > 2 ? iw - 4 : iw));
  return { gap: 0, shapes };
}

export const ICONS = {
  general: TOGGLES,
  appearance: {
    inkMask: false,
    shapes: [shape('M11 2.05A10 10 0 0 0 11 21.95z'), shape('M13 2.05A10 10 0 0 1 13 21.95z', 'accent')],
  },
  dashboard: {
    inkMask: false,
    shapes: [rect(3, 3, 18, 8, T.R_MD, 'accent'), rect(3, 13, 8, 8, T.R_MD), rect(13, 13, 8, 8, T.R_MD)],
  },

  app: { shapes: [rect(3, 5, 16, 16, T.R_LG), dot(19, 5, T.NODE, 'accent')] },
  folder: {
    gap: 0,
    shapes: [
      rect(3, 3, 18, 18, T.R_LG),
      detail(6, 6, 5, 5, T.R_SM, 'accent'),
      detail(13, 6, 5, 5, T.R_SM, 'cut'),
      detail(6, 13, 5, 5, T.R_SM, 'cut'),
      detail(13, 13, 5, 5, T.R_SM, 'cut'),
    ],
  },
  widget: { gap: 0, shapes: [rect(2, 4, 20, 16, T.R_LG), bar(5, 7, 8, 'accent'), bar(5, 11, 14), bar(5, 15, 10)] },

  small: sizeIcon('small'),
  medium: sizeIcon('medium'),
  large: sizeIcon('large'),
  xlarge: sizeIcon('xlarge'),

  backup: { shapes: [line('M5 12a7 7 0 1 0 2-5L5 9'), line('M12 8v4l3 2'), line('M5 4v5h5', 'accent')] },
  books: {
    inkMask: false,
    shapes: [
      rect(3, 6, 4, 15, T.R_SM),
      rect(9, 4, 4, 17, T.R_SM, 'accent'),
      rect(15, 6, 4, 15, T.R_SM, 'ink', { transform: 'rotate(-15 15 21)' }),
    ],
  },
  clock: {
    inkMask: false,
    shapes: [ring(12, 12, 9), line('M12 12l4 2'), line('M12 12V7', 'accent'), dot(12, 12, T.DOT, 'accent')],
  },
  connections: {
    shapes: [
      line('M12 5 5 19M12 5l7 14M5 19h14'),
      dot(5, 19, T.NODE),
      dot(19, 19, T.NODE),
      dot(12, 5, T.NODE, 'accent'),
    ],
  },
  switcher: {
    inkMask: false,
    shapes: [detail(2, 7, 3, 10, 1, 'faint'), detail(19, 7, 3, 10, 1, 'faint'), rect(7, 4, 10, 16, T.R_MD, 'accent')],
  },
  disk: { inkMask: false, shapes: [shape('M8 4h8l4 8H4z'), rect(2, 14, 20, 6, T.R_SM), dot(17, 17, T.DOT, 'accent')] },
  dns: {
    inkMask: false,
    shapes: [detail(2, 5, 4, 14, T.R_SM), line('M9 12c5 0 6-6 12-6M9 12h12'), line('M9 12c5 0 6 6 12 6', 'accent')],
  },
  github: {
    inkMask: false,
    shapes: [
      line('M7 5v14'),
      dot(7, 5, T.NODE),
      dot(7, 19, T.NODE),
      line('M7 10c0 4 4 4 10 4', 'accent'),
      dot(17, 14, T.NODE, 'accent'),
    ],
  },
  nowplaying: { shapes: [rect(3, 3, 18, 18, T.R_LG), shape('M10 8v8l6-4z', 'accent', { rj: true })] },
  system: { shapes: [line('M3 16 7 12 11 15 16 8'), dot(19, 6, T.NODE, 'accent')] },
  weather: {
    inkMask: false,
    shapes: [shape(CLOUD), circle(17, 8, 4, 'accent')],
    accentCut: [{ ...shape(CLOUD), grow: T.G }],
  },

  edit: { shapes: [shape('M14 5l5 5L9 20H4v-5z'), line('M12 7l5 5', 'cut')] },
  chevrons: { shapes: [line('M8 9l4-4 4 4'), line('M8 15l4 4 4-4')] },
  back: { shapes: [line('M15 5l-7 7 7 7')] },
  up: { shapes: [line('M6 15l6-6 6 6')] },
  'hue-lo': { shapes: [line('M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z')] },
  'hue-hi': { shapes: [shape('M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z')] },
  'sat-lo': { shapes: [ring(12, 12, 8)] },
  'sat-hi': { shapes: [ring(12, 12, 8), shape('M12 4a8 8 0 0 1 0 16z')] },
  'bright-lo': { shapes: [dot(12, 12, 3), line('M12 5v1M12 18v1M5 12h1M18 12h1')] },
  'bright-hi': { shapes: [dot(12, 12, 4), line('M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1')] },
  external: { shapes: [line('M14 4h6v6M20 4l-9 9'), line('M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4')] },
  docs: { shapes: [rect(4, 2, 16, 20, T.R_MD), bar(7, 7, 6), bar(7, 11, 10), bar(7, 15, 8)] },
  issue: { shapes: [circle(12, 12, 10), line('M12 7v6', 'cut'), detail(11, 16, 2, 2, 1, 'cut')] },
  info: { shapes: [circle(12, 12, 10), line('M12 11v6', 'cut'), detail(11, 6, 2, 2, 1, 'cut')] },
  heart: { shapes: [shape('M12 21l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z')] },
  grip: {
    shapes: [
      dot(9, 6, T.DOT),
      dot(15, 6, T.DOT),
      dot(9, 12, T.DOT),
      dot(15, 12, T.DOT),
      dot(9, 18, T.DOT),
      dot(15, 18, T.DOT),
    ],
  },
  eye: { shapes: [line('M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z'), dot(12, 12, 3)] },
  search: { shapes: [ring(10, 10, 7), line('M15 15l6 6')] },
  'arrow-down': { shapes: [line('M12 4v15M6 13l6 6 6-6')] },
  'arrow-up': { shapes: [line('M12 20V5M6 11l6-6 6 6')] },
};

export function iconSvg(id, px = 24, variant = 'solid', cls = '') {
  return `<svg class="sy-icon${cls ? ` ${cls}` : ''}" width="${px}" height="${px}" aria-hidden="true" focusable="false"><use href="#sy-${variant}-${id}"/></svg>`;
}

export function ensureSprite(doc = document, variant = 'solid') {
  if (doc.getElementById('sy-sprite')) return;
  let defs = '';
  let syms = '';
  for (const [id, ic] of Object.entries(ICONS)) {
    const s = symbol(id, ic, variant);
    defs += s.defs;
    syms += s.sym;
  }
  const src = `<svg xmlns="http://www.w3.org/2000/svg" id="sy-sprite" class="sy-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>${defs}</defs>${syms}</svg>`;
  const svg = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement;
  doc.body.prepend(doc.importNode(svg, true));
}
