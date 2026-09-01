import { iconChain } from '/js/icons.js?v=69c2b9bd';
import { toneForColor } from '/js/label-contrast.js?v=c1ac6fb8';
import { SETTINGS_ICON } from '/js/settings-icon.js?v=b96e5b13';

export const mk = (t, a = {}) => {
  const e = document.createElement(t);
  Object.assign(e, a);
  return e;
};
/* Every colour an item renders with passes through here, and the value can
   arrive in an imported config. It is assigned to a background, where a CSS
   url() fetches from whatever host it names. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9a-z%.,\s/+-]*\)|[a-z]{3,20})$/i;
const DEFAULT_TILE_COLOR = '#1C1C1E';
export const clr = c => {
  if (!c || c === 'dark') return DEFAULT_TILE_COLOR;
  if (c === 'light') return '#F2F2F7';
  const v = String(c).trim();
  return SAFE_COLOR.test(v) ? v : DEFAULT_TILE_COLOR;
};
/* The plate is a colour the user chose, so the ink has to be measured from it.
   White on the palette's own yellow reads at 1.5:1. */
export const fb = (l, sz, plate) => {
  const e = mk('span');
  e.className = 'fb';
  if (toneForColor(plate) === 'dark') e.classList.add('fb-on-light');
  e.style.fontSize = Math.round(sz * 0.32) + 'px';
  e.textContent = (l || '?')[0].toUpperCase();
  return e;
};
export { esc } from '/js/html.js?v=c71f8903';

/* A name the user typed has its own direction. Without that an English name
   inside a Persian dashboard lays out right-to-left and an over-long one loses
   its head rather than its tail.

   The isolation goes on a <bdi> around the text, not on the block. `dir` sets
   alignment as well as bidi, so a Latin name on the block dragged its whole row
   to the other edge: a title and its subtitle ended up on opposite sides.

   A centred label sets `dir` on the block as well, because alignment cannot move
   centred text. Without it the block's direction decides which end is cut, and
   WebKit ignores unicode-bidi:plaintext for that.

   @param {HTMLElement} node @param {string} text @returns {HTMLElement} */
export const setUserText = (node, text) => {
  node.textContent = '';
  const bdi = mk('bdi');
  bdi.textContent = text;
  node.appendChild(bdi);
  return node;
};

/* A page strip is laid out in the page's direction, so the next page sits to the
   left in one direction and to the right in the other. translateX has no logical
   form, and a strip moved the wrong way leaves the screen: 1 where a page
   advances leftwards, -1 where it advances rightwards.

   The same number mirrors the inputs. A leftward drag and the right arrow ask
   for the next page in one direction and the previous page in the other. */
export const pageDir = () => (getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1);

/* A tile label is one line and ellipsises. The full name is on the anchor's
   accessible name either way, so this is for a pointer: a tooltip only where the
   text is actually cut, because one on every tile is noise.

   @param {ParentNode} [root] */
export function titleWhenTruncated(root = document) {
  for (const label of root.querySelectorAll('.ilabel, .dyn-mob-label, .dyn-fold-label')) {
    const tile = /** @type {HTMLElement|null} */ (label.closest('a, button'));
    if (!tile) continue;
    const text = label.textContent || '';
    if (label.scrollWidth > label.clientWidth + 1) tile.title = text;
    else if (tile.title === text) tile.removeAttribute('title');
  }
}

/* Strip quotes, parens and backslashes. A user URL must not break out of a CSS
   url('...') wrapper. */
