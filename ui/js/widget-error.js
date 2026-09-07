// @ts-check
/* The failure states every widget shares. The wording comes from the kind the
   API sends, documented in docs/api-errors.md.

   Never draw a response's error message. It names hosts, ports and status
   codes, and it is not translated. */

/* Nodes, not markup: this file is covered by the innerHTML ratchet. */
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
  const s = typeof e.status === 'number' ? e.status : 0;
  if (s === 401 || s === 403) return 'auth';
  if (s === 503) return 'invalid';
  if (s === 504) return 'timeout';
  if (s === 502) return 'network';
  if (s >= 400) return 'upstream';
  return err ? 'network' : FALLBACK;
}

/** @param {string} kind @param {Document} doc @returns {SVGElement} */
function errorGlyph(kind, doc) {
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

export const ERROR_KINDS = Object.freeze(Object.keys(COPY));

const STYLE_ID = 'wt-error-css';
const CSS = `
.wt-inert { filter: grayscale(0.9) opacity(0.5); transition: filter 0.4s ease; pointer-events: none; }
.wt-cap { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11px; font-weight: 500;
  line-height: 1.3; color: var(--wt-cap-color, rgba(255,255,255,0.62));
  /* The caption is never a target. A centred one covers its whole widget, and
     with pointer events it swallows every hover the widget has. */
  pointer-events: none; }
/* This rule sets display, which outranks the user agent's [hidden] rule. Without
   its own hidden rule the caption never goes away. */
.wt-cap[hidden] { display: none; }
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

/** One widget's error, empty and healthy states. The options are documented in
    docs/widgets.md.

    @param {any} opts */
export function errorState(opts = {}) {
  const root = opts.root;
  const contentOf = () =>
    [].concat((typeof opts.content === 'function' ? opts.content() : opts.content) || root || []).filter(Boolean);
  const t = typeof opts.t === 'function' ? opts.t : (_k, fallback) => fallback;
  const doc = root && root.ownerDocument;
  ensureStyle(doc);

  let cap = opts.caption || null;
  if (!cap && root) {
    /* Absolutely placed. Without a positioned root it escapes the widget. */
    const view = doc.defaultView;
    if (view && view.getComputedStyle(root).position === 'static') root.style.position = 'relative';
    cap = doc.createElement('div');
    cap.className = opts.place === 'center' ? 'wt-cap wt-cap-center' : 'wt-cap wt-cap-auto';
    root.appendChild(cap);
  }
  if (cap) {
    cap.classList.add('wt-cap');
    cap.hidden = true;
  }

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

  return {
    /** Pass inert false when the widget never had data. Fading a placeholder
        leaves an empty frame.

        @param {unknown} err @param {{ since?: string, inert?: boolean }} [info]
        @returns {string} the line drawn, for an accessible name */
    fail(err, info = {}) {
      const kind = errorKind(err);
      const { key, text } = errorCopy(kind);
      const line = t(key, text);
      const dim = info.inert !== false;
      for (const el of contentOf()) el.classList.toggle('wt-inert', dim);
      paint(errorGlyph(kind, doc), line, info.since || '');
      return line;
    },
    /** @param {string} text */
    empty(text) {
      for (const el of contentOf()) el.classList.remove('wt-inert');
      paint(null, text, '');
    },
    ok() {
      for (const el of contentOf()) el.classList.remove('wt-inert');
      if (cap) {
        cap.hidden = true;
        cap.textContent = '';
      }
    },
  };
}
