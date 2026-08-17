import { iconChain } from '/js/icons.js?v=69c2b9bd';

export const mk = (t, a = {}) => {
  const e = document.createElement(t);
  Object.assign(e, a);
  return e;
};
/* Every colour an item renders with passes through here, and the value can
   arrive in an imported config. It is assigned to a background, where a CSS
   url() fetches from whatever host it names. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9a-z%.,\s/+-]*\)|[a-z]{3,20})$/i;
export const DEFAULT_TILE_COLOR = '#1C1C1E';
export const clr = c => {
  if (!c || c === 'dark') return DEFAULT_TILE_COLOR;
  if (c === 'light') return '#F2F2F7';
  const v = String(c).trim();
  return SAFE_COLOR.test(v) ? v : DEFAULT_TILE_COLOR;
};
export const fb = (l, sz) => {
  const e = mk('span');
  e.className = 'fb';
  e.style.fontSize = Math.round(sz * 0.32) + 'px';
  e.textContent = (l || '?')[0].toUpperCase();
  return e;
};
export { esc } from '/js/html.js?v=c71f8903';

/* A name the user typed has its own direction. Without dir="auto" an English
   name inside a Persian dashboard lays out right-to-left and an over-long one
   loses its head rather than its tail.

   @param {HTMLElement} node @param {string} text @returns {HTMLElement} */
