import { mk } from '/js/utils.js?v=457d9918';

/* Live widget mounts, so a rebuild can switch off what it is about to discard.
   mountScaledWidget starts an observer, a reload timer and touch listeners that
   outlive the DOM it creates, and stranded timers keep polling the backing
   services forever. */
const _mounts = new Set();

/** @type {Map<HTMLElement, (rate: number) => void>} */
const _rates = new Map();

/** Multiplies the refresh interval of every widget mounted inside `root`.
    @param {Element} root @param {number} rate */
export function setRefreshRate(root, rate) {
  const r = Number(rate) > 0 ? Number(rate) : 1;
  for (const [card, set] of _rates) if (root.contains(card)) set(r);
}

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

/** @param {unknown} value @param {boolean} [fullscreen] @returns {string} */
export function safeAllow(value, fullscreen = true) {
  const kept = String(value == null ? '' : value)
    .split(';')
    .map(part => part.trim())
    .filter(part => {
      const feature = part.split(/[\s(]/)[0].toLowerCase();
      return part && SAFE_IFRAME_FEATURES.has(feature) && (fullscreen || feature !== 'fullscreen');
    });
  return kept.join('; ') || (fullscreen ? 'fullscreen' : '');
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

const FRAME_LOAD_WAIT_MS = 30000;

const isCrossOrigin = src => {
  try {
    return new URL(src, location.href).origin !== location.origin;
  } catch {
    return false;
  }
};

/** Whether a wheel moving dx sideways belongs to something under the pointer
    that can still scroll that way.

    @param {EventTarget | null} target @param {number} dx */
export function scrollsSideways(target, dx) {
  for (let n = /** @type {any} */ (target); n && n.nodeType === 1; n = n.parentElement) {
    const view = n.ownerDocument && n.ownerDocument.defaultView;
    if (!view || n.scrollWidth <= n.clientWidth) continue;
    if (!/(auto|scroll)/.test(view.getComputedStyle(n).overflowX)) continue;
    const left = Math.abs(n.scrollLeft);
    if (dx > 0 ? left + n.clientWidth < n.scrollWidth - 1 : left > 0) return true;
  }
  return false;
}

/** @param {any} target @returns {boolean} */
export function ownsSidewaysTouch(target) {
  for (let n = target; n && n.nodeType === 1; n = n.parentElement) {
    const view = n.ownerDocument && n.ownerDocument.defaultView;
    if (!view) continue;
    const st = view.getComputedStyle(n);
    const ta = st.touchAction || 'auto';
    if (ta !== 'auto' && ta !== 'manipulation' && !ta.includes('pan-x')) return true;
    if (n.scrollWidth > n.clientWidth && /(auto|scroll)/.test(st.overflowX)) return true;
  }
  return false;
}

/** @param {HTMLElement} card
    @param {{
      src?: string, title?: string, design?: [number, number],
      iframeOpts?: Record<string, unknown>, overlayHref?: string,
      mobile?: boolean, swipe?: () => {
        down: (id: string, x: number, y: number, t: number) => void,
        move: (id: string, x: number, y: number, t: number) => void,
        up: (id: string, t: number, fling: boolean) => void,
        cancel: () => void,
      } | null,
    }} [opts] */
export function mountScaledWidget(card, { src, title, design, iframeOpts, overlayHref, mobile, swipe } = {}) {
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
  const fullscreen = o.allowFullscreen !== false;
  const allow = safeAllow(o.allow, fullscreen);
  /** @param {string} url @param {boolean} [refresh] @returns {HTMLIFrameElement} */
  const makeFrame = (url, refresh) => {
    const f = mk('iframe', {
      src: url,
      scrolling: o.scrolling === true || o.scrolling === 'yes' ? 'yes' : 'no',
      title,
    });
    if (isCrossOrigin(src)) f.setAttribute('sandbox', SANDBOX);
    if (allow) f.setAttribute('allow', allow);
    if (fullscreen) f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', o.referrerPolicy || 'strict-origin-when-cross-origin');
    /* A lazy frame on a page out of view does not load, so its refresh is
       dropped. */
    if (o.loading && !refresh) f.setAttribute('loading', o.loading);
    f.setAttribute('aria-label', title);
    f.style.cssText =
      `position:absolute;top:0;left:0;display:block;border:0;` +
      `width:${dw}px;height:${dh}px;transform-origin:top left;opacity:0;transition:opacity .12s ease;`;
    return /** @type {HTMLIFrameElement} */ (f);
  };
  /* A refresh replaces this element. Never keep a copy of it. */
  let ifr = makeFrame(src);
  clip.appendChild(ifr);
  card.appendChild(clip);

  /* A widget page sets no direction of its own. Reapplied on every load: a
     refresh replaces the document. */
  /** @param {HTMLIFrameElement} frame */
  const applyDir = frame => {
    let doc;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc || !doc.documentElement) return;
    const root = document.documentElement;
    doc.documentElement.setAttribute('dir', root.getAttribute('dir') || 'ltr');
    doc.documentElement.setAttribute('lang', root.getAttribute('lang') || 'en');
  };
  /* A bundled widget page is zoomed to the card rather than scaled as a
     picture. A scaled frame is resampled, and blurs on a 1x screen. Any other
     page lays out at the design size it was written for. */
  const zoomable = /^\/widgets\//.test(src);
  /** @param {HTMLIFrameElement} frame */
  const applyZoom = frame => {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) doc.documentElement.style.zoom = frame.getAttribute('data-zoom') || '';
    } catch {}
  };
  /* A wheel over a frame never reaches the dashboard. Hand a bundled page's
     wheel to the card, so sideways scrolling turns pages over widgets too. */
  let wheelWin = null;
  const forwardWheel = e => {
    if (e.ctrlKey || scrollsSideways(e.target, e.deltaX)) return;
    const copy = new WheelEvent('wheel', {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(copy, 'timeStamp', {
      value: e.timeStamp + (wheelWin?.performance.timeOrigin ?? performance.timeOrigin) - performance.timeOrigin,
    });
    card.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  };
  /** @param {HTMLIFrameElement} frame */
  const attachWheel = frame => {
    try {
      if (wheelWin) wheelWin.removeEventListener('wheel', forwardWheel);
      wheelWin = frame.contentWindow;
      if (wheelWin) wheelWin.addEventListener('wheel', forwardWheel, { passive: false });
    } catch {
      wheelWin = null;
    }
  };
  /* Keys go to the focused document, not the hovered frame. Hand Escape to a
     hovered bundled page, so it can dismiss its hover content. A frame never
     matches :hover while the pointer is inside it. */
  let hovered = false;
  const enter = () => {
    hovered = true;
  };
  const leave = () => {
    hovered = false;
  };
  const forwardEscape = e => {
    if (e.key !== 'Escape' || !hovered) return;
    try {
      const win = /** @type {any} */ (ifr.contentWindow);
      win?.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch {}
  };

  /* An iframe swallows touches. Listening on its own document keeps interior
     taps working, which an overlay would block. */
  /** @param {HTMLIFrameElement} frame */
  const attachTouch = frame => {
    /** @type {any} */
    let doc;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc || doc.__wgesture) return;
    doc.__wgesture = true;
    let sx = 0,
      sy = 0,
      moved = false,
      owned = false;
    const win = /** @type {Window} */ (doc.defaultView);
    /* A frame touch is in the frame's own pixels, and the frame moves with
       the page strip. Map every point through the frame's current box. */
    const at = touch => {
      const r = frame.getBoundingClientRect();
      const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
      return [r.left + touch.clientX * k, r.top + touch.clientY * k];
    };
    const time = e => e.timeStamp + win.performance.timeOrigin - performance.timeOrigin;
    const feed = () => (owned || typeof swipe !== 'function' ? null : swipe());
    doc.addEventListener(
      'touchstart',
      e => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        if (e.touches.length === 1) {
          sx = touch.clientX;
          sy = touch.clientY;
          moved = false;
          owned = ownsSidewaysTouch(e.target);
        }
        if (e.touches.length > 1) {
          feed()?.cancel();
          return;
        }
        const [x, y] = at(touch);
        feed()?.down('f' + touch.identifier, x, y, time(e));
      },
      { passive: true },
    );
    doc.addEventListener(
      'touchmove',
      e => {
        const touch = e.touches[0];
        if (touch && (Math.abs(touch.clientX - sx) > 8 || Math.abs(touch.clientY - sy) > 8)) moved = true;
        for (const tp of e.changedTouches) {
          const [x, y] = at(tp);
          feed()?.move('f' + tp.identifier, x, y, time(e));
        }
      },
      { passive: true },
    );
    /** @param {boolean} fling */
    const lift = fling => e => {
      for (const tp of e.changedTouches) feed()?.up('f' + tp.identifier, time(e), fling);
      if (!fling || moved || !overlayHref) return;
      /* tap on non-interactive area → open link */
      const target = e.target;
      const interactive =
        target &&
        target.closest &&
        target.closest('a,button,[role="button"],[onclick],.clickable,.bay,.val-row,.chart-wrap,input,select,textarea');
      if (!interactive) window.open(overlayHref, '_blank', 'noopener,noreferrer');
    };
    doc.addEventListener('touchend', lift(true), { passive: true });
    doc.addEventListener('touchcancel', lift(false), { passive: true });
  };

  /** @param {HTMLIFrameElement} frame @returns {boolean} false while the card has no size */
  const place = frame => {
    const w = card.clientWidth,
      h = card.clientHeight;
    if (!w || !h) return false;
    const s = Math.min(w / dw, h / dh);
    /* A bundled page fills the card and lays out at the card's shape, zoomed to
       the design's scale. Contain leaves strips of card beside anything drawn to
       the page edge. Whole pixels: a fractional size blurs on a 1x screen. */
    if (zoomable) {
      const fw = Math.round(w),
        fh = Math.round(h);
      frame.style.width = fw + 'px';
      frame.style.height = fh + 'px';
      frame.style.transform = `translate(${Math.round((w - fw) / 2)}px, ${Math.round((h - fh) / 2)}px)`;
      frame.setAttribute('data-zoom', String(Math.min(fw / dw, fh / dh)));
      applyZoom(frame);
    } else {
      frame.style.transform = `translate(${Math.round((w - dw * s) / 2)}px, ${Math.round((h - dh * s) / 2)}px) scale(${s})`;
    }
    return true;
  };
  /* Reveal only once scaled, avoids the flash of unscaled content on load. */
  const fit = () => {
    if (place(ifr)) ifr.style.opacity = '1';
  };

  /** @type {HTMLIFrameElement|null} */
  let pending = null;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let pendingTimer;
  /** @param {HTMLIFrameElement} frame */
  const unwire = frame => {
    frame.removeEventListener('load', onLoad);
    if (zoomable) {
      frame.removeEventListener('pointerenter', enter);
      frame.removeEventListener('pointerleave', leave);
    }
  };
  /** @param {HTMLIFrameElement} frame */
  const swapIn = frame => {
    clearTimeout(pendingTimer);
    pending = null;
    const old = ifr;
    unwire(old);
    old.remove();
    ifr = frame;
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    frame.style.pointerEvents = '';
    fit();
  };
  /** @param {Event} e */
  function onLoad(e) {
    const frame = /** @type {HTMLIFrameElement} */ (e.currentTarget);
    if (frame === pending) swapIn(frame);
    applyDir(frame);
    applyZoom(frame);
    if (zoomable) attachWheel(frame);
    if (mobile) attachTouch(frame);
  }
  /** @param {HTMLIFrameElement} frame */
  const wire = frame => {
    frame.addEventListener('load', onLoad);
    if (zoomable) {
      frame.addEventListener('pointerenter', enter);
      frame.addEventListener('pointerleave', leave);
    }
  };
  wire(ifr);
  if (zoomable) document.addEventListener('keydown', forwardEscape);
  cleanups.push(() => {
    unwire(ifr);
    document.removeEventListener('keydown', forwardEscape);
    try {
      if (wheelWin) wheelWin.removeEventListener('wheel', forwardWheel);
    } catch {}
  });
  try {
    if (ifr.contentDocument && ifr.contentDocument.readyState === 'complete') {
      applyDir(ifr);
      if (mobile) attachTouch(ifr);
    }
  } catch {}

  /* Jittered, so a dashboard full of widgets does not reload against every
     backing service on the same tick. */
  const refreshInterval = Number(o.refreshInterval) || 0;
  if (refreshInterval >= 250) {
    const base = refreshInterval;
    /* A new frame, not a navigation of the old one. A src change adds a Back
       entry. A location change drops the frame's referrer policy. */
    const reload = () => {
      if (pending) return;
      const next = src + (src.includes('?') ? '&' : '?') + '_r=' + Date.now();
      const frame = makeFrame(next, true);
      frame.style.transition = 'none';
      frame.style.pointerEvents = 'none';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      place(frame);
      wire(frame);
      pending = frame;
      clip.insertBefore(frame, ifr);
      pendingTimer = setTimeout(() => {
        if (pending !== frame) return;
        pending = null;
        unwire(frame);
        frame.remove();
      }, FRAME_LOAD_WAIT_MS);
    };
    const jit = ms => Math.round(ms * (1 + (Math.random() * 2 - 1) * 0.15));
    let rate = 1;
    let missed = false;
    const first = Math.round(Math.random() * base);
    let lastTick = Date.now() - base + first;
    const tick = () => {
      lastTick = Date.now();
      if (document.hidden) missed = true;
      else reload();
      timer = setTimeout(tick, jit(base * rate));
    };
    /* The handle is reassigned every tick. The cleanup must read the current
       one. */
    let timer = setTimeout(tick, first);
    /** @param {number} r */
    const setRate = r => {
      if (r === rate) return;
      rate = r;
      clearTimeout(timer);
      const due = lastTick + base * r - Date.now();
      if (due <= 0) tick();
      else timer = setTimeout(tick, jit(due));
    };
    _rates.set(card, setRate);
    const onShow = () => {
      if (document.hidden || !missed) return;
      missed = false;
      lastTick = Date.now();
      reload();
    };
    document.addEventListener('visibilitychange', onShow);
    cleanups.push(() => {
      clearTimeout(timer);
      _rates.delete(card);
      document.removeEventListener('visibilitychange', onShow);
      if (!pending) return;
      clearTimeout(pendingTimer);
      unwire(pending);
      pending.src = 'about:blank';
      pending.remove();
      pending = null;
    });
  }

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
}
