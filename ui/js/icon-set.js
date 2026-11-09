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
export const line = (d, role = 'ink', o = {}) => ({ k: 'line', t: 'path', d, role: rl(role), ...o });
export const ring = (cx, cy, r, role = 'ink') => ({ k: 'line', t: 'circle', cx, cy, r, role: rl(role) });
export const frame = (x, y, w, h, r = T.R_MD) => ({ k: 'line', t: 'rect', x, y, w, h, r, role: 'i', box: true });
const face = () => ({ ...ring(12, 12, 9), box: true });

export const STYLES = {
  solid: { line: false, accent: 'accent' },
  filled: { line: false, accent: 'accent', fillBoxes: true },
  stroke: { line: true, accent: 'ink' },
  duotone: { line: true, accent: 'accent', accentFill: true, tint: true },
};
export const WEIGHTS = { light: 1.5, regular: 2, bold: 2.5 };

function colour(role, st) {
  if (role === 'a') return st.accent === 'ink' ? 'i' : 'a';
  if (role === 'i3') return 'i3';
  if (role === 't') return 'i2';
  return 'i';
}
function strokeAttrs(sharp, w) {
  return ` stroke-width="${w}" stroke-linecap="${sharp ? 'square' : 'round'}" stroke-linejoin="${sharp ? 'miter' : 'round'}"`;
}
function geom(p, sharp, inset) {
  const tr = p.transform ? ` transform="${p.transform}"` : '';
  if (p.t === 'rect') {
    const r = sharp ? 0 : Math.max(0, p.r - inset);
    return `<rect x="${p.x + inset}" y="${p.y + inset}" width="${p.w - 2 * inset}" height="${p.h - 2 * inset}" rx="${r}"${tr}`;
  }
  if (p.t === 'circle') return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r - inset}"${tr}`;
  return `<path d="${p.d}"${tr}`;
}
function draw(p, st, sharp, sw, clipId) {
  const cls = colour(st.line && p.role === 'c' ? 'i' : p.role, st);
  const outlined = st.line && p.k === 'area' && !(st.accentFill && p.role === 'a');
  if (outlined && p.t === 'path') {
    const tr = p.transform ? ` transform="${p.transform}"` : '';
    return `<clipPath id="${clipId}"><path d="${p.d}"${tr}/></clipPath><path d="${p.d}"${tr} clip-path="url(#${clipId})" class="sy-${cls}s" fill="none"${strokeAttrs(sharp, sw * 2)}/>`;
  }
  if (p.k === 'line' || outlined)
    return `${geom(p, sharp, outlined ? sw / 2 : 0)} class="sy-${cls}s" fill="none"${strokeAttrs(sharp, sw)}/>`;
  if (p.rj) return `${geom(p, sharp, 0)} class="sy-${cls} sy-${cls}s"${strokeAttrs(sharp, sw)}/>`;
  return `${geom(p, sharp, 0)} class="sy-${cls}"/>`;
}
function hole(p, sharp, grow, sw) {
  if (p.k === 'line') return `${geom(p, sharp, 0)} fill="none" stroke="#000"${strokeAttrs(sharp, sw + 2 * grow)}/>`;
  return `${geom(p, sharp, 0)} fill="#000"${grow ? ` stroke="#000"${strokeAttrs(sharp, 2 * grow)}` : ''}/>`;
}
function mask(id, content) {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>${content}</mask>`;
}

function filledIcon(ic) {
  if (ic.filled) return ic.filled;
  const i = ic.shapes.findIndex(p => p.box);
  if (i < 0) return ic;
  const b = ic.shapes[i];
  const body = b.t === 'rect' ? rect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, b.r + 1) : circle(b.cx, b.cy, b.r + 1);
  const rest = ic.shapes.slice(i + 1).map(p => (p.role === 'a' ? p : { ...p, role: 'c' }));
  return { ...ic, gap: 1, inkMask: true, shapes: [...ic.shapes.slice(0, i), body, ...rest] };
}
function tinted(p) {
  if (p.box) return [{ ...p, k: 'solid', box: false, role: 't' }, p];
  if (p.role === 'i' && p.k === 'area' && !p.lineAlt) return [{ ...p, k: 'solid', rj: false, role: 't' }, p];
  return [p];
}
function weighted(p, sw) {
  const d = (sw - T.SW) / 2;
  if (!d || p.k !== 'solid') return p;
  if (p.t === 'circle') return { ...p, r: p.r + d };
  if (p.h === T.BAR) return { ...p, y: p.y - d, h: T.BAR + 2 * d, r: p.r + d };
  if (p.w === T.BAR) return { ...p, x: p.x - d, w: T.BAR + 2 * d, r: p.r + d };
  return p;
}

export function symbol(id, icon, styleId = 'solid', sharp = false, sw = T.SW) {
  const st = STYLES[styleId];
  const ic = st.fillBoxes ? filledIcon(icon) : icon;
  const gap = ic.gap ?? T.G;
  const sid = `sy-${styleId}${sharp ? '-sharp' : ''}${sw === T.SW ? '' : `-w${sw * 10}`}-${id}`;
  const shapes = ic.shapes
    .map(p => (st.line && p.lineAlt ? { ...p, ...p.lineAlt } : p))
    .map(p => weighted(p, sw))
    .flatMap(p => (st.tint ? tinted(p) : [p]));
  const ink = shapes.filter(p => p.role !== 'a' && !p.knock && (st.line || p.role !== 'c'));
  const knock = shapes.filter(p => p.knock);
  const acc = shapes.filter(p => p.role === 'a');
  let holes = st.line
    ? ''
    : shapes
        .filter(p => p.role === 'c')
        .map(p => hole(p, sharp, 0, sw))
        .join('');
  if (ic.inkMask !== false) holes += acc.map(p => hole(p, sharp, gap, sw)).join('');
  holes += knock.map(p => hole(p, sharp, gap, sw)).join('');
  let defs = '';
  let inkAttr = '';
  let accAttr = '';
  if (holes) {
    defs += mask(`${sid}-m`, holes);
    inkAttr = ` mask="url(#${sid}-m)"`;
  }
  if (ic.accentCut) {
    defs += mask(`${sid}-am`, ic.accentCut.map(p => hole(p, sharp, p.grow ?? 0, sw)).join(''));
    accAttr = ` mask="url(#${sid}-am)"`;
  }
  let n = 0;
  const paint = p => draw(p, st, sharp, sw, `${sid}-c${n++}`);
  const body = `<g${inkAttr}>${ink.map(paint).join('')}</g>${knock.map(paint).join('')}<g${accAttr}>${acc.map(paint).join('')}</g>`;
  /* Bold round caps cross the 24-unit box without this scale and get clipped. */
  const fitted = sw > T.SW ? `<g transform="translate(12 12) scale(.975) translate(-12 -12)">${body}</g>` : body;
  return { defs, sym: `<symbol id="${sid}" viewBox="0 0 24 24">${fitted}</symbol>` };
}

function logoIcon() {
  const f = n => +n.toFixed(3);
  const k = 24 / 1024;
  const R = 331 * k;
  const wA = 151 * k;
  const wB = 158 * k;
  const at = (deg, r) => [f(12 + r * Math.cos((deg * Math.PI) / 180)), f(12 + r * Math.sin((deg * Math.PI) / 180))];
  const capsule = end => {
    const [dx, dy] = [end[0] - 12, end[1] - 12];
    const n = [f((-dy / R) * (wB / 2)), f((dx / R) * (wB / 2))];
    const r = f(wB / 2);
    const d = `M${12 + n[0]} ${12 + n[1]}L${f(end[0] + n[0])} ${f(end[1] + n[1])}A${r} ${r} 0 0 0 ${f(end[0] - n[0])} ${f(end[1] - n[1])}L${12 - n[0]} ${12 - n[1]}A${r} ${r} 0 0 0 ${12 + n[0]} ${12 + n[1]}Z`;
    return shape(d, 'ink', { lineAlt: { k: 'line', d: `M12 12L${end}` } });
  };
  const [ro, ri, h] = [f(R + wA / 2), f(R - wA / 2), f(wA / 2)];
  const arc = `M${at(-90, ro)}A${ro} ${ro} 0 0 1 ${at(30, ro)}A${h} ${h} 0 0 1 ${at(30, ri)}A${ri} ${ri} 0 0 0 ${at(-90, ri)}A${h} ${h} 0 0 1 ${at(-90, ro)}Z`;
  return {
    inkMask: false,
    shapes: [
      capsule(at(210, R)),
      capsule(at(150, R)),
      capsule(at(90, R)),
      shape(arc, 'accent', { lineAlt: { k: 'line', d: `M${at(-90, R)}A${f(R)} ${f(R)} 0 0 1 ${at(30, R)}` } }),
    ],
  };
}

const LOGO = logoIcon();

const CLOUD = 'M6 20h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.2A3.5 3.5 0 0 0 6 20z';
const EYE = 'M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z';
const DROP = 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z';
const RAYS = 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1';
const PENCIL = 'M15 4l5 5L9 20H4v-5z';
const TRIANGLE = 'M12 4l9 16H3z';
const PLAY = 'M10 9v6l5-3z';
const solidPart = p => ({ ...p, k: 'solid' });
const free = (...shapes) => ({ inkMask: false, shapes });
const SLASH = () => line('M4 4l16 16', 'ink', { knock: true });

export const ICONS = {
  general: {
    inkMask: false,
    shapes: [rect(2, 3, 20, 8, 4, 'accent'), frame(3, 14, 18, 6, 3), detail(5, 16, 6, 2, 1)],
    accentCut: [detail(13, 5, 7, 4, 2)],
  },
  appearance: free(face(), shape('M12 6a6 6 0 0 1 0 12z', 'accent')),
  dashboard: free(rect(3, 5, 18, 6, T.R_SM), rect(3, 13, 8, 6, T.R_SM), rect(13, 13, 8, 6, T.R_SM, 'accent')),

  app: { shapes: [rect(3, 6, 15, 15, T.R_LG), dot(19, 5, T.NODE, 'accent')] },
  folder: free(
    rect(4, 4, 7, 7, T.R_SM, 'accent'),
    rect(13, 4, 7, 7, T.R_SM),
    rect(4, 13, 7, 7, T.R_SM),
    rect(13, 13, 7, 7, T.R_SM),
  ),
  widget: free(frame(3, 5, 18, 14), bar(6, 9, 8, 'accent'), bar(6, 13, 12, 'ink')),

  small: free(frame(6, 6, 12, 12), bar(9, 9, 6, 'accent'), bar(9, 13, 6, 'ink')),
  medium: free(frame(3, 8, 18, 8), bar(6, 11, 5, 'accent'), bar(13, 11, 5, 'ink')),
  large: free(frame(4, 4, 16, 16), bar(7, 7, 7, 'accent'), bar(7, 11, 10, 'ink'), bar(7, 15, 10, 'ink')),
  xlarge: free(frame(6, 3, 12, 18), bar(9, 7, 4, 'accent'), bar(9, 11, 6, 'ink'), bar(9, 15, 6, 'ink')),

  backup: {
    shapes: [line('M4 12a8 8 0 1 0 2.3-5.7L4 9'), line('M12 8v4l3 3'), line('M4 4v5h5', 'accent')],
    filled: { shapes: [circle(13, 13, 9), line('M13 9v4l3 2', 'cut'), line('M3 2v6h6', 'accent')] },
  },
  books: free(
    rect(3, 6, 4, 15, T.R_SM),
    rect(9, 4, 4, 17, T.R_SM, 'accent'),
    rect(17, 8, 4, 13, T.R_SM, 'ink', { transform: 'rotate(-15 17 21)' }),
  ),
  clock: free(face(), line('M12 12l3 3'), line('M12 12V6', 'accent')),
  connections: {
    shapes: [
      line('M12 5 5 19M12 5l7 14M5 19h14'),
      dot(5, 19, T.NODE),
      dot(19, 19, T.NODE),
      dot(12, 5, T.NODE, 'accent'),
    ],
  },
  switcher: free(detail(2, 7, 3, 10, 1), detail(19, 7, 3, 10, 1), rect(7, 4, 10, 16, T.R_MD, 'accent')),
  disk: free(frame(3, 5, 18, 14), detail(7, 8, 2, 8, 1), detail(11, 8, 2, 8, 1), detail(15, 8, 2, 8, 1, 'accent')),
  dns: free(
    detail(2, 4, 3, 16, 1),
    shape('M7 5C14 5 15 2 22 2V6C15 6 14 9 7 9Z'),
    detail(7, 11, 15, 2, 1),
    shape('M7 15C14 15 15 18 22 18V22C15 22 14 19 7 19Z', 'accent'),
  ),
  github: {
    shapes: [
      line('M7 5v14'),
      dot(7, 5, T.NODE),
      dot(7, 19, T.NODE),
      line('M7 10c0 4 4 4 10 4'),
      dot(17, 14, T.NODE, 'accent'),
    ],
  },
  downloads: {
    ...free(frame(5, 3, 14, 12), line('M12 6v5M9 9l3 3 3-3', 'accent'), bar(3, 19, 18, 'ink')),
    filled: {
      gap: 1,
      shapes: [rect(4, 2, 16, 14, T.R_LG), line('M12 6v5M9 9l3 3 3-3', 'accent'), bar(3, 19, 18, 'ink')],
    },
  },
  nowplaying: {
    ...free(frame(4, 4, 16, 16), shape(PLAY, 'accent', { rj: true })),
    filled: { gap: 2, shapes: [rect(3, 3, 18, 18, T.R_LG), shape(PLAY, 'accent', { rj: true })] },
  },
  upnext: free(
    line('M8 3v3M16 3v3'),
    frame(3, 5, 18, 16),
    bar(7, 10, 10, 'ink'),
    detail(13, 14, 4, 4, T.R_SM, 'accent'),
  ),
  system: {
    shapes: [line('M3 16l5-5 4 4 5-5'), dot(19, 6, T.NODE, 'accent'), bar(3, 20, 18, 'ink')],
    filled: { shapes: [shape('M3 20v-2l5-5 4 4 5-5v8z', 'ink', { rj: true }), dot(19, 7, T.NODE, 'accent')] },
  },
  weather: {
    inkMask: false,
    shapes: [shape(CLOUD), circle(17, 8, 4, 'accent')],
    accentCut: [{ ...shape(CLOUD), grow: T.G }],
  },

  uv: { shapes: [circle(12, 12, 5, 'accent'), line(RAYS)] },
  air: free(
    line('M3 7c3-2 6-2 9 0s6 2 9 0'),
    line('M3 12c3-2 6-2 9 0s6 2 9 0', 'accent'),
    line('M3 17c3-2 6-2 9 0s6 2 9 0'),
  ),

  edit: {
    ...free(line(PENCIL), line('M13 6l5 5')),
    filled: { shapes: [shape(PENCIL, 'ink', { rj: true }), line('M13 6l5 5', 'cut')] },
  },
  chevrons: { shapes: [line('M8 9l4-4 4 4'), line('M8 15l4 4 4-4')] },
  back: { shapes: [line('M15 5l-7 7 7 7')] },
  up: { shapes: [line('M6 15l6-6 6 6')] },
  'hue-lo': { shapes: [line(DROP)] },
  'hue-hi': { shapes: [solidPart(shape(DROP))] },
  'sat-lo': { shapes: [ring(12, 12, 8)] },
  'sat-hi': { shapes: [ring(12, 12, 8), solidPart(shape('M12 4a8 8 0 0 1 0 16z'))] },
  'bright-lo': { shapes: [dot(12, 12, 3), line('M12 5v1M12 18v1M5 12h1M18 12h1')] },
  'bright-hi': { shapes: [dot(12, 12, 4), line(RAYS)] },
  external: { shapes: [line('M14 4h6v6M20 4l-9 9'), line('M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4')] },
  docs: free(frame(6, 3, 12, 18), bar(9, 7, 6, 'ink'), bar(9, 11, 6, 'ink'), bar(9, 15, 4, 'ink')),
  bug: {
    shapes: [
      shape('M9 6a3 3 0 0 1 6 0z'),
      shape('M6 14a6 6 0 0 1 12 0v2a6 6 0 0 1-12 0z'),
      line('M12 11v8', 'cut'),
      line('M3 9l1 1M21 9l-1 1M3 21l1-1M21 21l-1-1'),
    ],
  },
  info: free(face(), line('M12 11v5'), detail(11, 7, 2, 2, 1)),
  success: free(face(), line('M8 12l3 3 6-6')),
  failure: free(face(), line('M9 9l6 6M15 9l-6 6')),
  check: { shapes: [line('M5 13l4 4 10-10')] },
  plus: { shapes: [line('M12 5v14M5 12h14')] },
  warning: {
    ...free(line(TRIANGLE), line('M12 10v4'), detail(11, 16, 2, 2, 1)),
    filled: { shapes: [shape(TRIANGLE, 'ink', { rj: true }), line('M12 10v4', 'cut'), detail(11, 16, 2, 2, 1, 'cut')] },
  },
  heart: { shapes: [shape('M12 21C5 16 3 13 3 9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 4-2 7-9 12z')] },
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
  eye: {
    shapes: [line(EYE), dot(12, 12, 3)],
    filled: { gap: 0, shapes: [shape(EYE), dot(12, 12, 3, 'cut')] },
  },
  'eye-slash': {
    shapes: [line(EYE), dot(12, 12, 3), SLASH()],
    filled: { gap: 2, shapes: [shape(EYE), dot(12, 12, 3, 'cut'), SLASH()] },
  },
  search: {
    shapes: [ring(10, 10, 7), line('M15 15l6 6')],
    filled: free(circle(10, 10, 8), line('M15 15l6 6')),
  },
  'arrow-down': { shapes: [line('M12 4v15M6 13l6 6 6-6')] },
  'arrow-up': { shapes: [line('M12 20V5M6 11l6-6 6 6')] },

  'err-offline': {
    shapes: [
      line('M4 12a11 11 0 0 1 16 0'),
      line('M8 16a6 6 0 0 1 8 0'),
      dot(12, 20, T.DOT),
      line('M3 3l18 18', 'ink', { knock: true }),
    ],
  },
  'err-slow': free(face(), line('M12 7v5l3 3')),
  'err-key': {
    ...free(frame(5, 11, 14, 10), line('M8 11V7a4 4 0 0 1 8 0v4'), detail(11, 15, 2, 2, 1)),
    filled: { shapes: [rect(4, 10, 16, 12, T.R_MD), line('M8 10V7a4 4 0 0 1 8 0v3'), detail(11, 15, 2, 3, 1, 'cut')] },
  },
  'err-blocked': free(face(), line('M6 6l12 12')),
  'err-unset': { shapes: [line('M3 8h1M14 8h7M3 16h7M20 16h1'), dot(9, 8, T.NODE), dot(15, 16, T.NODE)] },
  'err-odd': free(face(), line('M12 7v6'), detail(11, 16, 2, 2, 1)),

  logo: LOGO,
  /* The About logo turns its arc alone, so it needs the two halves apart. */
  'logo-ink': { inkMask: false, shapes: LOGO.shapes.slice(0, 3) },
  'logo-arc': { inkMask: false, shapes: LOGO.shapes.slice(3) },
  start: { inkMask: false, shapes: [line('M12 2v9M8 7l4 4 4-4', 'accent'), rect(2, 14, 20, 8, 4), bar(5, 17, 6)] },
  run: free(frame(3, 5, 18, 14), line('M7 9l3 3-3 3', 'accent'), bar(13, 14, 5, 'ink')),
  create: {
    shapes: [frame(4, 6, 14, 14), line('M19 3v4M17 5h4', 'accent'), bar(7, 11, 5, 'ink'), bar(7, 15, 8, 'ink')],
  },
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
