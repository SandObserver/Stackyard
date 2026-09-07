// @ts-check
/* The failure states every widget shares.

   The API classifies a failure into one of seven kinds and sends the kind
   beside the message (docs/api-errors.md). The kind picks the wording and the
   glyph here. The upstream sentence is never drawn: it names products, ports
   and status codes, and it is not translated.

   A broken widget keeps its layout and goes inert. An empty one stays bright.
   The two must not look alike. */

/* Same 24-unit grid as widget-glyphs.js, stroked with currentColor. Each shape
   is [tag, attributes], built as nodes rather than markup. */
const GLYPHS = {
  offline: [
    ['path', { d: 'M4 4l16 16' }],
    ['path', { d: 'M12 18.6h.01' }],
    ['path', { d: 'M8.1 14.7a5.5 5.5 0 0 1 3.9-1.6' }],
  ],
  slow: [
    ['circle', { cx: '12', cy: '12', r: '7.6' }],
    ['path', { d: 'M12 7.8V12l3 1.8' }],
  ],
  key: [
    ['rect', { x: '5.4', y: '10.6', width: '13.2', height: '8.4', rx: '2.4' }],
    ['path', { d: 'M8.6 10.6V8.2a3.4 3.4 0 0 1 6.8 0v2.4' }],
  ],
  blocked: [
    ['circle', { cx: '12', cy: '12', r: '7.6' }],
    ['path', { d: 'M6.6 6.6l10.8 10.8' }],
  ],
  unset: [
    ['path', { d: 'M4.6 8.4h14.8M4.6 15.6h14.8' }],
    ['circle', { cx: '9.4', cy: '8.4', r: '2.1' }],
    ['circle', { cx: '14.6', cy: '15.6', r: '2.1' }],
  ],
  odd: [
    ['circle', { cx: '12', cy: '12', r: '7.6' }],
    ['path', { d: 'M12 8.2v4.6' }],
    ['path', { d: 'M12 16h.01' }],
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/* kind -> [glyph, catalog key, English] */
const COPY = {
  network: ['offline', 'errNetwork', 'Out of reach'],
  timeout: ['slow', 'errTimeout', 'Took too long'],
  auth: ['key', 'errAuth', 'Key rejected'],
  blocked: ['blocked', 'errBlocked', 'Request blocked'],
  invalid: ['unset', 'errInvalid', 'Not set up yet'],
  upstream: ['odd', 'errUpstream', 'Service error'],
  internal: ['odd', 'errInternal', 'Something went wrong'],
};

const FALLBACK = 'internal';

/** The kind the API sent, or the nearest one a bare fetch failure implies.
    @param {unknown} err @returns {string} */
export function errorKind(err) {
  const e = /** @type {{ kind?: unknown, status?: unknown }} */ (err && typeof err === 'object' ? err : {});
  if (typeof e.kind === 'string' && Object.hasOwn(COPY, e.kind)) return e.kind;
  /* A widget that fetches for itself has only the status. */
  const s = typeof e.status === 'number' ? e.status : 0;
  if (s === 401 || s === 403) return 'auth';
  if (s === 503) return 'invalid';
  if (s === 504) return 'timeout';
  if (s === 502) return 'network';
  if (s >= 400) return 'upstream';
  /* fetch() itself rejected, so nothing answered. */
  return err ? 'network' : FALLBACK;
}

/** One kind's glyph, as an SVG element.
    @param {string} kind @param {Document} doc @returns {SVGElement} */
export function errorGlyph(kind, doc) {
  const [g] = COPY[kind] || COPY[FALLBACK];
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  for (const [tag, attrs] of GLYPHS[g]) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** The catalog key and English wording for a kind.
    @param {string} kind @returns {{ key: string, text: string }} */
export function errorCopy(kind) {
  const [, key, text] = COPY[kind] || COPY[FALLBACK];
  return { key, text };
}

/** The kinds this module knows, for tests and for the catalog. */
export const ERROR_KINDS = Object.freeze(Object.keys(COPY));

/* One drawing per widget, taking the place of the element the widget shows when
   it is working: the sky, the flow, the shelf. Same line language as the glyphs
   above, on each widget's own grid, so the art scales with its slot. */
const ART = {
  /* Weather: the sky, with something rather worse than weather in it. */
  meteor: {
    box: '0 0 100 100',
    shapes: [
      ['circle', { cx: '62', cy: '61', r: '13.5' }],
      ['path', { d: 'M52.5 51.5L30 29' }],
      ['path', { d: 'M60 44.5L45 29.5' }],
      ['path', { d: 'M53 66L31 55' }],
      ['circle', { cx: '24', cy: '46', r: '2.4' }],
      ['circle', { cx: '78', cy: '30', r: '3.2' }],
      ['circle', { cx: '35', cy: '75', r: '1.9' }],
      ['path', { d: 'M14 84h72', 'stroke-dasharray': '5 7', opacity: '0.55' }],
    ],
  },
  /* DNS: the query flow, cut through the middle. */
  severed: {
    box: '0 0 240 120',
    shapes: [
      ['path', { d: 'M6 34h74l16 12-9 5 11 9' }],
      ['path', { d: 'M6 86h64l14-11-10-6' }],
      ['path', { d: 'M234 34h-70l-15 12 9 6-12 8' }],
      ['path', { d: 'M234 86h-60l-13-11 9-6' }],
      ['path', { d: 'M112 22l-7 14 9 5-8 13', opacity: '0.5' }],
      ['path', { d: 'M132 24l6 13-9 6 7 12', opacity: '0.5' }],
    ],
  },
  /* Books: the shelf, undisturbed for a while. */
  web: {
    box: '0 0 100 60',
    align: 'xMinYMin',
    shapes: [
      /* Anchored into the corner: radials out from it, three spirals across. */
      ['path', { d: 'M2 2L2 52' }],
      ['path', { d: 'M2 2L52 2' }],
      ['path', { d: 'M2 2L14 50' }],
      ['path', { d: 'M2 2L30 44' }],
      ['path', { d: 'M2 2L44 30' }],
      ['path', { d: 'M2 2L50 14' }],
      ['path', { d: 'M2 14Q11 11 14 2', opacity: '0.8' }],
      ['path', { d: 'M2 29Q22 22 29 2', opacity: '0.7' }],
      ['path', { d: 'M2 45Q34 33 45 2', opacity: '0.55' }],
      ['circle', { cx: '25', cy: '25', r: '3.2' }],
      ['path', { d: 'M21.6 21.6l-3-3M28.4 21.6l3-3M21.6 28.4l-3 3M28.4 28.4l3 3', opacity: '0.85' }],
    ],
  },
  /* Now playing: the tape, off its spool. */
  tangle: {
    box: '0 0 100 60',
    shapes: [
      ['circle', { cx: '28', cy: '30', r: '11' }],
      ['circle', { cx: '28', cy: '30', r: '3' }],
      ['circle', { cx: '74', cy: '30', r: '11' }],
      ['circle', { cx: '74', cy: '30', r: '3' }],
      ['path', { d: 'M39 26q9 12 -1 17 12 5 20 -3 6 12 16 4' }],
      ['path', { d: 'M85 24q6 8 -2 12', opacity: '0.6' }],
    ],
  },
  /* System summary: the readings, with nothing coming in. */
  flatline: {
    box: '0 0 100 40',
    shapes: [
      ['path', { d: 'M2 20h30l5-9 6 18 5-9h6' }],
      ['path', { d: 'M62 20h36', 'stroke-dasharray': '4 6' }],
      ['circle', { cx: '54', cy: '20', r: '2.2' }],
    ],
  },
  /* Connections: the link itself, in two pieces. */
  unplugged: {
    box: '0 0 100 50',
    shapes: [
      ['path', { d: 'M4 25h24' }],
      ['rect', { x: '28', y: '14', width: '14', height: '22', rx: '3' }],
      ['path', { d: 'M42 20h6M42 30h6' }],
      ['path', { d: 'M96 25H72' }],
      ['rect', { x: '58', y: '14', width: '14', height: '22', rx: '3' }],
      ['path', { d: 'M52 20h6M52 30h6' }],
      ['path', { d: 'M50 8v-5M44 11l-3-4M56 11l3-4', opacity: '0.55' }],
    ],
  },
  /* Backup: the copy nobody checked. */
  torn: {
    box: '0 0 60 74',
    shapes: [
      ['path', { d: 'M8 4h30l14 14v22' }],
      ['path', { d: 'M38 4v14h14', opacity: '0.7' }],
      ['path', { d: 'M8 4v40' }],
      ['path', { d: 'M8 44l7 5-7 5 7 5-7 5 7 5-7 5h44l-7-5 7-5-7-5 7-5-7-5 7-5' }],
      ['path', { d: 'M17 26h20M17 34h14', opacity: '0.6' }],
    ],
  },
};

/** One widget's error drawing, sized to fill its slot.
    @param {string} name @param {Document} doc @returns {SVGElement|null} */
export function errorArt(name, doc) {
  const a = ART[name];
  if (!a) return null;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: a.box,
    preserveAspectRatio: (a.align || 'xMidYMid') + ' meet',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.display = 'block';
  for (const [tag, attrs] of a.shapes) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** The drawings this module has, for tests. */
export const ART_NAMES = Object.freeze(Object.keys(ART));

const STYLE_ID = 'wt-error-css';
const CSS = `
.wt-inert { filter: grayscale(0.9) opacity(0.5); transition: filter 0.4s ease; pointer-events: none; }
.wt-art { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 8%; pointer-events: none; color: var(--wt-art-color, rgba(255,255,255,0.3)); }
.wt-art svg { max-width: 100%; max-height: 100%; }
.wt-art-corner { align-items: flex-start; justify-content: flex-start; padding: 3%; }
/* A corner drawing is an accent, not the subject. Cap it so it cannot take
   over the slot it sits in. */
.wt-art-corner svg { max-width: 38%; max-height: 55%; opacity: 0.75; }
.wt-cap { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11px; font-weight: 500;
  line-height: 1.3; color: var(--wt-cap-color, rgba(255,255,255,0.62)); }
.wt-cap svg { width: 12px; height: 12px; flex: 0 0 auto; opacity: 0.85; }
.wt-cap b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-cap i { font-style: normal; opacity: 0.7; flex: 0 0 auto; }
.wt-cap-auto { position: absolute; inset-inline: 16px; bottom: 12px; }
.wt-cap-center { position: absolute; inset: 0; justify-content: center; text-align: center; padding: 0 14px; }
@media (prefers-reduced-motion: reduce) { .wt-inert { transition: none; } }
`;

function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.appendChild(s);
}

/** One widget's error, empty and healthy states.

    opts: { root, content=root, caption, art, place='foot', t }
    `content` is the element, or elements, that go inert. `caption` is the widget's own metadata slot;
    without one, a line is placed at the foot of `root`, or over its centre when
    `place` is 'center'.

    @param {any} opts */
export function errorState(opts = {}) {
  const root = opts.root;
  /* Several widgets have no single content wrapper, so an array is accepted. A
     widget that rebuilds its content passes a function instead. */
  const contentOf = () =>
    [].concat((typeof opts.content === 'function' ? opts.content() : opts.content) || root || []).filter(Boolean);
  const t = typeof opts.t === 'function' ? opts.t : (_k, fallback) => fallback;
  const doc = root && root.ownerDocument;
  ensureStyle(doc);

  const view = doc && doc.defaultView;

  let cap = opts.caption || null;
  if (!cap && root) {
    /* The auto caption is absolutely placed, so it needs a positioned root. */
    if (view && view.getComputedStyle(root).position === 'static') root.style.position = 'relative';
    cap = doc.createElement('div');
    cap.className = opts.place === 'center' ? 'wt-cap wt-cap-center' : 'wt-cap wt-cap-auto';
    root.appendChild(cap);
  }
  if (cap) {
    cap.classList.add('wt-cap');
    cap.hidden = true;
  }

  /* Nodes and text only. An upstream string never reaches this, but the
     widget's own catalog is still data. */
  function paint(glyph, text, suffix) {
    if (!cap) return;
    cap.textContent = '';
    if (glyph) cap.appendChild(glyph);
    const b = doc.createElement('b');
    b.dir = 'auto';
    b.textContent = text;
    cap.appendChild(b);
    if (suffix) {
      const i = doc.createElement('i');
      i.textContent = '· ' + suffix;
      cap.appendChild(i);
    }
    cap.hidden = false;
  }

  /* The drawing stands where the working element stood, so the widget keeps its
     shape. The element it replaces is hidden, not removed: the widget rebuilds
     from it on the next good poll. */
  let artEl = null;

  function showArt(on) {
    if (!opts.art || !opts.art.slot) return;
    const { name, slot, hide } = opts.art;
    const hidden = [].concat((typeof hide === 'function' ? hide() : hide) || []).filter(Boolean);
    for (const el of hidden) el.style.visibility = on ? 'hidden' : '';
    if (!on) {
      if (artEl) artEl.remove();
      artEl = null;
      return;
    }
    if (artEl) return;
    const svg = errorArt(name, doc);
    if (!svg) return;
    artEl = doc.createElement('div');
    artEl.className = 'wt-art' + (ART[name] && ART[name].align ? ' wt-art-corner' : '');
    artEl.appendChild(svg);
    if (view && view.getComputedStyle(slot).position === 'static') slot.style.position = 'relative';
    slot.appendChild(artEl);
  }

  return {
    /** Going inert is how good data is marked as no longer current. A widget
        that never had any is drawing placeholders already, and fading those
        leaves an empty frame: pass inert false.

        @param {unknown} err @param {{ since?: string, inert?: boolean }} [info]
        @returns {string} the line drawn, for an accessible name */
    fail(err, info = {}) {
      const kind = errorKind(err);
      const { key, text } = errorCopy(kind);
      const line = t(key, text);
      const dim = info.inert !== false;
      for (const el of contentOf()) el.classList.toggle('wt-inert', dim);
      showArt(true);
      paint(errorGlyph(kind, doc), line, info.since || '');
      return line;
    },
    /** The widget reached its service and there is genuinely nothing to show.
        @param {string} text */
    empty(text) {
      for (const el of contentOf()) el.classList.remove('wt-inert');
      showArt(false);
      paint(null, text, '');
    },
    ok() {
      for (const el of contentOf()) el.classList.remove('wt-inert');
      showArt(false);
      if (cap) {
        cap.hidden = true;
        cap.textContent = '';
      }
    },
    get caption() {
      return cap;
    },
  };
}
