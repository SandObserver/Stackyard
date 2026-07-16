import { mk, clr } from '/js/utils.js';
import { t } from '/js/i18n.js?v=1';

export function initSpotlight({ getItems, MOB, CB, iconChain, openFolderDesktop, openFolderMobile }) {
  const ov        = document.getElementById('spot');
  const inp       = document.getElementById('sin');
  const res       = document.getElementById('sres');
  const cancelBtn = document.getElementById('spot-cancel');
  const live      = document.getElementById('sres-live');
  let si = 0, cur = [];
  let lastFocused = null;

  inp.setAttribute('role','combobox');
  inp.setAttribute('aria-autocomplete','list');
  inp.setAttribute('aria-controls','sres');
  inp.setAttribute('aria-expanded','false');
  res.setAttribute('role','listbox');
  res.setAttribute('aria-label',t('home.searchResults'));

  const render = q => {
    res.innerHTML = '';
    const apps = getItems().filter(i => i.type === 'app' || i.type === 'folder');
    const qq = q.toLowerCase().trim();
    cur = qq ? apps.filter(a => (a.label||a.id).toLowerCase().includes(qq)) : apps;
    si = 0;
    if (!cur.length) {
      const e = mk('div');
      e.style.cssText = 'padding:24px;text-align:center;color:rgba(255,255,255,.35);font-size:14px';
      e.textContent = t('home.noResults');
      res.appendChild(e);
      if (live) live.textContent = t('home.noResults');
      inp.setAttribute('aria-activedescendant', '');
      return;
    }
    const f = document.createDocumentFragment();
    const hdr = mk('div'); hdr.className = 'sr-section'; hdr.textContent = t('home.appsAndFolders'); f.appendChild(hdr);
    cur.forEach((app, i) => {
      const isFolder = app.type === 'folder';
      const a = mk('a', { href: app.href||'#', target: isFolder ? '_self' : '_blank', rel: 'noreferrer noopener' });
      a.className = 'sr' + (i === 0 ? ' sel' : '');
      a.id = 'sr-opt-' + i;
      a.setAttribute('role','option');
      a.setAttribute('aria-label', app.label||app.id);
      a.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      a.style.cssText = 'display:flex;align-items:center;gap:18px;padding:14px 20px;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;';
      const doOpen = () => {
        close();
        if (isFolder) {
          if (MOB) openFolderMobile(app, Math.round(60*(innerWidth/393)), Math.round(14*(innerWidth/393)), Math.round(38*(innerWidth/393)), innerWidth/393);
          else openFolderDesktop(app);
        } else if (app.href) {
          window.open(app.href, '_blank', 'noreferrer,noopener');
        }
      };
      a.addEventListener('touchend', e => { e.preventDefault(); doOpen(); });
      a.onclick = doOpen;

      const ic = mk('div'); ic.className = 'sri';
      ic.style.background = clr(app.color);
      if (app.iconUrl) {
        const img = mk('img', { alt: '', loading: 'lazy' });
        img.setAttribute('aria-hidden', 'true');
        const srcs = iconChain(app.iconUrl);
        if (srcs.length) img.src = srcs[0];
        let step = 0;
        img.onerror = () => { step++; if (step < srcs.length) img.src = srcs[step]; else { ic.innerHTML = ''; ic.textContent = (app.label||app.id)[0].toUpperCase(); ic.style.color = '#fff'; ic.style.fontWeight = '600'; } };
        ic.appendChild(img);
      } else {
        ic.textContent = (app.label||app.id)[0].toUpperCase();
        ic.style.color = '#fff'; ic.style.fontWeight = '600';
      }

      const tx = mk('div'); tx.style.cssText = 'flex:1;min-width:0;';
      const nm = mk('div'); nm.className = 'srn'; nm.textContent = app.label||app.id;
      const ht = mk('div'); ht.className = 'srh';
      ht.textContent = (app.href||'').replace(/^https?:\/\//,'').replace(/\/$/,'');
      const ar = mk('span'); ar.className = 'sra'; ar.textContent = '↗';
      ar.setAttribute('aria-hidden', 'true');
      tx.append(nm, ht); a.append(ic, tx, ar); f.appendChild(a);
    });
    res.appendChild(f);
    if (live) live.textContent = cur.length + ' ' + (cur.length === 1 ? t('home.result') : t('home.results'));
    inp.setAttribute('aria-expanded', 'true');
    inp.setAttribute('aria-activedescendant', cur.length ? 'sr-opt-0' : '');
  };

  const upd = () => res.querySelectorAll('.sr').forEach((e, i) => {
    const on = i === si;
    e.classList.toggle('sel', on);
    e.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) { e.scrollIntoView({ block: 'nearest' }); inp.setAttribute('aria-activedescendant', e.id); }
  });

  /* Mobile: touch on bar focuses input */
  const barEl = ov.querySelector('.spot-bar');
  if (MOB && barEl) {
    barEl.style.cssText = 'display:flex;align-items:center;gap:12px;padding:16px 18px;border-radius:18px;border:none;background:rgba(118,118,128,.30);box-sizing:border-box;';
    inp.style.cssText = 'flex:1;background:transparent;border:0;outline:none;font-size:17px;color:rgba(255,255,255,.92);font-family:inherit;caret-color:#007aff;-webkit-appearance:none;min-height:26px;padding:0;margin:0;';
  }
  if (barEl) barEl.addEventListener('touchend', e => { e.preventDefault(); inp.focus(); if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length); }, { passive: false });

  function _applyKbLayout() {
    if (!MOB) return;
    const vvH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    ov.style.bottom = Math.max(0, window.innerHeight - vvH) + 'px';
  }

  function trap(e) {
    if (e.key !== 'Tab') return;
    const f = [inp, ...ov.querySelectorAll('button:not([disabled]),a[href]')].filter(el => el && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function open(ch) {
    lastFocused = document.activeElement;
    ov.classList.add('on');
    ov.setAttribute('aria-hidden', 'false');
    ov.addEventListener('keydown', trap);
    inp.value = ch || '';
    render(inp.value);
    if (MOB && window.visualViewport) {
      window.visualViewport.addEventListener('resize', _applyKbLayout);
      window.visualViewport.addEventListener('scroll', _applyKbLayout);
      window._spotVpCleanup = () => {
        window.visualViewport.removeEventListener('resize', _applyKbLayout);
        window.visualViewport.removeEventListener('scroll', _applyKbLayout);
      };
    }
    if (MOB) { inp.focus(); if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ov.classList.add('vis');
      _applyKbLayout();
      if (!MOB) { inp.focus(); if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length); }
    }));
  }

  function close() {
    ov.classList.remove('vis');
    ov.removeEventListener('keydown', trap);
    ov.setAttribute('aria-hidden', 'true');
    inp.setAttribute('aria-expanded', 'false');
    inp.setAttribute('aria-activedescendant', '');
    if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch {} lastFocused = null; }
    if (window._spotVpCleanup) { window._spotVpCleanup(); window._spotVpCleanup = null; }
    ov.style.bottom = '';
    setTimeout(() => {
      if (!ov.classList.contains('vis')) ov.classList.remove('on');
      inp.value = ''; res.innerHTML = ''; inp.blur();
    }, 220);
  }

  ov.onclick = e => { if (e.target === ov || e.target === res) close(); };
  ov.addEventListener('touchend', e => { if (e.target === ov) { e.preventDefault(); close(); } }, { passive: false });

  if (cancelBtn) {
    cancelBtn.onclick = close;
    cancelBtn.addEventListener('touchend', e => { e.preventDefault(); close(); }, { passive: false });
  }
  const mobCancelBtn = document.getElementById('spot-cancel-mob-btn');
  if (mobCancelBtn) {
    mobCancelBtn.onclick = close;
    mobCancelBtn.addEventListener('touchend', e => { e.preventDefault(); close(); }, { passive: false });
  }

  inp.oninput = () => render(inp.value);
  inp.onkeydown = e => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { si = Math.min(si+1, cur.length-1); upd(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp')   { si = Math.max(si-1, 0);            upd(); e.preventDefault(); return; }
    if (e.key === 'Enter') { const s = res.querySelectorAll('.sr')[si]; if (s) { s.click(); close(); } }
  };

  /* Desktop: any printable key opens spotlight */
  document.addEventListener('keydown', e => {
    if (ov.classList.contains('on')) return;
    if (e.key === 'Escape' || e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopImmediatePropagation(); open(e.key);
  }, true);

  CB.spotOpen  = open;
  CB.spotClose = close;
}
