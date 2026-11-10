// @ts-check
/* The failure states every widget shares. The wording comes from the kind the
   API sends.

   Never draw a response's error message. It names hosts, ports and status
   codes, and it is not translated. */

import { ICONS, symbol } from '/js/icon-set.js?v=b7e5d7d1';

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

/** @param {string} kind @param {Document} doc @returns {Element} */
function errorGlyph(kind, doc) {
  const [g] = COPY[kind] || COPY[FALLBACK];
  const id = `err-${g}`;
  const { defs, sym } = symbol(id, ICONS[id]);
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><defs>${defs}</defs>${sym.replace(/<\/?symbol[^>]*>/g, '')}</svg>`;
  const Parser = doc.defaultView.DOMParser;
  return doc.importNode(new Parser().parseFromString(src, 'image/svg+xml').documentElement, true);
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
.wt-gone { visibility: hidden; }
.wt-cap { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11px; font-weight: 500;
  line-height: 1.3; color: var(--wt-cap-color, rgba(255,255,255,0.62));
  /* The caption is never a target. A centred one covers its whole widget, and
     with pointer events it swallows every hover the widget has. */
  pointer-events: none; }
/* This rule sets display, which outranks the user agent's [hidden] rule. Without
   its own hidden rule the caption never goes away. */
.wt-cap[hidden] { display: none; }
html[data-theme="light"] .wt-cap { color: var(--wt-cap-color, #636366); }
.wt-cap svg { width: 12px; height: 12px; flex: 0 0 auto; opacity: 0.85; }
.wt-cap .sy-i { fill: currentColor; }
.wt-cap .sy-is { stroke: currentColor; }
.wt-cap b { font-weight: 500; overflow: hidden; min-width: 0;
  /* Two lines, then clip. The narrowest card cannot hold the longest line on
     one, and an ellipsised failure does not say what failed. */
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wt-cap i { font-style: normal; flex: 0 0 auto; }
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

    @param {any} opts */
export function errorState(opts = {}) {
  const root = opts.root;
  /* Named content, else everything in the root but the caption. inert is a CSS
     filter, which a descendant cannot escape, so fading the root would fade the
     failure line with it. */
  const contentOf = () => {
    const named = typeof opts.content === 'function' ? opts.content() : opts.content;
    if (named) return [].concat(named).filter(Boolean);
    return root ? [...root.children].filter(el => el !== cap) : [];
  };
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
      for (const el of contentOf()) {
        el.classList.remove('wt-inert');
        if (opts.hideOnEmpty) el.classList.add('wt-gone');
      }
      paint(null, text, '');
    },
    ok() {
      for (const el of contentOf()) el.classList.remove('wt-inert', 'wt-gone');
      if (cap) {
        cap.hidden = true;
        cap.textContent = '';
      }
    },
  };
}
