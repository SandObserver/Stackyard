import { iconChain } from '/js/icons.js?v=36';

export const mk  = (t, a={}) => { const e = document.createElement(t); Object.assign(e, a); return e; };
export const clr = c => (!c||c==='dark') ? '#1C1C1E' : c==='light' ? '#F2F2F7' : c;
export const fb  = (l, sz) => { const e = mk('span'); e.className = 'fb'; e.style.fontSize = Math.round(sz*.32)+'px'; e.textContent = (l||'?')[0].toUpperCase(); return e; };

/* mkWrap: icon wrapper div used by both dashboard and ui.
   breg is passed in to avoid circular imports (it lives in dashboard state). */
export function mkWrap(item, sz, r, isz, cls, breg) {
  const w = mk('div');
  if (cls) w.className = cls;
  w.style.cssText = `width:${sz}px;height:${sz}px;border-radius:${r}px;background:${clr(item.color)};position:relative;flex-shrink:0;overflow:visible;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;box-shadow:inset 1px 1px 0 rgba(255,255,255,.18),inset -1px -1px 0 rgba(0,0,0,.14);`;
  const g = mk('div');
  g.style.cssText = `position:absolute;inset:0;border-radius:${r}px;pointer-events:none;z-index:2;background:linear-gradient(135deg,rgba(255,255,255,.10) 0%,transparent 60%);`;
  w.appendChild(g);
  const rawIcon = item.iconUrl||'';
  if (rawIcon) {
    const chain = iconChain(rawIcon);
    if (chain.length) {
      const img = mk('img', { src:chain[0], alt:'', loading:'lazy', draggable:false });
      img.setAttribute('aria-hidden', 'true');
      img.style.cssText = `width:${isz}px;height:${isz}px;object-fit:contain;position:relative;z-index:3;`;
      let step = 0;
      const tryNext = () => { step++; if (step < chain.length) img.src = chain[step]; else img.replaceWith(fb(item.label, sz)); };
      img.onerror = tryNext;
      /* 403 responses don't trigger onerror — the browser considers them a successful
         load. Check naturalWidth on load; a broken/blocked image has zero dimensions. */
      img.onload = () => { if (img.naturalWidth === 0) tryNext(); };
      w.appendChild(img);
    } else w.appendChild(fb(item.label, sz));
  } else w.appendChild(fb(item.label, sz));
  if (breg && (item.monitoring?.healthcheck?.enabled || item.monitoring?.activity?.enabled || item.container || item.badge?.enabled)) {
    const b = mk('div'); b.className = 'badge'; w.appendChild(b); breg(item.id, b);
  }
  return w;
}


/* Mount a widget iframe at a fixed design resolution and scale it uniformly to
   fill `card`. The iframe's internal viewport is therefore constant regardless
   of the card's on-screen size, so widget content renders identically on every
   device — no per-size patching. `card` should be aspect-locked to design/design. */
export function mountScaledWidget(card, { src, title, design, iframeOpts, overlayHref, mobile, onSwipe } = {}) {
  const [dw, dh] = design;
  const o = iframeOpts || {};
  if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
  card.style.overflow = 'hidden';
  const clip = mk('div');
  clip.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  const ifr = mk('iframe', { src, scrolling: (o.scrolling === true || o.scrolling === 'yes') ? 'yes' : 'no', title });
  ifr.setAttribute('allow', o.allow || 'fullscreen');
  if (o.allowFullscreen !== false) ifr.setAttribute('allowfullscreen', '');
  if (o.referrerPolicy) ifr.setAttribute('referrerpolicy', o.referrerPolicy);
  if (o.loading) ifr.setAttribute('loading', o.loading);
  ifr.setAttribute('aria-label', title);
  ifr.style.cssText = `position:absolute;top:0;left:0;display:block;border:0;` +
    `width:${dw}px;height:${dh}px;transform-origin:top left;`;
  clip.appendChild(ifr); card.appendChild(clip);

  /* Optional auto-refresh: reload the iframe on an interval */
  if (o.refreshInterval && o.refreshInterval >= 250) {
    setInterval(() => { ifr.src = src + (src.includes('?') ? '&' : '?') + '_r=' + Date.now(); }, o.refreshInterval);
  }

  /* On mobile, an iframe swallows touches so the home pager never sees a swipe that
     starts on a widget. Rather than overlay the iframe (which would block taps from
     reaching interactive widget content), we listen on the iframe's own document
     (same-origin) — so interior taps still work, horizontal swipes page the home
     screen, and a tap on non-interactive widget area opens the widget's link. */
  if (mobile) {
    const attach = () => {
      let doc; try { doc = ifr.contentDocument; } catch (e) { return; }
      if (!doc || doc.__wgesture) return;
      doc.__wgesture = true;
      let sx = 0, sy = 0, moved = false;
      doc.addEventListener('touchstart', e => { const t = e.touches[0]; if (!t) return; sx = t.clientX; sy = t.clientY; moved = false; }, { passive:true });
      doc.addEventListener('touchmove',  e => { const t = e.touches[0]; if (!t) return; if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) moved = true; }, { passive:true });
      doc.addEventListener('touchend',   e => {
        const t = e.changedTouches[0]; if (!t) return;
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.4) {     /* horizontal swipe → page */
          if (typeof onSwipe === 'function') onSwipe(dx < 0 ? 1 : -1);
          return;
        }
        if (!moved && overlayHref) {                                      /* tap on non-interactive area → open link */
          const tgt = e.target;
          const interactive = tgt && tgt.closest && tgt.closest('a,button,[role="button"],[onclick],.clickable,.bay,.val-row,.chart-wrap,input,select,textarea');
          if (!interactive) window.open(overlayHref, '_blank', 'noopener,noreferrer');
        }
      }, { passive:true });
    };
    ifr.addEventListener('load', attach);
    try { if (ifr.contentDocument && ifr.contentDocument.readyState === 'complete') attach(); } catch (e) {}
  }

  const fit = () => {
    const w = card.clientWidth, h = card.clientHeight;
    if (!w || !h) return;
    const s = Math.max(w / dw, h / dh);            /* cover; with matched aspect = exact fill */
    const tx = (w - dw * s) / 2, ty = (h - dh * s) / 2;
    ifr.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  if (typeof ResizeObserver !== 'undefined') { new ResizeObserver(fit).observe(card); }
  else { window.addEventListener('resize', fit); }
  requestAnimationFrame(fit); fit();
  return ifr;
}