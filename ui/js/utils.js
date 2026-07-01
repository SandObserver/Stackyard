import { iconChain } from '/js/icons.js?v=36';

export const mk  = (t, a={}) => { const e = document.createElement(t); Object.assign(e, a); return e; };
export const clr = c => (!c||c==='dark') ? '#1C1C1E' : c==='light' ? '#F2F2F7' : c;
export const fb  = (l, sz) => { const e = mk('span'); e.className = 'fb'; e.style.fontSize = Math.round(sz*.32)+'px'; e.textContent = (l||'?')[0].toUpperCase(); return e; };
export const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* mkWrap: icon wrapper div used by both dashboard and ui.
   breg is passed in to avoid circular imports (it lives in dashboard state). */
/* Settings app icon, inlined so it needs no served file. Trusted, authored asset. */
const SETTINGS_ICON = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNHB0IiBoZWlnaHQ9IjEwMjRwdCIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cGF0aCBmaWxsPSIjZjJmMmY3IiBzdHJva2U9IiNmMmYyZjciIHN0cm9rZS13aWR0aD0iMC4wOTM3NSIgb3BhY2l0eT0iMS4wMCIgZD0iIE0gMzU1LjU1IDM5OC43NyBDIDM2NC45OSAzOTcuNjIgMzc0LjUxIDM5OC4xMCAzODQuMDAgMzk4LjAwIEMgNDc0LjY3IDM5OC4wMCA1NjUuMzQgMzk4LjAxIDY1Ni4wMSAzOTcuOTkgQyA2NzcuMTEgMzk3Ljk1IDY5OC4yMiA0MDMuODMgNzE2LjE1IDQxNC45OSBDIDc0Ni42MiA0MzMuNjAgNzY3LjMwIDQ2Ny4zMiA3NjkuNjYgNTAzLjAwIEMgNzcyLjYwIDUzOC4xNiA3NTcuNzIgNTc0LjA5IDczMS4wMCA1OTcuMDcgQyA3MTQuMjIgNjExLjcyIDY5My4wNCA2MjEuMjcgNjcwLjk0IDYyNC4wNSBDIDY2MS42NyA2MjUuMzQgNjUyLjMwIDYyNC45NCA2NDIuOTggNjI1LjAwIEMgNTU3LjMxIDYyNS4wMCA0NzEuNjQgNjI1LjAwIDM4NS45NyA2MjUuMDAgQyAzNzMuMzAgNjI0LjkyIDM2MC41MCA2MjUuNjAgMzQ3Ljk5IDYyMy4xMCBDIDMxNy4yMiA2MTcuNjAgMjg5LjIzIDU5OC42MiAyNzIuNjEgNTcyLjE2IEMgMjU5Ljc3IDU1Mi4wMyAyNTMuNjAgNTI3Ljc1IDI1NS4yNiA1MDMuOTMgQyAyNTYuNzAgNDgxLjI4IDI2NS4yNCA0NTkuMTcgMjc5LjMyIDQ0MS4zNyBDIDI5Ny43MyA0MTcuNzkgMzI1LjgwIDQwMi4wNiAzNTUuNTUgMzk4Ljc3IE0gNDY5LjMxIDQxMC40NyBDIDQ1Mi43OSA0MTIuMjIgNDM2LjYwIDQxNy41OCA0MjIuNzEgNDI2Ljc4IEMgNDAwLjE2IDQ0MS40MCAzODQuMDUgNDY1LjUyIDM3OS4xMCA0OTEuOTMgQyAzNzQuNjQgNTExLjQwIDM3Ny42NCA1MzEuODcgMzg0Ljc1IDU1MC4zMiBDIDM4OC4wNiA1NTcuNDAgMzkxLjMzIDU2NC41OSAzOTYuMjYgNTcwLjczIEMgNDE0Ljg1IDU5Ny42MyA0NDcuNTcgNjEzLjMwIDQ4MC4wNSA2MTMuMDEgQyA1MzguNzIgNjEzLjAwIDU5Ny4zOCA2MTMuMDQgNjU2LjA1IDYxMi45NyBDIDY4NC44OSA2MTIuMjggNzEzLjU2IDU5OS4zNyA3MzIuMDAgNTc2Ljk3IEMgNzM2LjY3IDU3MC44MyA3NDEuNTkgNTY0Ljc4IDc0NC43NCA1NTcuNjggQyA3NTAuMTEgNTQ3LjkxIDc1Mi44NSA1MzYuOTYgNzU0Ljg0IDUyNi4wNyBDIDc1Ny45MiA1MDguMzMgNzU0Ljc2IDQ5MC4wNiA3NDguNTMgNDczLjM1IEMgNzQ1LjE5IDQ2NS43NSA3NDEuNDcgNDU4LjI2IDczNi4zMiA0NTEuNzEgQyA3MjQuOTYgNDM1LjQxIDcwOC4xMyA0MjMuMzYgNjg5LjY5IDQxNi4zMSBDIDY3OC4xNiA0MTIuNTkgNjY2LjEzIDQwOS44NyA2NTMuOTYgNDEwLjAzIEMgNTk3LjI5IDQwOS45NSA1NDAuNjEgNDEwLjAzIDQ4My45NCA0MTAuMDAgQyA0NzkuMDYgNDA5Ljk4IDQ3NC4xNyA0MDkuOTQgNDY5LjMxIDQxMC40NyBaIiAvPgo8cGF0aCBmaWxsPSIjZGZkZmU0IiBzdHJva2U9IiNkZmRmZTQiIHN0cm9rZS13aWR0aD0iMC4wOTM3NSIgb3BhY2l0eT0iMS4wMCIgZD0iIE0gNDY5LjMxIDQxMC40NyBDIDQ3NC4xNyA0MDkuOTQgNDc5LjA2IDQwOS45OCA0ODMuOTQgNDEwLjAwIEMgNTQwLjYxIDQxMC4wMyA1OTcuMjkgNDA5Ljk1IDY1My45NiA0MTAuMDMgQyA2NjYuMTMgNDA5Ljg3IDY3OC4xNiA0MTIuNTkgNjg5LjY5IDQxNi4zMSBDIDcwOC4xMyA0MjMuMzYgNzI0Ljk2IDQzNS40MSA3MzYuMzIgNDUxLjcxIEMgNzQxLjQ3IDQ1OC4yNiA3NDUuMTkgNDY1Ljc1IDc0OC41MyA0NzMuMzUgQyA3NTQuNzYgNDkwLjA2IDc1Ny45MiA1MDguMzMgNzU0Ljg0IDUyNi4wNyBDIDc1Mi44NSA1MzYuOTYgNzUwLjExIDU0Ny45MSA3NDQuNzQgNTU3LjY4IEMgNzQxLjU5IDU2NC43OCA3MzYuNjcgNTcwLjgzIDczMi4wMCA1NzYuOTcgQyA3MTMuNTYgNTk5LjM3IDY4NC44OSA2MTIuMjggNjU2LjA1IDYxMi45NyBDIDU5Ny4zOCA2MTMuMDQgNTM4LjcyIDYxMy4wMCA0ODAuMDUgNjEzLjAxIEMgNDQ3LjU3IDYxMy4zMCA0MTQuODUgNTk3LjYzIDM5Ni4yNiA1NzAuNzMgQyAzOTEuMzMgNTY0LjU5IDM4OC4wNiA1NTcuNDAgMzg0Ljc1IDU1MC4zMiBDIDM3Ny42NCA1MzEuODcgMzc0LjY0IDUxMS40MCAzNzkuMTAgNDkxLjkzIEMgMzg0LjA1IDQ2NS41MiA0MDAuMTYgNDQxLjQwIDQyMi43MSA0MjYuNzggQyA0MzYuNjAgNDE3LjU4IDQ1Mi43OSA0MTIuMjIgNDY5LjMxIDQxMC40NyBNIDQ2Ny40OCA0MjIuNjYgQyA0MzYuNjggNDI2LjEzIDQwOC43NCA0NDcuMDggMzk2LjUwIDQ3NS41MSBDIDM4Ny43NyA0OTUuMjcgMzg2LjU4IDUxOC4yMSAzOTMuMjEgNTM4Ljc2IEMgMzk4LjcyIDU1Ni4xNiA0MDkuNzUgNTcxLjc1IDQyNC4zMCA1ODIuNzYgQyA0MzkuMDQgNTk0LjA3IDQ1Ny4zOSA2MDAuNTEgNDc1Ljk1IDYwMS4wMCBDIDUzMi4zMiA2MDEuMDAgNTg4LjY5IDYwMS4wMCA2NDUuMDYgNjAxLjAwIEMgNjUyLjE5IDYwMC45NCA2NTkuMzcgNjAxLjMzIDY2Ni40NiA2MDAuMjIgQyA2ODMuMTYgNTk4LjA4IDY5OS4xNCA1OTAuOTUgNzEyLjAyIDU4MC4xMSBDIDcyOC41OCA1NjYuMzIgNzM5Ljg5IDU0Ni4zMiA3NDMuMDAgNTI0Ljk4IEMgNzQ1Ljg2IDUwNi42NSA3NDIuNzYgNDg3LjQ2IDczNC4zNCA0NzAuOTQgQyA3MjYuNzQgNDU1Ljk3IDcxNC44NCA0NDMuMjMgNzAwLjQxIDQzNC42MyBDIDY4NS45NCA0MjUuODggNjY4LjkyIDQyMS41NCA2NTIuMDMgNDIxLjk5IEMgNTk1LjY2IDQyMi4wMSA1MzkuMjkgNDIyLjAwIDQ4Mi45MSA0MjIuMDAgQyA0NzcuNzYgNDIxLjk0IDQ3Mi41OSA0MjEuOTQgNDY3LjQ4IDQyMi42NiBaIiAvPgo8cGF0aCBmaWxsPSIjMzg3Zjk1IiBzdHJva2U9IiMzODdmOTUiIHN0cm9rZS13aWR0aD0iMC4wOTM3NSIgb3BhY2l0eT0iMS4wMCIgZD0iIE0gNDY3LjQ4IDQyMi42NiBDIDQ3Mi41OSA0MjEuOTQgNDc3Ljc2IDQyMS45NCA0ODIuOTEgNDIyLjAwIEMgNTM5LjI5IDQyMi4wMCA1OTUuNjYgNDIyLjAxIDY1Mi4wMyA0MjEuOTkgQyA2NjguOTIgNDIxLjU0IDY4NS45NCA0MjUuODggNzAwLjQxIDQzNC42MyBDIDcxNC44NCA0NDMuMjMgNzI2Ljc0IDQ1NS45NyA3MzQuMzQgNDcwLjk0IEMgNzQyLjc2IDQ4Ny40NiA3NDUuODYgNTA2LjY1IDc0My4wMCA1MjQuOTggQyA3MzkuODkgNTQ2LjMyIDcyOC41OCA1NjYuMzIgNzEyLjAyIDU4MC4xMSBDIDY5OS4xNCA1OTAuOTUgNjgzLjE2IDU5OC4wOCA2NjYuNDYgNjAwLjIyIEMgNjU5LjM3IDYwMS4zMyA2NTIuMTkgNjAwLjk0IDY0NS4wNiA2MDEuMDAgQyA1ODguNjkgNjAxLjAwIDUzMi4zMiA2MDEuMDAgNDc1Ljk1IDYwMS4wMCBDIDQ1Ny4zOSA2MDAuNTEgNDM5LjA0IDU5NC4wNyA0MjQuMzAgNTgyLjc2IEMgNDA5Ljc1IDU3MS43NSAzOTguNzIgNTU2LjE2IDM5My4yMSA1MzguNzYgQyAzODYuNTggNTE4LjIxIDM4Ny43NyA0OTUuMjcgMzk2LjUwIDQ3NS41MSBDIDQwOC43NCA0NDcuMDggNDM2LjY4IDQyNi4xMyA0NjcuNDggNDIyLjY2IFoiIC8+Cjwvc3ZnPg==';

