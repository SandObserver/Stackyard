/* dashboard.js — boot, state, badge system, desktop layout, navigation, background, polling */

import { LOCAL_ICONS, loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=36';
import { WIDGET_TYPES, WIDGET_HEIGHTS, WIDGET_DESIGN, WIDGET_COLS, WIDGET_ROWS, WIDGET_COST, widgetSrc } from '/js/widget-types.js?v=39';
import { mk, clr, fb, mkWrap as _mkWrap, mountScaledWidget } from '/js/utils.js?v=37';
import { initSpotlight } from '/js/spotlight.js?v=36';
import { initUI, mkMiniIcon, mkFolder, openFolderDesktop, mFolder, openFolderMobile, buildMobile } from '/js/ui.js?v=39';

const API = '';
const MOB = innerWidth <= 768 || /iPhone|iPod|Android/i.test(navigator.userAgent);

const wCols  = { d: WIDGET_COLS.desktop,  m: WIDGET_COLS.mobile  };
const wRows = { d: WIDGET_ROWS.desktop,  m: WIDGET_ROWS.mobile  };
const WH  = { d: WIDGET_HEIGHTS };
const wCost  = { d: WIDGET_COST.desktop,  m: WIDGET_COST.mobile  };
const SLOTS = 24;

const CB = { spotOpen: null, spotClose: null, mobPillBump: null };

let items = [], pg = 0, totalPages = 0, S = {}, _stateRef = null;
let _mobTsCleanup = null, _mobTeCleanup = null, _mobTmCleanup = null;

const badgeState  = {};
let _badgeFails = 0, _healthFails = 0, badgesStale = false, healthStale = false;
const BEL = new Map();
function breg(id, el) { if (!BEL.has(id)) BEL.set(id, new Set()); BEL.get(id).add(el); }
function bunreg(id, el) { if (BEL.has(id)) BEL.get(id).delete(el); }
function bupd(id) {
  const els = BEL.get(id); if (!els?.size) return;
  const item = items.find(i => i.id === id);
  const s = item?.type === 'folder' ? folderBadge(item) : (badgeState[id]||{});
  const hideHealthy = S.server?.hideHealthyBadge !== false;
  const custom   = item?.monitoring?.activity?.custom || {};
  const staticBdg = item?.monitoring?.staticBadge || {};

  /* Named-color → hex for all badge types */
  const NAMED={blue:'#1e6ef4',green:'#008932',yellow:'#ffcc00',red:'#e9152d',gray:'#636366'};

  /* WCAG contrast: use dark text (#1c1c1e) only when it gives higher contrast ratio than white.
     ratioW = 1.05/(L+0.05)  [white on bg]
     ratioD = (L+0.05)/0.0617 [bg on near-black; LD(#1c1c1e)≈0.0117, LD+0.05=0.0617] */
  function needsDark(hex){
    try{
      const h=hex.replace(/^#/,'');
      if(h.length!==6)return false;
      const [r,g,b]=[0,2,4].map(i=>{const v=parseInt(h.slice(i,i+2),16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
      const L=0.2126*r+0.7152*g+0.0722*b;
      return (L+0.05)/0.0617 > 1.05/(L+0.05);
    }catch{return false;}
  }

  /* Resolve a named color key or raw hex to a hex string */
  function resolveColor(c){ return c?(NAMED[c]||c):''; }

  /* Priority: unhealthy (1) > activity (2) > fixed-label (3) > healthy-dot (4)
     Each higher-priority signal overrides lower ones. */
  let cls, txt, bg='';

  if(s.health){
    /* 1 — unhealthy */
    cls='badge on red'; txt='!';

  } else if(s.activity > 0){
    /* 2 — activity badge */
    cls='badge on blue';
    txt=s.activity>99?'99+':String(s.activity);
    if(custom.unit) txt+=' '+custom.unit.slice(0,8);
    bg=resolveColor(custom.color);

  } else if(staticBdg.enabled && staticBdg.label){
    /* 3 — fixed label badge */
    cls='badge on blue';
    txt=staticBdg.label.slice(0,10);
    bg=resolveColor(staticBdg.color);

  } else {
    /* 4 — healthy green dot: show when hideHealthy is OFF and the app has a health check.
       Show as soon as health check is configured — switches to red immediately if unhealthy. */
    const hasHC=!!(item?.monitoring?.healthcheck?.enabled||item?.container||item?.ping);
    if(!hideHealthy && hasHC){
      cls='badge on green'; txt='';
    } else {
      cls='badge'; txt='';
    }
  }

  /* Accessible status text so meaning isn't carried by color alone (HIG: don't rely on color) */
  let aria='';
  if(s.health) aria='Status: needs attention';
  else if(s.activity>0) aria=(s.activity>99?'99+':String(s.activity))+(custom.unit?' '+custom.unit:'')+' pending';
  else if(staticBdg.enabled && staticBdg.label) aria=staticBdg.label;
  else if(cls.includes('green')) aria='Status: healthy';

  if((s.activity>0 && badgesStale) || ((s.health || cls.includes('green')) && healthStale)){
    cls+=' stale';
    aria=(aria?aria+' ':'')+'(may be out of date)';
  }

  els.forEach(el=>{
    el.className=cls; el.textContent=txt;
    if(aria){ el.setAttribute('role','status'); el.setAttribute('aria-label',aria); }
    else { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
    /* Custom background (overrides the class-based color for activity/label badges) */
    el.style.background=bg;
    /* Auto dark text: use WCAG luminance check on the resolved hex.
       Falls back to class-based color (blue/red/green) when bg is empty. */
    const effectiveBg=bg||(cls.includes('red')?NAMED.red:cls.includes('green')?NAMED.green:cls.includes('blue')?NAMED.blue:'');
    el.style.color=effectiveBg&&needsDark(effectiveBg)?'#1c1c1e':'';
  });
}

function bset(id, type, val) {
  if (!badgeState[id]) badgeState[id] = { health: 0, activity: 0 };
  badgeState[id][type] = val; bupd(id);
  items.filter(i => i.type === 'folder' && (i.children||[]).includes(id)).forEach(f => bupd(f.id));
}
function folderBadge(folder) {
  const children = (folder.children||[]).map(id => items.find(i => i.id === id)).filter(Boolean);
  let actSum = 0, hasHealth = false;
  for (const c of children) { const s = badgeState[c.id]||{}; if (s.health) hasHealth = true; if (s.activity > 0) actSum += s.activity; }
  return { health: hasHealth, activity: actSum };
}

/* mkWrap bound to local breg — keeps call sites unchanged */
const mkWrap = (item, sz, r, isz, cls) => _mkWrap(item, sz, r, isz, cls, breg);

function paginate() {
  const pl = MOB ? 'm' : 'd';
  const inFolder = new Set(items.filter(i => i.type === 'folder').flatMap(f => f.children||[]).map(String));
  const pages = []; let cur = [], used = 0;
  for (const item of items) {
    if (item.dock) continue;
    if (inFolder.has(String(item.id))) continue;
    const cost = item.type === 'widget' ? wCost[pl][item.widgetSize||'medium'] : 1;
    if (used + cost > SLOTS && cur.length) { pages.push([...cur]); cur = []; used = 0; }
    cur.push(item); used += cost;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function mkIcon(item) {
  if (item.type === 'folder') return mkFolder(item);
  const showLabel = S.showLabels?.desktop !== false;
  const iw = showLabel ? 72 : 78, isz = showLabel ? 50 : 56;
  const a = mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
  a.className = 'icon';
  a.setAttribute('aria-label', item.label||item.id);
  a.appendChild(mkWrap(item, iw, 16, isz, 'iwrap'));
  if (showLabel) {
    const l = mk('div'); l.className = 'ilabel'; l.style.width = (iw+12)+'px';
    l.textContent = item.label||item.id; a.appendChild(l);
  }
  return a;
}

function widgetTitle(item) {
  const names = { stats:'System stats', connections:'Connections', map:'Connections', dns:'DNS Server', weather:'Weather', nowplaying:'Now Playing', books:'Books', github:'GitHub', clock:'Clock', duplicati:'Backup status', custom:'Widget' };
  if (item.widgetType === 'stats' && item.widgetConfig?.widgetSubType === 'disk-health') return item.label || 'Disk health';
  return item.label || names[item.widgetType] || 'Widget';
}
function mkWidget(item) {
  const sz = item.widgetSize||'medium';
  const cell = mk('div');
  let cls = `wc c${wCols.d[sz]}`; if (wRows.d[sz] >= 3) cls += ' r3'; else if (wRows.d[sz] >= 2) cls += ' r2';
  cell.className = cls;
  const card = mk('div'); card.className = 'widget';
  if (item.widgetType) card.dataset.wtype = item.widgetType;
  if (item.widgetConfig?.widgetSubType) card.dataset.wsubtype = item.widgetConfig.widgetSubType;
  const design = WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium;
  /* Definite height (matches the family box aspect, which equals the design aspect),
     so the grid row sizes predictably and `.wc{align-items:stretch}` won't override it. */
  card.style.height = WH.d[sz] + 'px';
  mountScaledWidget(card, { src: widgetSrc(item), title: widgetTitle(item), design, iframeOpts: item.iframe });
  cell.appendChild(card); return cell;
}

function mkDock(item) {
  const a = mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
  a.className = 'di'; a.setAttribute('aria-label', item.label||item.id);
  a.appendChild(mkWrap(item, 78, 15, 50, 'dwrap')); return a;
}

function buildDesktop() {
  BEL.clear();
  const dock = items.filter(i => i.type === 'app' && i.dock).slice(0,4);
  const pages = paginate(); totalPages = pages.length;
  const strip = document.getElementById('pages'); strip.innerHTML = '';
  pages.forEach(pageItems => {
    const p = mk('div'); p.className = 'page';
    const g = mk('div'); g.className = 'grid';
    for (const item of pageItems) g.appendChild(item.type === 'widget' ? mkWidget(item) : mkIcon(item));
    p.appendChild(g); strip.appendChild(p);
  });
  const dots = document.getElementById('dots'); dots.innerHTML = '';
  pages.forEach((_, i) => { const d = mk('div'); d.className = 'dot'+(i===0?' on':''); d.onclick = () => goTo(i); dots.appendChild(d); });
  const dk = document.getElementById('dock'); dk.innerHTML = '';
  dock.forEach(item => dk.appendChild(mkDock(item)));
  const ct = document.getElementById('ctrls'); ct.innerHTML = '';
  const al = mk('a', { href: '/admin/' }); al.className = 'ctrl'; al.title = 'Settings'; al.setAttribute('aria-label','Settings'); al.textContent = '⚙';
  ct.append(al);
}

function goTo(n, dotEls) {
  const total = dotEls ? dotEls.length : totalPages;
  pg = Math.max(0, Math.min(total-1, n));
  /* Keep stateRef.pg in sync so mobile swipe handler always has the correct current page */
  if (_stateRef) _stateRef.pg = pg;
  const strip = document.getElementById('pages');
  const t = `translateX(-${pg*100}vw)`;
  strip.style.transform = strip.style.webkitTransform = t;
  strip.style.willChange = 'transform';
  strip.addEventListener('transitionend', () => { strip.style.willChange = 'auto'; }, { once: true });
  (dotEls ?? document.querySelectorAll('.dot')).forEach((d, i) => d.classList.toggle('on', i === pg));
  if (MOB && CB.mobPillBump) CB.mobPillBump(pg);
}

/* After buildMobile, DOM may contain more pages than paginate() reported
   (overflow pages created by ensureSpace). Sync totalPages and dots from DOM. */
function syncMobPages() {
  const strip = document.getElementById('pages');
  const domCount = strip ? strip.children.length : 0;
  if (domCount <= totalPages) return; /* no overflow pages — nothing to fix */
  totalPages = domCount;
  /* Rebuild main dots */
  const dots = document.getElementById('dots'); dots.innerHTML = '';
  for (let i = 0; i < domCount; i++) {
    const d = mk('div'); d.className = 'dot'+(i===pg?' on':'');
    d.onclick = () => goTo(i); dots.appendChild(d);
  }
  /* Rebuild pill dots — keep existing pill node, just add the extra dot */
  const pillDots = document.querySelector('.msp-dots');
  if (pillDots) {
    /* Add missing dots (there may already be totalPages-1 dots from buildMobile) */
    while (pillDots.children.length < domCount) {
      const d = document.createElement('div');
      d.className = 'msp-dot';
      pillDots.appendChild(d);
    }
    /* Re-sync active state */
    Array.from(pillDots.children).forEach((d, i) => d.classList.toggle('on', i === pg));
    /* Patch pillBump to drive the full set of dots — wrap original to preserve animation */
    const origBump = CB.mobPillBump;
    CB.mobPillBump = (newPg) => {
      if (origBump) origBump(newPg); /* runs pillPaging animation */
      /* origBump only drives old dot count; fix any extra dots */
      Array.from(pillDots.children).forEach((d, i) => d.classList.toggle('on', i === newPg));
    };
  }
}

function buildClock() {
  const c = document.getElementById('clock');
  const D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tick = () => { const n = new Date(); let h = n.getHours(); const m = String(n.getMinutes()).padStart(2,'0'), ap = h>=12?'PM':'AM'; h = h%12||12; c.textContent = `${D[n.getDay()]}, ${M[n.getMonth()]} ${n.getDate()}   ${h}:${m} ${ap}`; };
  tick();
  return tick; /* caller holds interval ref for visibility-based suspend/resume */
}

function sanitizeCssUrl(u) { return String(u||'').replace(/['"\(\)]/g,''); }
async function applyBg() {
  const root = document.documentElement;
  try {
    const bg = S.background||{};
    if (bg.type === 'color' && bg.color) {
      const safeColor = String(bg.color).replace(/[^a-zA-Z0-9#(),.\s%]/g,'');
      root.style.setProperty('--bg-image', 'none');
      root.style.setProperty('--bg-color', safeColor);
      root.style.setProperty('--bg-brightness', '1');
    } else if (bg.type === 'url' && bg.url) {
      root.style.setProperty('--bg-image', `url('${sanitizeCssUrl(bg.url)}')`);
      root.style.setProperty('--bg-color', '#0d1117');
      root.style.setProperty('--bg-brightness', String(bg.brightness??0.62));
    } else if (bg.type === 'unsplash') {
      const r = await fetch('/api/wallpaper', { cache:'no-store' }); const d = await r.json();
      if (d.url) {
        const img = new Image();
        img.onload = () => {
          root.style.setProperty('--bg-image', `url('${sanitizeCssUrl(d.url)}')`);
          root.style.setProperty('--bg-color', '#0d1117');
          root.style.setProperty('--bg-brightness', String(bg.brightness??0.62));
        };
        img.src = d.url;
      }
    }
  } catch {}
}

function refreshBadges() { for (const id of BEL.keys()) bupd(id); }
async function pollBadges() {
  try { const d = await (await fetch('/api/badges',{cache:'no-store'})).json(); for (const [id,v] of Object.entries(d)) bset(id,'activity',v.value||0); _badgeFails=0; if(badgesStale){badgesStale=false;refreshBadges();} }
  catch { if(++_badgeFails>=2 && !badgesStale){badgesStale=true;refreshBadges();} }
}
async function pollHealth() {
  try { const d = await (await fetch('/api/health',{cache:'no-store'})).json(); for (const [id,v] of Object.entries(d)) bset(id,'health',v.unhealthy?1:0); _healthFails=0; if(healthStale){healthStale=false;refreshBadges();} }
  catch { if(++_healthFails>=2 && !healthStale){healthStale=true;refreshBadges();} }
}

function pwStrength(pw) {
  const dim = 'rgba(255,255,255,.1)';
  if (!pw) return { score:0, label:'', color:dim, ok:false };
  if (pw.length < 8) return { score:1, label:'Too short — min 8 characters', color:'#ff453a', ok:false };
  let score = 1;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  score = Math.min(4, score - 1);
  const labels = ['Weak','Fair','Good','Strong'];
  const colors = ['#ff9f0a','#ffd60a','#34c759','#34c759'];
  return { score: score + 1, label: labels[score], color: colors[score], ok: score >= 1 };
}

function showSetupPrompt() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'setup-prompt';
    ov.innerHTML =
      '<div class="setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title">' +
        '<p id="setup-title" class="setup-title">Set a dashboard password?</p>' +
        '<p class="setup-sub">Optional. Without one, anyone who can reach this dashboard can use and configure it. This isn\'t a replacement for a dedicated auth service.</p>' +
        '<input id="setup-pw" type="password" placeholder="New password" aria-label="New password" autocomplete="new-password" class="setup-pw">' +
        '<div id="setup-bars" class="setup-bars"><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span></div>' +
        '<div id="setup-hint" class="setup-hint"></div>' +
        '<div id="setup-err" class="setup-err" role="alert"></div>' +
        '<div class="setup-btns">' +
          '<button id="setup-skip" type="button" class="setup-btn setup-btn-skip">Skip</button>' +
          '<button id="setup-set" type="button" class="setup-btn setup-btn-set" disabled>Set</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    const pw   = ov.querySelector('#setup-pw');
    const bars = ov.querySelectorAll('.pwbar');
    const hint = ov.querySelector('#setup-hint');
    const err  = ov.querySelector('#setup-err');
    const setB = ov.querySelector('#setup-set');
    const skip = ov.querySelector('#setup-skip');
    const dim  = 'rgba(255,255,255,.1)';

    pw.addEventListener('input', () => {
      const { score, label, color, ok } = pwStrength(pw.value);
      bars.forEach((b, i) => { b.style.background = pw.value && i < score ? color : dim; });
      hint.textContent = pw.value ? label : '';
      hint.style.color = color;
      setB.disabled = !ok;
    });

    const close = () => { ov.remove(); resolve(); };

    skip.onclick = async () => {
      skip.disabled = true;
      try { await fetch('/api/auth/dismiss-setup', { method:'POST', headers:{'Content-Type':'application/json'} }); } catch {}
      close();
    };

    async function doSet() {
      if (!pwStrength(pw.value).ok) return;
      setB.disabled = true; skip.disabled = true; err.style.display = 'none';
      try {
        const r = await fetch('/api/auth/set-password', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ password: pw.value }),
        });
        if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || 'Could not set password.');
        location.reload();
      } catch(e) {
        err.textContent = e.message; err.style.display = 'block';
        setB.disabled = false; skip.disabled = false;
      }
    }
    setB.onclick = doSet;
    pw.onkeydown = e => { if (e.key === 'Enter' && !setB.disabled) doSet(); };
    pw.focus();
  });
}

async function boot() {
  let authData = null;
  try {
    const authCheck = await fetch('/api/auth/check', { cache:'no-store' });
    if (authCheck.status === 401) { window.location.href = '/admin/'; return; }
    authData = await authCheck.json();
    if (authData.enabled && !authData.authenticated) { window.location.href = '/admin/'; return; }
  } catch { /* API down — handled below */ }



  let configFailed = false;
  try {
    const res = await fetch('/api/config', { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = await res.json();
    items = c.items||[]; S = c.settings||{};
  } catch(e) { console.error('[boot]', e); configFailed = true; }

  await loadLocalIcons();

  if (configFailed) {
    const msg = document.createElement('div');
    msg.className = 'api-error-screen';
    msg.innerHTML = '<p class="api-error-title">Could not connect to dashboard API</p><p class="api-error-sub">Make sure the API container is running</p><button class="api-error-btn" onclick="location.reload()">Retry</button>';
    document.body.appendChild(msg);
    document.body.classList.add('ready');
    return;
  }

  if (authData && !authData.setupPrompted && !authData.passwordSet) {
    await showSetupPrompt();
  }

  /* Shared state object passed to ui.js and spotlight.js */
  const state = { items, S, CB, BEL, badgeState, breg, bunreg, bupd, folderBadge, paginate, goTo, pg: 0, _mobTsCleanup, _mobTeCleanup };
  _stateRef = state;
  initUI(state);
  initSpotlight({ getItems: () => items, MOB, CB, iconChain, openFolderDesktop, openFolderMobile });

  let _clockTick = null; /* set in desktop branch; used by visibility handler */

  if (MOB) {
    document.body.classList.add('is-mob');
    requestAnimationFrame(() => requestAnimationFrame(() => { buildMobile(); syncMobPages(); }));
  } else {
    _clockTick = buildClock(); buildDesktop();
    document.addEventListener('keydown', e => {
      if (document.getElementById('spot').classList.contains('on')) return;
      if (e.key === 'ArrowRight') goTo(pg+1);
      if (e.key === 'ArrowLeft')  goTo(pg-1);
    });
    /* Desktop mouse drag — swipe pages with mouse */
    let _dMx = 0, _dDragging = false;
    document.addEventListener('mousedown', e => { _dMx = e.clientX; _dDragging = false; });
    document.addEventListener('mousemove', e => { if (Math.abs(e.clientX - _dMx) > 8) _dDragging = true; });
    document.addEventListener('mouseup',   e => {
      if (!_dDragging) return;
      const dx = e.clientX - _dMx;
      if (Math.abs(dx) > 60) goTo(pg + (dx < 0 ? 1 : -1));
      _dDragging = false;
    });
    let _dTx = 0;
    document.addEventListener('touchstart', e => { _dTx = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - _dTx; if (Math.abs(dx) > 50) goTo(pg + (dx < 0 ? 1 : -1)); }, { passive: true });
  }

  applyBg();

  /* Rebuild layout on orientation/resize — MOB is parse-time so only fires on mobile.
     In landscape, switch to desktop layout; in portrait, use mobile layout. */
  let _rt;
  const _rebuild = () => {
    clearTimeout(_rt);
    _rt = setTimeout(() => {
      if (!MOB) return;
      const landscape = innerWidth > innerHeight;
      if (landscape) {
        /* Switch to desktop layout for landscape */
        document.body.classList.remove('is-mob');
        if (!_clockTick) { _clockTick = buildClock(); if (_clockTimer == null) _clockTimer = setInterval(_clockTick, 10_000); }
        _clockTick();
        buildDesktop();
      } else {
        /* Restore mobile layout for portrait */
        document.body.classList.add('is-mob');
        if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; _clockTick = null; }
        if (_mobTmCleanup) document.removeEventListener('touchmove', _mobTmCleanup, { passive: true });
        buildMobile();
        syncMobPages();
      }
    }, 150);
  };
  window.addEventListener('resize', _rebuild, { passive: true });
  window.addEventListener('orientationchange', _rebuild, { passive: true });

  let _badgeTimer, _healthTimer, _clockTimer, _configTimer;

  const startPolling = () => {
    _badgeTimer  = setInterval(pollBadges,  20_000);
    _healthTimer = setInterval(pollHealth,  30_000);
    _clockTimer  = _clockTick ? setInterval(_clockTick, 10_000) : null;
    _configTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/config', { cache:'no-store' });
        if (!res.ok) return;
        const c = await res.json();
        const fp = s => JSON.stringify(s?.items?.map(i=>i.id+'|'+i.label+'|'+i.href)) + JSON.stringify(s?.settings);
        if (fp(c) !== fp({ items, settings: S })) location.reload();
      } catch {}
    }, 15_000);
  };

  const stopPolling = () => {
    clearInterval(_badgeTimer);
    clearInterval(_healthTimer);
    clearInterval(_clockTimer);
    clearInterval(_configTimer);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      if (_clockTick) _clockTick(); /* update clock immediately on resume */
      pollBadges(); pollHealth();
      startPolling();
    }
  });

  pollBadges(); pollHealth(); startPolling();

  document.body.classList.add('ready');
}

boot();