export const sanitizeCssUrl = u => String(u || '').replace(/['"\\()]/g, '');

/* ── Typed element lookups ───────────────────────────────────────────────────
   None of these check for null. They look up elements the page itself renders,
   so a missing one is a bug in the markup. */

/** @param {string} id @returns {HTMLElement} */
export const el = id => /** @type {HTMLElement} */ (document.getElementById(id));

/** A form control: input, select or textarea.
    @param {string} id @returns {HTMLInputElement} */
export const inp = id => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @param {string} sel @param {ParentNode} [root]
    @returns {HTMLElement} */
export const q = (sel, root = document) => /** @type {HTMLElement} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root]
    @returns {HTMLInputElement} */
export const qi = (sel, root = document) => /** @type {HTMLInputElement} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root]
    @returns {HTMLElement[]} */
export const qa = (sel, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(sel)]);

/** The form control an event came from.
    @param {Event} e @returns {HTMLInputElement} */
export const tgt = e => /** @type {HTMLInputElement} */ (e.target);

/* breg is passed in to avoid a circular import. */
export function mkWrap(item, sz, r, isz, cls, breg) {
  const w = mk('div');
  if (cls) w.className = cls;
  const wrapBg = item.system === 'settings' ? '#027eae' : clr(item.color);
  w.style.cssText = `width:${sz}px;height:${sz}px;border-radius:${r}px;background:${wrapBg};position:relative;flex-shrink:0;overflow:visible;display:flex;align-items:center;justify-content:center;box-shadow:inset 1px 1px 0 rgba(255,255,255,.18),inset -1px -1px 0 rgba(0,0,0,.14);`;
  const g = mk('div');
  g.style.cssText = `position:absolute;inset:0;border-radius:${r}px;pointer-events:none;z-index:2;background:linear-gradient(135deg,rgba(255,255,255,.10) 0%,transparent 60%);`;
  w.appendChild(g);
  const rawIcon = item.iconUrl || '';
  if (item.system === 'settings') {
    const si = Math.min(sz, Math.round(isz * 1.22));
    const img = mk('img', { src: SETTINGS_ICON, alt: '', draggable: false });
    img.setAttribute('aria-hidden', 'true');
    img.style.cssText = `width:${si}px;height:${si}px;object-fit:contain;position:relative;z-index:3;`;
    img.onerror = () => img.replaceWith(fb(item.label, sz, wrapBg));
    w.appendChild(img);
  } else if (rawIcon) {
    const chain = iconChain(rawIcon);
    if (chain.length) {
      const img = mk('img', { src: chain[0], alt: '', loading: 'lazy', draggable: false });
      img.setAttribute('aria-hidden', 'true');
      img.style.cssText = `width:${isz}px;height:${isz}px;object-fit:contain;position:relative;z-index:3;`;
      let step = 0;
      const tryNext = () => {
        step++;
        if (step < chain.length) img.src = chain[step];
        else img.replaceWith(fb(item.label, sz, wrapBg));
      };
      img.onerror = tryNext;
      /* A 403 fires load, not onerror. A blocked image has zero dimensions. */
      img.onload = () => {
        if (img.naturalWidth === 0) tryNext();
      };
      w.appendChild(img);
    } else w.appendChild(fb(item.label, sz, wrapBg));
  } else w.appendChild(fb(item.label, sz, wrapBg));
  if (
    breg &&
    (item.monitoring?.healthcheck?.enabled ||
      item.monitoring?.activity?.enabled ||
      item.monitoring?.staticBadge?.enabled ||
      item.container ||
      item.badge?.enabled)
  ) {
    const b = mk('div');
    b.className = 'badge';
    w.appendChild(b);
    breg(item.id, b);
  }
  return w;
}

/* Live widget mounts, so a rebuild can switch off what it is about to discard.
   mountScaledWidget starts an observer, a reload timer and touch listeners that
   outlive the DOM it creates, and stranded timers keep polling the backing
   services forever. */
const _mounts = new Set();

/** Stop everything the mounted widgets started. */
export function teardownWidgets() {
  for (const stop of _mounts) {
    try {
      stop();
    } catch {
      /* one failure must not strand the rest */
    }
  }
  _mounts.clear();
}

/* What an embedded panel may be granted. The list a widget carries comes from
   stored config, which can arrive by import, so a frame naming camera or
   geolocation gets neither. */
const SAFE_IFRAME_FEATURES = new Set([
  'autoplay',
  'fullscreen',
  'picture-in-picture',
  'encrypted-media',
  'clipboard-write',
  'web-share',
]);

/** @param {unknown} value @returns {string} */
export function safeAllow(value) {
  const kept = String(value == null ? '' : value)
    .split(';')
    .map(part => part.trim())
    .filter(part => part && SAFE_IFRAME_FEATURES.has(part.split(/[\s(]/)[0].toLowerCase()));
  return kept.join('; ') || 'fullscreen';
}

/* Mounts the iframe at a fixed design resolution and scales it to fill `card`.
   `card` must be aspect-locked to the design ratio. */
/* Withheld: allow-top-navigation. Without it a framed page cannot redirect the
   dashboard through top.location. Everything a real service needs is granted,
   including its own origin, so its session and storage still work.

   Only a cross-origin frame gets this. A bundled widget is served from here, so
   it would need allow-same-origin and the attribute would withhold nothing. */
const SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

const isCrossOrigin = src => {
  try {
    return new URL(src, location.href).origin !== location.origin;
  } catch {
    return false;
  }
};

/** @param {HTMLElement} card
    @param {{
      src?: string, title?: string, design?: [number, number],
      iframeOpts?: Record<string, unknown>, overlayHref?: string,
      mobile?: boolean, onSwipe?: (dir: number) => void,
    }} [opts] */
export function mountScaledWidget(card, { src, title, design, iframeOpts, overlayHref, mobile, onSwipe } = {}) {
  const [dw, dh] = design;
  const o = iframeOpts || {};
  /* Without a positioned ancestor the iframe escapes up the tree and paints at
     the page origin. Do not read it through getComputedStyle, which returns an
     unresolved value for a card that has not been laid out. */
  /* Register everything that outlives the DOM, so teardown can undo it. */
  const cleanups = [];
  if (!card.style.position) card.style.position = 'relative';
  card.style.overflow = 'hidden';
  const clip = mk('div');
  clip.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  const ifr = mk('iframe', { src, scrolling: o.scrolling === true || o.scrolling === 'yes' ? 'yes' : 'no', title });
  if (isCrossOrigin(src)) ifr.setAttribute('sandbox', SANDBOX);
  ifr.setAttribute('allow', safeAllow(o.allow));
  if (o.allowFullscreen !== false) ifr.setAttribute('allowfullscreen', '');
  if (o.referrerPolicy) ifr.setAttribute('referrerpolicy', o.referrerPolicy);
  if (o.loading) ifr.setAttribute('loading', o.loading);
  ifr.setAttribute('aria-label', title);
  ifr.style.cssText =
    `position:absolute;top:0;left:0;display:block;border:0;` +
    `width:${dw}px;height:${dh}px;transform-origin:top left;opacity:0;transition:opacity .12s ease;`;
  clip.appendChild(ifr);
  card.appendChild(clip);

  /* A widget page sets no direction of its own. Reapplied on every load: a
     refresh replaces the document. */
  const applyDir = () => {
    let doc;
    try {
      doc = ifr.contentDocument;
    } catch {
      return;
    }
    if (!doc || !doc.documentElement) return;
    const root = document.documentElement;
    doc.documentElement.setAttribute('dir', root.getAttribute('dir') || 'ltr');
    doc.documentElement.setAttribute('lang', root.getAttribute('lang') || 'en');
  };
  ifr.addEventListener('load', applyDir);
  cleanups.push(() => ifr.removeEventListener('load', applyDir));
  try {
    if (ifr.contentDocument && ifr.contentDocument.readyState === 'complete') applyDir();
  } catch {}

  /* Jittered, so a dashboard full of widgets does not reload against every
     backing service on the same tick. */
  const refreshInterval = Number(o.refreshInterval) || 0;
  if (refreshInterval >= 250) {
    const base = refreshInterval;
    const reload = () => {
      ifr.src = src + (src.includes('?') ? '&' : '?') + '_r=' + Date.now();
    };
    const jit = () => Math.round(base * (1 + (Math.random() * 2 - 1) * 0.15));
    /* The handle is reassigned every tick. The cleanup must read the current
       one. */
    let timer = setTimeout(
      function tick() {
        reload();
        timer = setTimeout(tick, jit());
      },
      Math.round(Math.random() * base),
    );
    cleanups.push(() => clearTimeout(timer));
  }

  /* An iframe swallows touches. Listening on its own document keeps interior
     taps working, which an overlay would block. */
  if (mobile) {
    const attach = () => {
      let doc;
      try {
        doc = ifr.contentDocument;
      } catch {
        return;
      }
      if (!doc || doc.__wgesture) return;
      doc.__wgesture = true;
      let sx = 0,
        sy = 0,
        moved = false;
      doc.addEventListener(
        'touchstart',
        e => {
          const t = e.touches[0];
          if (!t) return;
          sx = t.clientX;
          sy = t.clientY;
          moved = false;
        },
        { passive: true },
      );
      doc.addEventListener(
        'touchmove',
        e => {
          const t = e.touches[0];
          if (!t) return;
          if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) moved = true;
        },
        { passive: true },
      );
      doc.addEventListener(
        'touchend',
        e => {
          const t = e.changedTouches[0];
          if (!t) return;
          const dx = t.clientX - sx,
            dy = t.clientY - sy;
          if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            /* horizontal swipe → page */
            if (typeof onSwipe === 'function') onSwipe(dx < 0 ? 1 : -1);
            return;
          }
          if (!moved && overlayHref) {
            /* tap on non-interactive area → open link */
            const tgt = e.target;
            const interactive =
              tgt &&
              tgt.closest &&
              tgt.closest(
                'a,button,[role="button"],[onclick],.clickable,.bay,.val-row,.chart-wrap,input,select,textarea',
              );
            if (!interactive) window.open(overlayHref, '_blank', 'noopener,noreferrer');
          }
        },
        { passive: true },
      );
    };
    ifr.addEventListener('load', attach);
    cleanups.push(() => ifr.removeEventListener('load', attach));
    try {
      if (ifr.contentDocument && ifr.contentDocument.readyState === 'complete') attach();
    } catch {}
  }

  const fit = () => {
    const w = card.clientWidth,
      h = card.clientHeight;
    if (!w || !h) return;
    /* Contain, not cover. With a matched aspect the two are the same and this
       fills the card exactly. Where the card's aspect drifts from the design's,
       cover crops the widget instead, and the card clips what it cropped. */
    const s = Math.min(w / dw, h / dh);
    const tx = (w - dw * s) / 2,
      ty = (h - dh * s) / 2;
    ifr.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    ifr.style.opacity = '1'; /* reveal only once scaled, avoids the flash of unscaled content on load */
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    cleanups.push(() => ro.disconnect());
  } else {
    window.addEventListener('resize', fit);
    cleanups.push(() => window.removeEventListener('resize', fit));
  }
  requestAnimationFrame(fit);
  fit();

  const stop = () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* keep going */
      }
    }
    cleanups.length = 0;
    try {
      ifr.src = 'about:blank';
    } catch {
      /* already detached */
    }
  };
  _mounts.add(stop);
  return ifr;
}