export function mkWrap(item, sz, r, isz, cls, breg) {
  const w = mk('div');
  if (cls) w.className = cls;
  w.style.cssText = `width:${sz}px;height:${sz}px;border-radius:${r}px;background:${clr(item.color)};position:relative;flex-shrink:0;overflow:visible;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;box-shadow:inset 1px 1px 0 rgba(255,255,255,.18),inset -1px -1px 0 rgba(0,0,0,.14);`;
  const g = mk('div');
  g.style.cssText = `position:absolute;inset:0;border-radius:${r}px;pointer-events:none;z-index:2;background:linear-gradient(135deg,rgba(255,255,255,.10) 0%,transparent 60%);`;
  w.appendChild(g);
  const rawIcon = item.iconUrl||'';
  if (item.system === 'settings') {
    const img = mk('img', { src: SETTINGS_ICON, alt:'', draggable:false });
    img.setAttribute('aria-hidden', 'true');
    img.style.cssText = `width:${isz}px;height:${isz}px;object-fit:contain;position:relative;z-index:3;`;
    img.onerror = () => img.replaceWith(fb(item.label, sz));
    w.appendChild(img);
  } else if (rawIcon) {
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
    `width:${dw}px;height:${dh}px;transform-origin:top left;opacity:0;transition:opacity .12s ease;`;
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
    ifr.style.opacity = '1';            /* reveal only once scaled — avoids the flash of unscaled content on load */
  };
  if (typeof ResizeObserver !== 'undefined') { new ResizeObserver(fit).observe(card); }
  else { window.addEventListener('resize', fit); }
  requestAnimationFrame(fit); fit();
  return ifr;
}