export const setUserText = (node, text) => {
  node.textContent = text;
  node.setAttribute('dir', 'auto');
  return node;
};

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
const SETTINGS_ICON =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNHB0IiBoZWlnaHQ9IjEwMjRwdCIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cGF0aCBmaWxsPSIjZjJmMmY3IiBzdHJva2U9IiNmMmYyZjciIHN0cm9rZS13aWR0aD0iMC4wOTM3NSIgb3BhY2l0eT0iMS4wMCIgZD0iIE0gMzU1LjU1IDM5OC43NyBDIDM2NC45OSAzOTcuNjIgMzc0LjUxIDM5OC4xMCAzODQuMDAgMzk4LjAwIEMgNDc0LjY3IDM5OC4wMCA1NjUuMzQgMzk4LjAxIDY1Ni4wMSAzOTcuOTkgQyA2NzcuMTEgMzk3Ljk1IDY5OC4yMiA0MDMuODMgNzE2LjE1IDQxNC45OSBDIDc0Ni42MiA0MzMuNjAgNzY3LjMwIDQ2Ny4zMiA3NjkuNjYgNTAzLjAwIEMgNzcyLjYwIDUzOC4xNiA3NTcuNzIgNTc0LjA5IDczMS4wMCA1OTcuMDcgQyA3MTQuMjIgNjExLjcyIDY5My4wNCA2MjEuMjcgNjcwLjk0IDYyNC4wNSBDIDY2MS42NyA2MjUuMzQgNjUyLjMwIDYyNC45NCA2NDIuOTggNjI1LjAwIEMgNTU3LjMxIDYyNS4wMCA0NzEuNjQgNjI1LjAwIDM4NS45NyA2MjUuMDAgQyAzNzMuMzAgNjI0LjkyIDM2MC41MCA2MjUuNjAgMzQ3Ljk5IDYyMy4xMCBDIDMxNy4yMiA2MTcuNjAgMjg5LjIzIDU5OC42MiAyNzIuNjEgNTcyLjE2IEMgMjU5Ljc3IDU1Mi4wMyAyNTMuNjAgNTI3Ljc1IDI1NS4yNiA1MDMuOTMgQyAyNTYuNzAgNDgxLjI4IDI2NS4yNCA0NTkuMTcgMjc5LjMyIDQ0MS4zNyBDIDI5Ny43MyA0MTcuNzkgMzI1LjgwIDQwMi4wNiAzNTUuNTUgMzk4Ljc3IE0gNDY5LjMxIDQxMC40NyBDIDQ1Mi43OSA0MTIuMjIgNDM2LjYwIDQxNy41OCA0MjIuNzEgNDI2Ljc4IEMgNDAwLjE2IDQ0MS40MCAzODQuMDUgNDY1LjUyIDM3OS4xMCA0OTEuOTMgQyAzNzQuNjQgNTExLjQwIDM3Ny42NCA1MzEuODcgMzg0Ljc1IDU1MC4zMiBDIDM4OC4wNiA1NTcuNDAgMzkxLjMzIDU2NC41OSAzOTYuMjYgNTcwLjczIEMgNDE0Ljg1IDU5Ny42MyA0NDcuNTcgNjEzLjMwIDQ4MC4wNSA2MTMuMDEgQyA1MzguNzIgNjEzLjAwIDU5Ny4zOCA2MTMuMDQgNjU2LjA1IDYxMi45NyBDIDY4NC44OSA2MTIuMjggNzEzLjU2IDU5OS4zNyA3MzIuMDAgNTc2Ljk3IEMgNzM2LjY3IDU3MC44MyA3NDEuNTkgNTY0Ljc4IDc0NC43NCA1NTcuNjggQyA3NTAuMTEgNTQ3LjkxIDc1Mi44NSA1MzYuOTYgNzU0Ljg0IDUyNi4wNyBDIDc1Ny45MiA1MDguMzMgNzU0Ljc2IDQ5MC4wNiA3NDguNTMgNDczLjM1IEMgNzQ1LjE5IDQ2NS43NSA3NDEuNDcgNDU4LjI2IDczNi4zMiA0NTEuNzEgQyA3MjQuOTYgNDM1LjQxIDcwOC4xMyA0MjMuMzYgNjg5LjY5IDQxNi4zMSBDIDY3OC4xNiA0MTIuNTkgNjY2LjEzIDQwOS44NyA2NTMuOTYgNDEwLjAzIEMgNTk3LjI5IDQwOS45NSA1NDAuNjEgNDEwLjAzIDQ4My45NCA0MTAuMDAgQyA0NzkuMDYgNDA5Ljk4IDQ3NC4xNyA0MDkuOTQgNDY5LjMxIDQxMC40NyBaIiAvPgo8cGF0aCBmaWxsPSIjZGZkZmU0IiBzdHJva2U9IiNkZmRmZTQiIHN0cm9rZS13aWR0aD0iMC4wOTM3NSIgb3BhY2l0eT0iMS4wMCIgZD0iIE0gNDY5LjMxIDQxMC40NyBDIDQ3NC4xNyA0MDkuOTQgNDc5LjA2IDQwOS45OCA0ODMuOTQgNDEwLjAwIEMgNTQwLjYxIDQxMC4wMyA1OTcuMjkgNDA5Ljk1IDY1My45NiA0MTAuMDMgQyA2NjYuMTMgNDA5Ljg3IDY3OC4xNiA0MTIuNTkgNjg5LjY5IDQxNi4zMSBDIDcwOC4xMyA0MjMuMzYgNzI0Ljk2IDQzNS40MSA3MzYuMzIgNDUxLjcxIEMgNzQxLjQ3IDQ1OC4yNiA3NDUuMTkgNDY1Ljc1IDc0OC41MyA0NzMuMzUgQyA3NTQuNzYgNDkwLjA2IDc1Ny45MiA1MDguMzMgNzU0Ljg0IDUyNi4wNyBDIDc1Mi44NSA1MzYuOTYgNzUwLjExIDU0Ny45MSA3NDQuNzQgNTU3LjY4IEMgNzQxLjU5IDU2NC43OCA3MzYuNjcgNTcwLjgzIDczMi4wMCA1NzYuOTcgQyA3MTMuNTYgNTk5LjM3IDY4NC44OSA2MTIuMjggNjU2LjA1IDYxMi45NyBDIDU5Ny4zOCA2MTMuMDQgNTM4LjcyIDYxMy4wMCA0ODAuMDUgNjEzLjAxIEMgNDQ3LjU3IDYxMy4zMCA0MTQuODUgNTk3LjYzIDM5Ni4yNiA1NzAuNzMgQyAzOTEuMzMgNTY0LjU5IDM4OC4wNiA1NTcuNDAgMzg0Ljc1IDU1MC4zMiBDIDM3Ny42NCA1MzEuODcgMzc0LjY0IDUxMS40MCAzNzkuMTAgNDkxLjkzIEMgMzg0LjA1IDQ2NS41MiA0MDAuMTYgNDQxLjQwIDQyMi43MSA0MjYuNzggQyA0MzYuNjAgNDE3LjU4IDQ1Mi43OSA0MTIuMjIgNDY5LjMxIDQxMC40NyBNIDQ2Ny40OCA0MjIuNjYgQyA0MzYuNjggNDI2LjEzIDQwOC43NCA0NDcuMDggMzk2LjUwIDQ3NS41MSBDIDM4Ny43NyA0OTUuMjcgMzg2LjU4IDUxOC4yMSAzOTMuMjEgNTM4Ljc2IEMgMzk4LjcyIDU1Ni4xNiA0MDkuNzUgNTcxLjc1IDQyNC4zMCA1ODIuNzYgQyA0MzkuMDQgNTk0LjA3IDQ1Ny4zOSA2MDAuNTEgNDc1Ljk1IDYwMS4wMCBDIDUzMi4zMiA2MDEuMDAgNTg4LjY5IDYwMS4wMCA2NDUuMDYgNjAxLjAwIEMgNjUyLjE5IDYwMC45NCA2NTkuMzcgNjAxLjMzIDY2Ni40NiA2MDAuMjIgQyA2ODMuMTYgNTk4LjA4IDY5OS4xNCA1OTAuOTUgNzEyLjAyIDU4MC4xMSBDIDcyOC41OCA1NjYuMzIgNzM5Ljg5IDU0Ni4zMiA3NDMuMDAgNTI0Ljk4IEMgNzQ1Ljg2IDUwNi42NSA3NDIuNzYgNDg3LjQ2IDczNC4zNCA0NzAuOTQgQyA3MjYuNzQgNDU1Ljk3IDcxNC44NCA0NDMuMjMgNzAwLjQxIDQzNC42MyBDIDY4NS45NCA0MjUuODggNjY4LjkyIDQyMS41NCA2NTIuMDMgNDIxLjk5IEMgNTk1LjY2IDQyMi4wMSA1MzkuMjkgNDIyLjAwIDQ4Mi45MSA0MjIuMDAgQyA0NzcuNzYgNDIxLjk0IDQ3Mi41OSA0MjEuOTQgNDY3LjQ4IDQyMi42NiBaIiAvPgo8cGF0aCBmaWxsPSIjMzg3Zjk1IiBzdHJva2U9IiMzODdmOTUiIHN0cm9rZS13aWR0aD0iMC4wOTM3NSIgb3BhY2l0eT0iMS4wMCIgZD0iIE0gNDY3LjQ4IDQyMi42NiBDIDQ3Mi41OSA0MjEuOTQgNDc3Ljc2IDQyMS45NCA0ODIuOTEgNDIyLjAwIEMgNTM5LjI5IDQyMi4wMCA1OTUuNjYgNDIyLjAxIDY1Mi4wMyA0MjEuOTkgQyA2NjguOTIgNDIxLjU0IDY4NS45NCA0MjUuODggNzAwLjQxIDQzNC42MyBDIDcxNC44NCA0NDMuMjMgNzI2Ljc0IDQ1NS45NyA3MzQuMzQgNDcwLjk0IEMgNzQyLjc2IDQ4Ny40NiA3NDUuODYgNTA2LjY1IDc0My4wMCA1MjQuOTggQyA3MzkuODkgNTQ2LjMyIDcyOC41OCA1NjYuMzIgNzEyLjAyIDU4MC4xMSBDIDY5OS4xNCA1OTAuOTUgNjgzLjE2IDU5OC4wOCA2NjYuNDYgNjAwLjIyIEMgNjU5LjM3IDYwMS4zMyA2NTIuMTkgNjAwLjk0IDY0NS4wNiA2MDEuMDAgQyA1ODguNjkgNjAxLjAwIDUzMi4zMiA2MDEuMDAgNDc1Ljk1IDYwMS4wMCBDIDQ1Ny4zOSA2MDAuNTEgNDM5LjA0IDU5NC4wNyA0MjQuMzAgNTgyLjc2IEMgNDA5Ljc1IDU3MS43NSAzOTguNzIgNTU2LjE2IDM5My4yMSA1MzguNzYgQyAzODYuNTggNTE4LjIxIDM4Ny43NyA0OTUuMjcgMzk2LjUwIDQ3NS41MSBDIDQwOC43NCA0NDcuMDggNDM2LjY4IDQyNi4xMyA0NjcuNDggNDIyLjY2IFoiIC8+Cjwvc3ZnPg==';

export function mkWrap(item, sz, r, isz, cls, breg) {
  const w = mk('div');
  if (cls) w.className = cls;
  const wrapBg = item.system === 'settings' ? '#027eae' : clr(item.color);
  w.style.cssText = `width:${sz}px;height:${sz}px;border-radius:${r}px;background:${wrapBg};position:relative;flex-shrink:0;overflow:visible;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;box-shadow:inset 1px 1px 0 rgba(255,255,255,.18),inset -1px -1px 0 rgba(0,0,0,.14);`;
  const g = mk('div');
  g.style.cssText = `position:absolute;inset:0;border-radius:${r}px;pointer-events:none;z-index:2;background:linear-gradient(135deg,rgba(255,255,255,.10) 0%,transparent 60%);`;
  w.appendChild(g);
  const rawIcon = item.iconUrl || '';
  if (item.system === 'settings') {
    const si = Math.min(sz, Math.round(isz * 1.22));
    const img = mk('img', { src: SETTINGS_ICON, alt: '', draggable: false });
    img.setAttribute('aria-hidden', 'true');
    img.style.cssText = `width:${si}px;height:${si}px;object-fit:contain;position:relative;z-index:3;`;
    img.onerror = () => img.replaceWith(fb(item.label, sz));
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
        else img.replaceWith(fb(item.label, sz));
      };
      img.onerror = tryNext;
      /* A 403 fires load, not onerror. A blocked image has zero dimensions. */
      img.onload = () => {
        if (img.naturalWidth === 0) tryNext();
      };
      w.appendChild(img);
    } else w.appendChild(fb(item.label, sz));
  } else w.appendChild(fb(item.label, sz));
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
    const s = Math.max(w / dw, h / dh); /* cover; with matched aspect = exact fill */
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
