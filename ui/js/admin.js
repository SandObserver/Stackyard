import { LOCAL_ICONS, loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=36';
import { clr as rc, esc } from '/js/utils.js?v=39';
import { WIDGET_TYPES } from '/js/widget-types.js?v=39';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=5';

/* Admin UI — Stackyard Dashboard */
const API = '';

/* Mobile layout switch. Uses the SAME rule as the dashboard's MOB flag
   (viewport <=768px OR a phone user-agent) so the admin and dashboard always
   agree on when to show the mobile UI. Driven via a class rather than a bare
   media query, because some phones report a wider CSS viewport. */
function _syncMobile(){
  const m = window.matchMedia('(max-width:768px)').matches
    || /iPhone|iPod|Android/i.test(navigator.userAgent);
  document.documentElement.classList.toggle('is-mobile', m);
}
_syncMobile();
window.addEventListener('resize', _syncMobile);
window.addEventListener('orientationchange', _syncMobile);

let items=[],eid=null,saving=false,_settings={},_widgetReg={};
const collapsedFolders=new Set(); /* tracks which folder ids are collapsed */
let ctype='app',siurl='',scol='dark',spaths=[],fnums=[];
let _flt={q:'',type:'all'};

let tt;
const toast=(m,t='ok')=>{const e=document.getElementById('toast');e.textContent=m;
  e.className=`show ${t}`;clearTimeout(tt);tt=setTimeout(()=>e.className='',3000);};

const ag=async p=>{const r=await fetch(API+p,{cache:'no-store'});if(r.status===401){const e=new Error('Unauthorised');e.status=401;throw e;}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();};
const ap=async(p,b)=>{const r=await fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(r.status===401){const e=new Error('Unauthorised');e.status=401;throw e;}if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'HTTP '+r.status);}return r.json();};
const COLLAPSE_KEY='admin_collapsed';
function loadCollapsed(){try{return JSON.parse(localStorage.getItem(COLLAPSE_KEY)||'{}');}catch{return{};}}
function saveCollapsed(s){localStorage.setItem(COLLAPSE_KEY,JSON.stringify(s));}
function initCards(){}

async function checkAuth() {
  try {
    const d = await ag('/api/auth/check');
    if (!d.enabled || d.authenticated) return true;
    showLoginScreen();
    return false;
  } catch(e) {
    /* 401 means auth is enabled and we're not logged in */
    if (e.status === 401) { showLoginScreen(); return false; }
    return true; /* any other error — let load() handle it */
  }
}

function showLoginScreen() {
  const s   = document.getElementById('login-screen');
  const btn = document.getElementById('login-btn');
  const pw  = document.getElementById('login-pw');
  const err = document.getElementById('login-err');
  if (s) s.style.display = 'flex';

  async function doLogin() {
    if (btn) btn.disabled = true;
    if (err) err.style.display = 'none';
    try {
      await ap('/api/auth/login', { password: pw?.value||'' });
      if (s) s.style.display = 'none';
      load();
    } catch(e) {
      if (err) { err.textContent = e.message||'Incorrect password.'; err.style.display = 'block'; }
      if (pw) { pw.value = ''; pw.focus(); }
    } finally { if (btn) btn.disabled = false; }
  }

  if (btn) btn.onclick = doLogin;
  if (pw) { pw.focus(); pw.onkeydown = e => { if (e.key === 'Enter') doLogin(); }; }
}

function pwStrength(pw) {
  const dim = 'rgba(255,255,255,.1)';
  if (!pw) return { score:0, label:'', color:dim, ok:false };
  if (pw.length < 8) return { score:1, label:'Too short, min 8 characters', color:'#ff453a', ok:false };
  let score = 1; /* starts at 1 once length >= 8 */
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  score = Math.min(4, score - 1); /* 1..5 → 0..4 */
  const labels = ['Weak','Fair','Good','Strong'];
  const colors = ['#ff9f0a','#ffd60a','#34c759','#34c759'];
  return { score: score + 1, label: labels[score], color: colors[score], ok: score >= 1 };
}

function wirePasswordStrength(inputId, barsId, hintId) {
  const inp  = document.getElementById(inputId);
  const bars = document.getElementById(barsId)?.querySelectorAll('.pwbar');
  const hint = document.getElementById(hintId);
  if (!inp || !bars?.length) return;
  const dim = 'rgba(255,255,255,.1)';
  inp.addEventListener('input', () => {
    const { score, label, color, ok } = pwStrength(inp.value);
    bars.forEach((b, i) => { b.style.background = inp.value && i < score ? color : dim; });
    if (hint) { hint.textContent = inp.value ? label : ''; hint.style.color = color; }
  });
}

async function load(){
  await loadLocalIcons();
  const c=await ag('/api/config');
  items=c.items||[];
  _settings=c.settings||{};
  /* Folder-style widgets: registry drives their auto-generated config editor. */
  try{ const wr=await ag('/api/widgets'); _widgetReg={}; (wr.widgets||[]).forEach(w=>{ _widgetReg[w.name]=w; }); }catch{ _widgetReg={}; }
  /* All folders start collapsed — user can expand by clicking */
  items.filter(i=>i.type==='folder').forEach(f=>collapsedFolders.add(f.id));
  document.body.classList.add('authed');
  render();
  loadSettings(c);
  applyBg();
}

/* Wallpaper behind the settings panel — mirrors the dashboard's background settings. */
function _sanitizeCssUrl(u){ return String(u||'').replace(/['"\\()]/g,''); }
async function applyBg(){
  const root=document.documentElement;
  try{
    const bg=(_settings&&_settings.background)||{};
    if(bg.type==='color'&&bg.color){
      root.style.setProperty('--bg-image','none');
      root.style.setProperty('--bg-color',String(bg.color).replace(/[^a-zA-Z0-9#(),.\s%]/g,''));
      root.style.setProperty('--bg-brightness','1');
    }else if(bg.type==='url'&&bg.url){
      root.style.setProperty('--bg-image',`url('${_sanitizeCssUrl(bg.url)}')`);
      root.style.setProperty('--bg-color','#0d1117');
      root.style.setProperty('--bg-brightness',String(bg.brightness??0.62));
    }else if(bg.type==='unsplash'){
      const r=await fetch('/api/wallpaper',{cache:'no-store'}); const d=await r.json();
      if(d.url){ const img=new Image(); img.onload=()=>{
        root.style.setProperty('--bg-image',`url('${_sanitizeCssUrl(d.url)}')`);
        root.style.setProperty('--bg-color','#0d1117');
        root.style.setProperty('--bg-brightness',String(bg.brightness??0.62));
      }; img.src=d.url; }
    }
  }catch{}
}
async function save(){
  if(saving)return;saving=true;
  try{const full=await ag('/api/config');full.items=items;await ap('/api/config',full);toast('Saved');}
  catch(e){toast('Save failed: '+e.message,'err');}
  saving=false;render();
}

/* resolveIconFull: admin-only async icon probe for live preview.
   resolveIcon and iconChain are imported from /js/icons.js. */
async function resolveIconFull(raw){
  if(!raw)return '';
  raw=raw.trim();
  if(raw.startsWith('http://')||raw.startsWith('https://'))return raw;
  const filename=raw.split('/').pop();
  const dot=filename.lastIndexOf('.');
  const name=dot>0?filename.slice(0,dot):filename;
  const ext=dot>0?filename.slice(dot+1).toLowerCase():'svg';
  const candidates=[];
  if(LOCAL_ICONS.has(filename))candidates.push(`${ICON_BASE}/${name}.${ext}`);
  candidates.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${name}.svg`);
  candidates.push(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${name}.png`);
  for(const url of candidates){
    try{
      const ok=await new Promise(res=>{const i=new Image();i.onload=()=>res(true);i.onerror=()=>res(false);i.src=url;});
      if(ok)return url;
    }catch{}
  }
  return '';
}

function trapFocus(box){
  const sel='button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  return e=>{
    if(e.key!=='Tab')return;
    const f=[...box.querySelectorAll(sel)];if(!f.length)return;
    const first=f[0],last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  };
}
function moveRow(item,dir,{folderId=null,childIdx=null}={}){
  if(folderId!=null){
    const f=items.find(i=>i.id===folderId);if(!f)return;
    const ch=f.children||[];const j=childIdx+dir;if(j<0||j>=ch.length)return;
    [ch[childIdx],ch[j]]=[ch[j],ch[childIdx]];
  }else{
    const inF=new Set(items.filter(i=>i.type==='folder').flatMap(ff=>ff.children||[]));
    const top=items.filter(it=>it.type==='folder'||!inF.has(it.id));
    const p=top.indexOf(item);const nb=top[p+dir];if(!nb)return;
    const a=items.indexOf(item),b=items.indexOf(nb);
    [items[a],items[b]]=[items[b],items[a]];
  }
  save();
}

function clearDragClasses(target){
  const rows=target?[target]:document.querySelectorAll('.row');
  rows.forEach(r=>{r.classList.remove('drag-above','drag-below','drag-into','drag-over');});
}

function mkRow(item,idx,{indent=false,childIdx=null,folderId=null}={}){
  const row=document.createElement('div');row.className='row drow';
  if(indent)row.style.cssText='padding-left:28px;background:rgba(255,255,255,.02);border-left:2px solid var(--bd);margin-left:8px;border-radius:0 var(--rs) var(--rs) 0;';
  const _filtering=!!(_flt.q||_flt.type!=='all');
  row.draggable=!_filtering;
  let canUp=false,canDown=false;
  if(folderId!=null){
    const cf=items.find(i=>i.id===folderId);const n=(cf?.children||[]).length;
    canUp=childIdx>0;canDown=childIdx<n-1;
  }else{
    const inF=new Set(items.filter(i=>i.type==='folder').flatMap(ff=>ff.children||[]));
    const top=items.filter(it=>it.type==='folder'||!inF.has(it.id));
    const p=top.indexOf(item);canUp=p>0;canDown=p<top.length-1;
  }
  /* Drag handle */
  const handle=document.createElement('div');handle.className='rord';handle.textContent='⠿';
  if(_filtering)handle.style.visibility='hidden';
  /* Icon */
  const ico=document.createElement('div');ico.className='rico';ico.style.background=rc(item.color);
  if(item.iconUrl){
    const img=document.createElement('img');img.alt=item.label||'';
    img.style.cssText='width:28px;height:28px;object-fit:contain;';
    const fbs=iconChain(item.iconUrl);
    if(fbs.length){
      let s=0;img.onerror=()=>{s++;if(s<fbs.length)img.src=fbs[s];else{ico.innerHTML='';ico.textContent=(item.label||'?')[0].toUpperCase();}};
      img.src=fbs[0];ico.appendChild(img);
    }else{ico.innerHTML='';ico.textContent=(item.label||'?')[0].toUpperCase();}
  }else ico.textContent=(item.label||item.id||'?')[0].toUpperCase();
  /* Info */
  const inf=document.createElement('div');inf.className='rinf';
  const nm=document.createElement('div');nm.className='rnm';
  if(item.type==='folder'){
    const collapsed=collapsedFolders.has(item.id);
    nm.style.cssText='display:flex;align-items:center;gap:6px;cursor:pointer;';
    nm.setAttribute('role','button');nm.setAttribute('tabindex','0');
    nm.setAttribute('aria-expanded',String(!collapsed));
    nm.setAttribute('aria-label',(collapsed?'Expand':'Collapse')+' folder '+item.label);
    const chevron=document.createElement('span');
    chevron.style.cssText='font-size:10px;color:var(--dm);transition:transform .15s;flex-shrink:0;';
    chevron.textContent='▼';
    chevron.style.transform=collapsed?'rotate(-90deg)':'rotate(0deg)';
    chevron.id='chev-'+item.id;
    nm.append(chevron,document.createTextNode('📁 '+item.label));
    nm.onclick=e=>{
      e.stopPropagation();
      if(collapsedFolders.has(item.id)){collapsedFolders.delete(item.id);}
      else{collapsedFolders.add(item.id);}
      render();
    };
    nm.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();nm.onclick(e);}};
  }else{
    nm.textContent=item.label||item.id;
  }
  const mt=document.createElement('div');mt.className='rmt';
  if(item.type==='widget'){
    const wt=item.widgetType||'custom';
    const wtLabel=WIDGET_TYPES[wt]?.label||'Custom';
    mt.textContent=`${wtLabel} widget · ${item.widgetSize||'medium'}`;
  }
  else if(item.type==='folder')mt.textContent=`${(item.children||[]).length} apps`;
  else if(item.system==='settings')mt.textContent='Opens settings';
  else mt.textContent=item.href||'';
  inf.append(nm,mt);
  /* Pills */
  const pb=document.createElement('div');pb.className='rpills';
  if(item.dock)pb.innerHTML+='<span class="pill p-dk">Dock</span>';
  if(item.type==='widget')pb.innerHTML+='<span class="pill p-wg">Widget</span>';
  if(item.type==='folder')pb.innerHTML+='<span class="pill p-fl">Folder</span>';
  if(item.monitoring?.healthcheck?.enabled||item.container)pb.innerHTML+='<span class="pill p-hl">Health</span>';
  if(item.monitoring?.activity?.enabled||item.badge?.enabled)pb.innerHTML+='<span class="pill p-bg">Badge</span>';
  if(item.system==='settings')pb.innerHTML+='<span class="pill p-sy">System</span>';
  if(item.hidden)pb.innerHTML+='<span class="pill p-hd">Hidden</span>';
  /* Actions */
  const ac=document.createElement('div');ac.className='ract';
  const mkMove=(dir,can)=>{const b=document.createElement('button');b.className='btn bg sm ic';
    const lbl=dir<0?'Move up':'Move down';b.title=lbl;b.setAttribute('aria-label',lbl+': '+(item.label||item.id||'item'));
    b.textContent=dir<0?'↑':'↓';b.disabled=!can;b.onclick=()=>moveRow(item,dir,{folderId,childIdx});return b;};
  if(!_filtering) ac.append(mkMove(-1,canUp),mkMove(1,canDown));
  if(item.system==='settings'){
    const hb=document.createElement('button');hb.className='btn bg sm';
    hb.textContent=item.hidden?'Show':'Hide';
    const lbl=(item.hidden?'Show':'Hide')+' Settings on dashboard';
    hb.title=lbl;hb.setAttribute('aria-label',lbl);
    hb.onclick=()=>{ item.hidden=!item.hidden; save(); render(); };
    ac.append(hb);
  }else{
    const ed=document.createElement('button');ed.className='btn bg sm';ed.textContent='Edit';ed.onclick=()=>openModal(idx);
    ac.append(ed);
  }
  row.append(handle,ico,inf,pb,ac);
  /* ── Unified drag ──
     Drag data formats:
       "top:itemId"            — top-level item being dragged
       "child:folderId:itemId" — child item being dragged
     Drop targets accept both formats and route accordingly.
  */
  const dragData = indent
    ? 'child:'+folderId+':'+item.id
    : 'top:'+item.id;

  row.addEventListener('dragstart',e=>{
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',dragData);
    /* Slight delay so browser can capture drag image before dimming */
    requestAnimationFrame(()=>row.classList.add('dragging'));
  });
  row.addEventListener('dragend',()=>{
    row.classList.remove('dragging');
    clearDragClasses();
  });
  row.addEventListener('dragover',e=>{
    e.preventDefault();e.dataTransfer.dropEffect='move';
    clearDragClasses();
    if(row.dataset.isFolder){
      row.classList.add('drag-into');
    }else{
      const rect=row.getBoundingClientRect();
      row.classList.add(e.clientY<rect.top+rect.height/2?'drag-above':'drag-below');
    }
  });
  row.addEventListener('dragleave',e=>{
    if(!e.relatedTarget||!row.contains(e.relatedTarget))clearDragClasses(row);
  });

  row.addEventListener('drop',e=>{
    e.preventDefault();
    const dropAbove=row.classList.contains('drag-above');
    clearDragClasses();
    const raw=e.dataTransfer.getData('text/plain');
    if(!raw||raw===dragData)return;

    /* Parse source */
    let srcItem,srcFolder=null,srcFolderObj=null;
    if(raw.startsWith('child:')){
      const[,sfId,sItemId]=raw.split(':');
      srcFolderObj=items.find(i=>i.id===sfId);
      srcItem=items.find(i=>i.id===sItemId);
      srcFolder=sfId;
    }else if(raw.startsWith('top:')){
      srcItem=items.find(i=>i.id===raw.slice(4));
    }
    if(!srcItem)return;

    /* Remove from source location */
    if(srcFolder&&srcFolderObj){
      srcFolderObj.children=(srcFolderObj.children||[]).filter(id=>id!==srcItem.id);
    }else{
      const si=items.indexOf(srcItem);
      if(si>=0)items.splice(si,1);
    }

    /* Insert at target location */
    if(indent){
      /* Drop on a child row → insert into same folder at this position */
      /* Re-find folder after possible items mutation */
      const tf=items.find(i=>i.id===folderId);
      if(!tf){items.push(srcItem);save();return;}
      /* Remove from this folder if already in it (reorder) */
      tf.children=(tf.children||[]).filter(id=>id!==srcItem.id);
      /* If srcItem is not in items yet (was top-level), it's still there */
      if(!items.find(i=>i.id===srcItem.id))items.push(srcItem);
      /* Insert at childIdx position */
      tf.children.splice(childIdx,0,srcItem.id);
    }else if(item.type==='folder'){
      /* Drop ON a folder row → add to end of that folder */
      if(!items.find(i=>i.id===srcItem.id))items.push(srcItem);
      const tf=items.find(i=>i.id===item.id);
      if(tf){tf.children=(tf.children||[]).filter(id=>id!==srcItem.id);tf.children.push(srcItem.id);}
    }else{
      /* Drop on a top-level row → insert before it, remove from any folder */
      items.filter(f=>f.type==='folder').forEach(f=>{
        f.children=(f.children||[]).filter(id=>id!==srcItem.id);
      });
      if(!items.find(i=>i.id===srcItem.id))items.push(srcItem);
      /* Remove srcItem from its current position */
      const si2=items.indexOf(srcItem);
      if(si2>=0)items.splice(si2,1);
      /* Insert above or below target based on mouse position */
      const ti2=items.indexOf(item);
      const insertAt=dropAbove?ti2:ti2+1;
      items.splice(Math.max(0,insertAt),0,srcItem);
    }
    save();
  });
  return row;
}

function render(){
  const l=document.getElementById('al');
  const bar=document.getElementById('al-filter');
  const grp=document.getElementById('al-grp');
  if(bar){
    if(items.length>=6) bar.style.display='';
    else { bar.style.display='none'; if(_flt.q||_flt.type!=='all'){_flt={q:'',type:'all'};_syncFilterUI();} }
  }
  if(grp) grp.style.display=items.length?'':'none';
  if(!items.length){
    l.innerHTML='<div class="empty"><p class="empty-msg">No apps yet. Click +Add.</p></div>';
    return;
  }
  l.innerHTML='';
  if(_flt.q||_flt.type!=='all'){
    const q=_flt.q.toLowerCase();
    const matches=items.filter(it=>{
      if(_flt.type!=='all'&&it.type!==_flt.type)return false;
      if(q){ const hay=((it.label||'')+' '+(it.href||'')+' '+(it.widgetType||'')).toLowerCase(); if(!hay.includes(q))return false; }
      return true;
    });
    if(!matches.length){ l.innerHTML='<div class="empty"><p class="empty-msg">No matches.</p></div>'; return; }
    matches.forEach(item=>l.appendChild(mkRow(item,items.indexOf(item))));
    return;
  }
  const inFolder=new Set(items.filter(i=>i.type==='folder').flatMap(f=>f.children||[]));
  items.forEach((item,idx)=>{
    if(item.type!=='folder'&&inFolder.has(item.id))return;
    l.appendChild(mkRow(item,idx));
    if(item.type==='folder'&&!collapsedFolders.has(item.id)){
      (item.children||[]).forEach((childId,ci)=>{
        const childItem=items.find(i=>i.id===childId);
        if(!childItem)return;
        l.appendChild(mkRow(childItem,items.indexOf(childItem),{indent:true,childIdx:ci,folderId:item.id}));
      });
      const addRow=document.createElement('button');addRow.type='button';addRow.className='fp-add';
      addRow.innerHTML='<span>+</span> Add app to this folder';
      addRow.onclick=()=>openFolderPicker(null,item.id);
      l.appendChild(addRow);
    }
  });
}
function _syncFilterUI(){
  const s=document.getElementById('al-search'); if(s)s.value=_flt.q;
  document.querySelectorAll('#al-filter .chip').forEach(c=>{
    const on=c.dataset.flt===_flt.type; c.classList.toggle('on',on); c.setAttribute('aria-pressed',String(on));
  });
}

/* ══ MODAL ══ */
/* Associate dynamically-built modal fields with their labels and give every
   toggle an accessible name from its row text. Idempotent; safe to re-run. */
/* ══ Push navigation: replace modal with in-pane edit view ══ */
function showListView(){
  document.getElementById('dash-list-view').style.display='';
  document.getElementById('dash-edit-view').style.display='none';
}
function showEditView(){
  document.getElementById('dash-list-view').style.display='none';
  document.getElementById('dash-edit-view').style.display='';
  document.getElementById('cp')?.scrollTo?.(0,0);
  document.querySelector('.cp')?.scrollTo?.(0,0);
}

/* Item-type glyphs traced from the PSD (24x24, currentColor). */
const TYPE_ICONS={
  app:'<rect x="7" y="7" width="10" height="10" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  widget:'<rect x="3.5" y="6.5" width="17" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7.2" cy="10.2" r="1.5" fill="currentColor"/><line x1="5.6" y1="13.4" x2="17.4" y2="13.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5.6" y1="15.2" x2="17.4" y2="15.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  folder:'<rect x="6" y="6" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9.7" cy="9.7" r="1.25" fill="currentColor"/><circle cx="14.3" cy="9.7" r="1.25" fill="currentColor"/><circle cx="9.7" cy="14.3" r="1.25" fill="currentColor"/><circle cx="14.3" cy="14.3" r="1.25" fill="currentColor"/>'
};
const TYPE_LABELS={app:'App',widget:'Widget',folder:'Folder'};

/* Widget size glyphs (content-cards of increasing aspect/line-count), traced from the PSD. */
const SIZE_ICONS={
  small:'<rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="9.7" r="1" fill="currentColor"/><line x1="9" y1="13.4" x2="13" y2="13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  medium:'<rect x="4" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor"/><line x1="10.2" y1="11.4" x2="16.5" y2="11.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="7" y1="14.3" x2="16.5" y2="14.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  large:'<rect x="6" y="5.5" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><line x1="8" y1="12.6" x2="16" y2="12.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="14.8" x2="16" y2="14.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  xlarge:'<rect x="7" y="3.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="7" r="1.1" fill="currentColor"/><line x1="9" y1="10.5" x2="15" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="12.7" x2="15" y2="12.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="14.9" x2="15" y2="14.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="17.1" x2="13" y2="17.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

/* Edit (square-pen) and select (up/down) glyphs traced from the PSD. */
const PE_SVG='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a1.85 1.85 0 0 1 2.6 2.6l-9.1 9.1-3.4 1 1-3.4z"/></svg>';
const CHEV_SVG='<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

let _evItem=null,_evIsEdit=false;

/* Add New type selector — single card row, label left, three PSD tiles right. */
function buildAddNewCard(){
  const grp=document.createElement('div');
  grp.className='grp';
  const row=document.createElement('div');
  row.className='row tile-row';
  row.innerHTML='<span class="rl">Add New</span>';
  const grpTiles=document.createElement('div');
  grpTiles.className='tile-grp';
  ['app','widget','folder'].forEach(t=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='tile-opt'+(t===ctype?' on':'');
    b.dataset.ctype=t;
    b.setAttribute('aria-pressed',String(t===ctype));
    b.setAttribute('aria-label','Add '+TYPE_LABELS[t]);
    b.innerHTML=`<span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICONS[t]}</svg></span><span class="tile-cap">${TYPE_LABELS[t]}</span>`;
    b.onclick=()=>{ if(ctype===t)return; ctype=t; _renderEditBody(); };
    grpTiles.appendChild(b);
  });
  row.appendChild(grpTiles);
  grp.appendChild(row);
  return grp;
}

/* Render the push edit body: builder fills #ev-body, then the Add New card
   is prepended (add-mode only) so it survives the builders' innerHTML reset. */
function _renderEditBody(){
  const body=document.getElementById('ev-body');
  body.innerHTML='';
  if(ctype==='widget') buildWidgetForm(body,_evItem);
  else if(ctype==='folder') buildFolderForm(body,_evItem);
  else buildAppForm(body,_evItem);
  if(!_evIsEdit) body.insertBefore(buildAddNewCard(),body.firstChild);
  setTimeout(()=>{ try{ body.querySelector('input,select,textarea')?.focus(); }catch{} },50);
}

function openModal(idx){
  eid=idx??null;
  const item=idx!=null?JSON.parse(JSON.stringify(items[idx])):null;
  ctype=item?.type||'app';
  siurl=item?.iconUrl||'';
  scol=item?.color||'dark';
  _customUrl=item?.url||'';
  _iframeOpts=item?.iframe?{...item.iframe}:{};
  fnums=[];spaths=[];
  if(item?.monitoring?.activity?.extract){
    const ex=Array.isArray(item.monitoring.activity.extract)?item.monitoring.activity.extract:[item.monitoring.activity.extract];
    spaths=ex.map(e=>typeof e==='string'?e:e.path).filter(Boolean);
  }else if(item?.badge?.extract){
    const ex=Array.isArray(item.badge.extract)?item.badge.extract:[item.badge.extract];
    spaths=ex.map(e=>typeof e==='string'?e:e.path).filter(Boolean);
  }

  /* Header */
  const isEdit=idx!=null;
  document.getElementById('ev-title').textContent='General';
  const delBtn=document.getElementById('ev-delete');
  const saveBtn=document.getElementById('ev-save');
  if(delBtn){ delBtn.classList.toggle('d-none',!isEdit); delBtn.onclick=()=>_evDelete(item,idx); }
  if(saveBtn){ saveBtn.onclick=()=>doSave(item); }
  const backBtn=document.getElementById('ev-back');
  if(backBtn) backBtn.onclick=()=>closeModal();

  /* Body — Add New selector card renders inside (add-mode only) */
  _evItem=item; _evIsEdit=isEdit;
  _renderEditBody();

  showEditView();
}

function _evDelete(item,idx){
  if(!item)return;
  if(item.type==='folder'){if(!confirm(`Delete folder "${item.label}"? Apps inside will not be deleted.`))return;}
  else{if(!confirm(`Remove "${item.label||item.id}"?`))return;}
  items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==item.id);});
  items.splice(idx,1);
  save().catch(()=>{});
  showListView();
}
/* ══ al-filter wiring ══ */
{
  const s=document.getElementById('al-search');
  if(s)s.addEventListener('input',()=>{_flt.q=s.value.trim();render();});
  document.querySelectorAll('#al-filter .chip').forEach(c=>{
    c.addEventListener('click',()=>{_flt.type=c.dataset.flt;_syncFilterUI();render();});
  });
}

/* ══ Export/Import ══ */
document.getElementById('btn-exp').onclick=async()=>{
  try{
    const a=document.createElement('a');
    a.href=API+'/api/config/export';
    a.download='stackyard-config.json';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
  }catch(e){toast('Export failed: '+e.message,'err');}
};
document.getElementById('imp').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const d=JSON.parse(await f.text());if(!d.items)throw new Error('Invalid');
    items=d.items;await save();toast('Imported');}
  catch(e){toast('Import failed: '+e.message,'err');}
  e.target.value='';
};

document.getElementById('btn-add').onclick=()=>openModal(null);
function closeModal(){
  showListView();
  eid=null;
  _wtype='custom';_wsize='medium';_wslots=[];_wnet={enabled:false,url:'',provider:'myspeed'};
  _wmapCfg={};_wconnView='map';_wvpnCfg={};_customUrl='';_wlabel='';_wgithubCfg={};_wclockCfg={};_wbackupCfg={};_wstatsSubType='system-summary';_wdiskCfg={diskProvider:'scrutiny',scrutinyUrl:'',scrutinyHref:'',truenasUrl:'',truenasKeySet:false,truenasHref:'',bays:[]};_iframeOpts={};_wweatherCfg={city:'',lat:'',lon:'',units:'c',href:''};
}



/* Allowed sizes come from the widget registry (folder-driven). 'custom' is the only built-in type. */
const CUSTOM_SIZES = ['small','medium','large','xlarge'];
function widgetSizes(type){ return type==='custom' ? CUSTOM_SIZES : (_widgetReg[type]?.sizes || ['medium']); }
const SIZE_LABELS = { small:'Small', medium:'Medium', large:'Large', xlarge:'Extra Large' };
const STAT_TYPES  = ['cpu','ram','temp','disk'];
const STAT_LABELS = { cpu:'CPU', ram:'RAM', temp:'Temp', disk:'Disk' };

/* State for current widget config while modal is open */
let _wtype='custom', _wsize='medium', _wslots=[], _wnet={enabled:false,url:'',provider:'myspeed'}, _wmapCfg={}, _wconnView='map', _wvpnCfg={}, _customUrl='', _wlabel='', _wgithubCfg={}, _wclockCfg={}, _wbackupCfg={}, _wstatsSubType='system-summary', _wdiskCfg={diskProvider:'scrutiny',scrutinyUrl:'',scrutinyHref:'',truenasUrl:'',truenasKeySet:false,truenasHref:'',bays:[]}, _iframeOpts={}, _wweatherCfg={city:'',lat:'',lon:'',units:'c',href:''};
/* Auto-generated config form (folder-style widgets driven by the registry). */
let _wAutoCfg={}, _autoForm=null, _autoFormType=null;

function buildWidgetForm(body,item){
  const wt0 = item?.widgetType || 'custom';
  const wt = (wt0==='map') ? 'connections' : wt0;  /* legacy map widgets migrate to connections */
  const ws = item?.widgetSize || 'medium';
  const wc = item?.widgetConfig || {};
  _wtype = wt; _wsize = ws;
  _wlabel = item?.label || '';
  /* Snapshot of stored config for the auto-generated editor (registry widgets). */
  _wAutoCfg = Object.assign({}, wc);
  /* Restore slots */
  _wslots = (wc.slots || [{type:'cpu'},{type:'ram'},{type:'disk',primary:'/',secondary:''}]);
  while(_wslots.length < 3) _wslots.push({type:'cpu'});
  _wstatsSubType = wc.widgetSubType || 'system-summary';
  _wweatherCfg = {
    city:  wc.city  || '',
    lat:   wc.lat   != null ? wc.lat : '',
    lon:   wc.lon   != null ? wc.lon : '',
    units: wc.units === 'f' ? 'f' : 'c',
    feelsLike: wc.feelsLike === true,
    href:  wc.href  || '',
  };
  if (_wstatsSubType === 'disk-health') {
    _wdiskCfg = {
      diskProvider: wc.diskProvider || 'scrutiny',
      scrutinyUrl:  wc.scrutinyUrl  || '',
      scrutinyHref: wc.scrutinyHref || '',
      truenasUrl:   wc.truenasUrl   || '',
      truenasKeySet: !!wc.truenasKeySet,
      truenasHref:  wc.truenasHref  || '',
      bays:         Array.isArray(wc.bays) ? [...wc.bays] : [],
    };
  }
  _wnet = wc.network ? {
    enabled:  wc.network.enabled  || false,
    url:      wc.network.url      || '',
    provider: wc.network.provider || 'myspeed',
    myspeedPassSet: wc.network.myspeedPassSet || false,
  } : {enabled:false,url:'',provider:'myspeed'};
  _wmapCfg = {
    showLegend: wc.showLegend !== false,
    services: Array.isArray(wc.services) ? wc.services.map(s=>Object.assign({id:_newSvcId(),type:'gluetun',name:'',url:'',adminUrl:'',color:'',token:'',enabled:true}, s)) : (function(){
      const a=[];
      if(wc.conduit && (wc.conduit.url||wc.conduit.enabled)) a.push({id:_newSvcId(),type:'conduit',name:wc.conduit.name||'Conduit',url:wc.conduit.url||'',adminUrl:wc.conduit.adminUrl||'',color:wc.conduit.color||'#AF52DE',token:'',enabled:wc.conduit.enabled!==false});
      if(wc.gluetun && (wc.gluetun.url||wc.gluetun.enabled)) a.push({id:_newSvcId(),type:'gluetun',name:wc.gluetun.name||'Gluetun',url:wc.gluetun.url||'',adminUrl:wc.gluetun.adminUrl||'',color:wc.gluetun.color||'#30D158',token:'',enabled:wc.gluetun.enabled!==false});
      return a;
    })(),
  };
  /* Connections widget: which view, and the VPN-view config (single tunnel). */
  _wconnView = wc.view || 'map';
  _wvpnCfg = {
    service:   wc.vpn?.service   || 'gluetun',   /* gluetun | netbird */
    url:       wc.vpn?.url        || '',
    apiKeySet: wc.vpn?.apiKeySet  || false,       /* gluetun control-server API key (optional) */
    user:      wc.vpn?.user       || '',          /* gluetun basic-auth user (optional) */
    passSet:   wc.vpn?.passSet    || false,
    tokenSet:  wc.vpn?.tokenSet   || false,        /* netbird PAT */
    name:      wc.vpn?.name       || '',
    href:      wc.vpn?.href       || '',
    color:     wc.vpn?.color      || '#30D158',
  };
  _wbackupCfg = {
    /* Per-slot useDefault: first instance of a provider is its default; later
       instances use that default unless turned off (then they get their own container). */
    slots: _normBackupSlots(wc.slots, _wsize),
  };
  _renderWidgetForm(body);
}

function _renderWidgetForm(body){
  /* Re-render of the same registry widget (e.g. size change): keep typed values. */
  if(_autoForm && _autoFormType===_wtype){ _wAutoCfg=Object.assign({}, _wAutoCfg, _autoForm.getValues()); }
  _autoForm=null;
  body.innerHTML='';

  /* ── Shell: Name + Widget Type, then Size tiles (settings-row, PSD) ── */
  const typeList=[...Object.values(_widgetReg).map(w=>[w.name,w.label]), ['custom','Custom']].sort((a,b)=>a[1].localeCompare(b[1]));
  const typeOpts=typeList.map(([t,label])=>`<option value="${t}"${t===_wtype?' selected':''}>${esc(label)}</option>`).join('');
  const shell=document.createElement('div'); shell.className='grp';
  shell.innerHTML=`
    <div class="row ie-row" id="ie-wname"><span class="rl">Name</span><span class="rv${_wlabel?'':' is-ph'}">${_wlabel?esc(_wlabel):'My Widget'}</span><input id="f-wlabel" type="text" value="${esc(_wlabel)}" style="display:none"><button class="pe" type="button" aria-label="Edit name">${PE_SVG}</button></div>
    <div class="row"><span class="rl">Widget Type</span><div class="sel-wrap"><select id="f-wtype" class="row-sel" aria-label="Widget type">${typeOpts}</select>${CHEV_SVG}</div></div>`;
  body.appendChild(shell);
  initInlineEdit('ie-wname','f-wlabel',{placeholder:'My Widget',onCommit(v){_wlabel=v;}});
  const typeSel=shell.querySelector('#f-wtype');
  typeSel.onchange=()=>{ _wtype=typeSel.value; _wsize=widgetSizes(_wtype)[0]; _renderWidgetForm(body); };

  /* Connections view (Map / VPN) as a radio group */
  if(_wtype==='connections'){
    const vcard=document.createElement('div'); vcard.className='grp';
    vcard.innerHTML=`<div class="row"><span class="rl">View</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="wconn-view" value="map" ${_wconnView==='map'?'checked':''}><span class="segr-dot"></span><span>Map</span></label>
      <label class="segr-opt"><input type="radio" name="wconn-view" value="vpn" ${_wconnView==='vpn'?'checked':''}><span class="segr-dot"></span><span>VPN</span></label>
    </div></div>`;
    body.appendChild(vcard);
    vcard.querySelectorAll('input[name="wconn-view"]').forEach(r=>r.addEventListener('change',()=>{ _wconnView=r.value; if(r.value==='map')_wsize='medium'; _renderWidgetForm(body); }));
  }

  /* Size tiles */
  const _ghContrib=(_wtype==='github'&&(_wAutoCfg.githubView||'prs')==='contributions');
  let _sizeOpts=widgetSizes(_wtype).filter(s=>!(_ghContrib&&(s==='large'||s==='xlarge')));
  if(_wtype==='connections') _sizeOpts = (_wconnView==='map') ? ['medium'] : ['small','medium'];
  if(!_sizeOpts.includes(_wsize)) _wsize=_sizeOpts.includes('medium')?'medium':_sizeOpts[0];
  const sizeHdr=document.createElement('p'); sizeHdr.className='grp-hdr'; sizeHdr.textContent='Size'; body.appendChild(sizeHdr);
  const scard=document.createElement('div'); scard.className='grp';
  scard.innerHTML=`<div class="row tile-row"><div class="tile-grp tile-grp-left">${_sizeOpts.map(s=>`<button type="button" class="tile-opt${s===_wsize?' on':''}" data-size="${s}"><span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${SIZE_ICONS[s]||SIZE_ICONS.medium}</svg></span><span class="tile-cap">${SIZE_LABELS[s]}</span></button>`).join('')}</div></div>`;
  body.appendChild(scard);
  scard.querySelectorAll('.tile-opt').forEach(b=>b.addEventListener('click',()=>{ _wsize=b.dataset.size; if(_wtype==='backup'){_wbackupCfg.slots=_normBackupSlots(_wbackupCfg.slots,_wsize);} _renderWidgetForm(body); }));

    const cfgDiv=document.createElement('div');cfgDiv.className='div';body.appendChild(cfgDiv);
  if(_widgetReg[_wtype] && !_widgetReg[_wtype].customEditor){
    const d=document.createElement('div'); body.appendChild(d);
    const _wid=(eid!==null&&items[eid]&&items[eid].id)?items[eid].id:null;
    _autoForm=renderWidgetConfigForm(d, _widgetReg[_wtype].fields||[], _wAutoCfg, { widgetId:_wid, widgetType:_wtype });
    _autoFormType=_wtype;
  }
  else if(_wtype==='stats')        _renderStatsConfig(body);
  else if(_wtype==='connections') _renderConnectionsConfig(body);
  else if(_wtype==='backup'){ const d=document.createElement('div');d.id='bak-cfg-body';body.appendChild(d);_renderBackupConfig(d); }
  else if(_wtype==='weather')     _renderWeatherConfig(body);
  else                        _renderCustomConfig(body);
}

function _renderWeatherConfig(body){
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  card.innerHTML=`
    <div class="row"><span class="rl">City</span><input id="wx-city" class="icon-srch" type="text" placeholder="e.g. Ottawa" value="${esc(_wweatherCfg.city||'')}"></div>
    <div class="row" id="wx-match-row" hidden><span class="rl">Match</span><div class="sel-wrap"><select class="row-sel" id="wx-result" aria-label="Match"></select>${CHEV_SVG}</div></div>
    <div class="row"><span class="rl"></span><span class="row-status" id="wx-msg"></span><button type="button" class="row-btn" id="wx-search">Search</button></div>
    <div class="row"><span class="rl">Units</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="wx-units" value="c" ${(_wweatherCfg.units||'c')==='c'?'checked':''}><span class="segr-dot"></span><span>&deg;C</span></label>
      <label class="segr-opt"><input type="radio" name="wx-units" value="f" ${_wweatherCfg.units==='f'?'checked':''}><span class="segr-dot"></span><span>&deg;F</span></label>
    </div></div>
    <div class="row"><span class="rl">Temperature</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="wx-feels" value="actual" ${!_wweatherCfg.feelsLike?'checked':''}><span class="segr-dot"></span><span>Actual</span></label>
      <label class="segr-opt"><input type="radio" name="wx-feels" value="feels" ${_wweatherCfg.feelsLike?'checked':''}><span class="segr-dot"></span><span>Feels like</span></label>
    </div></div>
    <div class="row ie-row" id="wx-href-row"><span class="rl">Link URL <span class="opt-span">(optional)</span></span><span class="rv${_wweatherCfg.href?'':' is-ph'}">${_wweatherCfg.href?esc(_wweatherCfg.href):'https://...'}</span><input id="wx-href" type="text" value="${esc(_wweatherCfg.href||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit link URL">${PE_SVG}</button></div>`;
  const msg=card.querySelector('#wx-msg'), matchRow=card.querySelector('#wx-match-row'), resultSel=card.querySelector('#wx-result');
  if(_wweatherCfg.lat!==''&&_wweatherCfg.lat!=null){ msg.textContent='Current: '+(_wweatherCfg.city||(_wweatherCfg.lat+', '+_wweatherCfg.lon)); msg.className='row-status ok'; }
  card.querySelectorAll('input[name="wx-units"]').forEach(r=>r.addEventListener('change',()=>{ if(r.checked)_wweatherCfg.units=r.value; }));
  card.querySelectorAll('input[name="wx-feels"]').forEach(r=>r.addEventListener('change',()=>{ if(r.checked)_wweatherCfg.feelsLike=(r.value==='feels'); }));
  resultSel.onchange=()=>{ const o=resultSel.selectedOptions[0]; if(!o||!o.value)return; const pp=JSON.parse(o.value); _wweatherCfg.city=pp.label;_wweatherCfg.lat=pp.lat;_wweatherCfg.lon=pp.lon; msg.textContent='Selected: '+pp.label; msg.className='row-status ok'; };
  initInlineEdit('wx-href-row','wx-href',{placeholder:'https://...',onCommit(v){_wweatherCfg.href=v;}});
  async function doSearch(){
    const q=card.querySelector('#wx-city').value.trim();
    if(!q){ msg.textContent='Enter a city name.'; msg.className='row-status err'; return; }
    const btn=card.querySelector('#wx-search'); btn.disabled=true; btn.textContent='...'; msg.textContent=''; msg.className='row-status';
    try{
      const r=await fetch(`/api/geocode-proxy?q=${encodeURIComponent(q)}`);
      const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
      const results=d.results||[];
      if(!results.length){ msg.textContent='No matches found.'; msg.className='row-status err'; matchRow.hidden=true; return; }
      resultSel.innerHTML='';
      results.forEach(pp=>{ const label=[pp.name,pp.admin1,pp.country].filter(Boolean).join(', '); const opt=document.createElement('option'); opt.value=JSON.stringify({label,lat:pp.lat,lon:pp.lon}); opt.textContent=label; resultSel.appendChild(opt); });
      matchRow.hidden=false;
      const f=JSON.parse(resultSel.value); _wweatherCfg.city=f.label; _wweatherCfg.lat=f.lat; _wweatherCfg.lon=f.lon;
      msg.textContent=results.length+' match(es), pick one'; msg.className='row-status ok';
    }catch(e){ msg.textContent='Search failed: '+e.message; msg.className='row-status err'; }
    finally{ btn.disabled=false; btn.textContent='Search'; }
  }
  card.querySelector('#wx-search').onclick=doSearch;
}

function _renderStatsConfig(body){
  /* ── Type: System Summary | Disk Health (radio) ── */
  const subRow=document.createElement('div'); subRow.className='grp';
  subRow.innerHTML=`<div class="row"><span class="rl">Type</span><div class="segr">
    <label class="segr-opt"><input type="radio" name="stats-sub" value="disk-health" ${_wstatsSubType==='disk-health'?'checked':''}><span class="segr-dot"></span><span>Disk Health</span></label>
    <label class="segr-opt"><input type="radio" name="stats-sub" value="system-summary" ${_wstatsSubType==='system-summary'?'checked':''}><span class="segr-dot"></span><span>System Summary</span></label>
  </div></div>`;
  body.appendChild(subRow);
  subRow.querySelectorAll('input[name="stats-sub"]').forEach(r=>r.addEventListener('change',()=>{
    if(!r.checked)return;
    _wstatsSubType=r.value;
    const cfg=body.querySelector('#stats-cfg-body');
    if(cfg){cfg.innerHTML='';_renderStatsBody(cfg);}
  }));

  const cfgBody=document.createElement('div');cfgBody.id='stats-cfg-body';body.appendChild(cfgBody);
  _renderStatsBody(cfgBody);
}

function _renderStatsBody(body){
  if(_wstatsSubType==='disk-health'){
    const bayCount = _wsize==='medium' ? 10 : 4;
    while(_wdiskCfg.bays.length < bayCount) _wdiskCfg.bays.push(null);
    _wdiskCfg.bays = _wdiskCfg.bays.slice(0, bayCount);

    const prov0=_wdiskCfg.diskProvider||'scrutiny';
    const srcCard=document.createElement('div'); srcCard.className='grp'; body.appendChild(srcCard);
    const provRow=document.createElement('div'); provRow.className='row';
    provRow.innerHTML=`<span class="rl">Source</span><div class="sel-wrap"><select class="row-sel" id="dh-prov" aria-label="Source"><option value="scrutiny"${prov0==='scrutiny'?' selected':''}>Scrutiny</option><option value="truenas"${prov0==='truenas'?' selected':''}>TrueNAS</option></select>${CHEV_SVG}</div>`;
    srcCard.appendChild(provRow);
    const provSel=provRow.querySelector('#dh-prov');
    const fieldArea=document.createElement('div'); srcCard.appendChild(fieldArea);

    let _items=[]; let dhStatus=null;

    const bayHdr=document.createElement('p'); bayHdr.className='grp-hdr'; bayHdr.textContent=`Bays (${bayCount})`; body.appendChild(bayHdr);
    const bayCard=document.createElement('div'); bayCard.className='grp'; body.appendChild(bayCard);

    function fmtCap(c){ return c?(c>=1e12?(c/1e12).toFixed(1)+' TB':(c/1e9).toFixed(0)+' GB'):''; }
    function renderBayRows(){
      bayCard.innerHTML='';
      for(let i=0;i<bayCount;i++){
        const cur=_wdiskCfg.bays[i]||'';
        let opts='<option value="">Empty</option>';
        _items.forEach(it=>{ const cap=fmtCap(it.capacity); opts+=`<option value="${esc(it.value)}"${it.value===cur?' selected':''}>${esc(it.label)}${cap?' - '+cap:''}</option>`; });
        if(cur && !_items.some(it=>it.value===cur)) opts+=`<option value="${esc(cur)}" selected>${esc(cur)}</option>`;
        const row=document.createElement('div'); row.className='row';
        row.innerHTML=`<span class="rl">Bay ${i+1}</span><div class="sel-wrap"><select class="row-sel" id="dh-bay-${i}" aria-label="Bay ${i+1}">${opts}</select>${CHEV_SVG}</div>`;
        const sel=row.querySelector('select'); sel.value=cur;
        sel.onchange=()=>{ _wdiskCfg.bays[i]=sel.value||null; };
        bayCard.appendChild(row);
      }
    }

    async function loadScrutiny(btn){
      const url=document.getElementById('dh-url')?.value?.trim();
      if(!url){ if(dhStatus){dhStatus.textContent='Enter a Scrutiny URL first.';dhStatus.className='row-status err';} return; }
      _wdiskCfg.scrutinyUrl=url;
      btn.disabled=true; btn.textContent='Fetching...'; if(dhStatus){dhStatus.textContent='';dhStatus.className='row-status';}
      try{
        const r=await fetch(`/api/scrutiny-proxy?url=${encodeURIComponent(url)}`);
        if(!r.ok) throw new Error('HTTP '+r.status);
        const d=await r.json();
        _items=(d.devices||[]).map(dev=>({value:dev.device_id,label:(dev.model_name||dev.device_name),capacity:dev.capacity}));
        if(dhStatus){ dhStatus.textContent=_items.length?(_items.length+' drive(s) found'):'No SMART drives found'; dhStatus.className='row-status '+(_items.length?'ok':'err'); }
        renderBayRows();
      }catch(e){ if(dhStatus){dhStatus.textContent='Failed to reach Scrutiny: '+e.message;dhStatus.className='row-status err';} }
      finally{ btn.disabled=false; btn.textContent='Fetch Drives'; }
    }
    async function loadTrueNas(btn){
      const url=document.getElementById('dh-url')?.value?.trim();
      const key=document.getElementById('dh-key')?.value?.trim()||(_wdiskCfg.truenasKeySet?'__keep__':'');
      if(!url){ if(dhStatus){dhStatus.textContent='Enter a TrueNAS URL first.';dhStatus.className='row-status err';} return; }
      if(!key){ if(dhStatus){dhStatus.textContent='Enter an API key first.';dhStatus.className='row-status err';} return; }
      _wdiskCfg.truenasUrl=url;
      btn.disabled=true; btn.textContent='Fetching...'; if(dhStatus){dhStatus.textContent='';dhStatus.className='row-status';}
      try{
        if(key==='__keep__'){ if(dhStatus){dhStatus.textContent='Re-enter the API key to fetch pools.';dhStatus.className='row-status err';} return; }
        const r=await fetch(`/api/truenas-proxy?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`);
        const d=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
        _items=(d.pools||[]).map(pl=>({value:pl.name,label:pl.name+(pl.healthy?'':' (unhealthy)'),capacity:pl.capacity}));
        if(dhStatus){ dhStatus.textContent=_items.length?(_items.length+' pool(s) found'):'No pools found'; dhStatus.className='row-status '+(_items.length?'ok':'err'); }
        renderBayRows();
      }catch(e){ if(dhStatus){dhStatus.textContent='Failed to reach TrueNAS: '+e.message;dhStatus.className='row-status err';} }
      finally{ btn.disabled=false; btn.textContent='Fetch Pools'; }
    }

    function renderFields(){
      const prov=_wdiskCfg.diskProvider; _items=[]; fieldArea.innerHTML='';
      const isTn=prov==='truenas';
      const urlVal=isTn?(_wdiskCfg.truenasUrl||''):(_wdiskCfg.scrutinyUrl||'');
      const urlPh=isTn?'truenas:443':'scrutiny:8080';
      const hrefVal=isTn?(_wdiskCfg.truenasHref||''):(_wdiskCfg.scrutinyHref||'');
      const hrefPh=isTn?'https://truenas/ui/storage':'https://your-server:8080';
      fieldArea.insertAdjacentHTML('beforeend', `<div class="row ie-row" id="dh-url-row"><span class="rl">${isTn?'TrueNAS':'Scrutiny'} URL</span><span class="rv${urlVal?'':' is-ph'}">${urlVal?esc(urlVal):esc(urlPh)}</span><input id="dh-url" type="text" value="${esc(urlVal)}" style="display:none"><button class="pe" type="button" aria-label="Edit URL">${PE_SVG}</button></div>`);
      if(isTn) _secretRow(fieldArea,{rowId:'dh-key-row',inpId:'dh-key',label:'API Key',isSet:_wdiskCfg.truenasKeySet});
      const fr=document.createElement('div'); fr.className='row'; fr.innerHTML='<span class="rl"></span>';
      dhStatus=document.createElement('span'); dhStatus.className='row-status'; dhStatus.id='dh-msg'; fr.appendChild(dhStatus);
      const fbtn=document.createElement('button'); fbtn.type='button'; fbtn.className='row-btn'; fbtn.id='dh-load'; fbtn.textContent=isTn?'Fetch Pools':'Fetch Drives'; fr.appendChild(fbtn);
      fieldArea.appendChild(fr);
      fbtn.onclick=()=> isTn?loadTrueNas(fbtn):loadScrutiny(fbtn);
      fieldArea.insertAdjacentHTML('beforeend', `<div class="row ie-row" id="dh-href-row"><span class="rl">Link URL <span class="opt-span">(optional)</span></span><span class="rv${hrefVal?'':' is-ph'}">${hrefVal?esc(hrefVal):esc(hrefPh)}</span><input id="dh-href" type="text" value="${esc(hrefVal)}" style="display:none"><button class="pe" type="button" aria-label="Edit link URL">${PE_SVG}</button></div>`);
      initInlineEdit('dh-url-row','dh-url',{placeholder:urlPh,onCommit(v){ if(_wdiskCfg.diskProvider==='truenas')_wdiskCfg.truenasUrl=v; else _wdiskCfg.scrutinyUrl=v; }});
      initInlineEdit('dh-href-row','dh-href',{placeholder:hrefPh,onCommit(v){ if(_wdiskCfg.diskProvider==='truenas')_wdiskCfg.truenasHref=v; else _wdiskCfg.scrutinyHref=v; }});
      renderBayRows();
    }

    provSel.onchange=()=>{ _wdiskCfg.diskProvider=provSel.value; renderFields(); };
    renderFields();
    if(_wdiskCfg.diskProvider!=='truenas' && _wdiskCfg.scrutinyUrl){ const b=document.getElementById('dh-load'); if(b) b.click(); }
    return;
  }

  /* ── System Summary: 3 stat slots + network slot (settings-row, PSD) ── */
  const RES_LABELS={cpu:'CPU',ram:'RAM',temp:'Temperature',disk:'Disk Mount'};
  const SLOT_DEFS=['#ff2d55','#30d158','#00c0e8'];

  function fillSlot(card, idx){
    const slot=_wslots[idx]||{type:'cpu'};
    const resOpts=STAT_TYPES.map(t=>`<option value="${t}"${slot.type===t?' selected':''}>${RES_LABELS[t]}</option>`).join('');
    const res=document.createElement('div'); res.className='row';
    res.innerHTML=`<span class="rl">Resource</span><div class="sel-wrap"><select class="row-sel" aria-label="Resource">${resOpts}</select>${CHEV_SVG}</div>`;
    card.appendChild(res);
    res.querySelector('select').onchange=function(){ const t=this.value; _wslots[idx]={type:t}; if(t==='disk'){_wslots[idx].primary='/';_wslots[idx].secondary='';} if(t==='temp'){_wslots[idx].thermalZone=0;} card.innerHTML=''; fillSlot(card, idx); };

    if(slot.type==='disk'){
      card.insertAdjacentHTML('beforeend',
        `<div class="row ie-row" id="slot${idx}-pri"><span class="rl">First Mount Path</span><span class="rv${slot.primary?'':' is-ph'}">${esc(slot.primary||'/')}</span><input id="slot${idx}-pri-i" type="text" value="${esc(slot.primary||'/')}" style="display:none"><button class="pe" type="button" aria-label="Edit first mount path">${PE_SVG}</button></div>`
       +`<div class="row ie-row" id="slot${idx}-sec"><span class="rl">Second Mount Path <span class="opt-span">(optional)</span></span><span class="rv${slot.secondary?'':' is-ph'}">${slot.secondary?esc(slot.secondary):'/mnt/data'}</span><input id="slot${idx}-sec-i" type="text" value="${esc(slot.secondary||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit second mount path">${PE_SVG}</button></div>`);
      initInlineEdit(`slot${idx}-pri`,`slot${idx}-pri-i`,{placeholder:'/',onCommit(v){_wslots[idx].primary=v;}});
      initInlineEdit(`slot${idx}-sec`,`slot${idx}-sec-i`,{placeholder:'/mnt/data',onCommit(v){_wslots[idx].secondary=v;}});
    } else if(slot.type==='temp'){
      const z=Number.isInteger(slot.thermalZone)?slot.thermalZone:0;
      card.insertAdjacentHTML('beforeend',
        `<div class="row ie-row" id="slot${idx}-tz"><span class="rl">Thermal Zone</span><span class="rv">${z}</span><input id="slot${idx}-tz-i" type="number" min="0" max="20" value="${z}" style="display:none"><button class="pe" type="button" aria-label="Edit thermal zone">${PE_SVG}</button></div>`);
      const tip=document.createElement('p'); tip.className='grp-tip in-card'; tip.textContent='Zone 0 is correct for most systems. Only change it if the temperature shown is wrong.'; card.appendChild(tip);
      initInlineEdit(`slot${idx}-tz`,`slot${idx}-tz-i`,{onCommit(v){_wslots[idx].thermalZone=parseInt(v,10)||0;}});
    }
    renderColorControl(card,{value:slot.color||SLOT_DEFS[idx]||'#0289ff',idPrefix:`slotcol${idx}`,onChange(v){_wslots[idx].color=v;}});
  }

  _wslots.slice(0,3).forEach((slot,idx)=>{
    const hdr=document.createElement('p'); hdr.className='grp-hdr'; hdr.textContent='Slot '+(idx+1); body.appendChild(hdr);
    const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
    fillSlot(card, idx);
  });

  /* Slot 4: Network Speed */
  const prov=_wnet.provider||'myspeed';
  const netCard=document.createElement('div'); netCard.className='grp'; body.appendChild(netCard);
  netCard.innerHTML=`
    <div class="row"><span class="rl">Network Speed</span><label class="tog"><input type="checkbox" id="net-en" ${_wnet.enabled?'checked':''}><div class="tr"></div></label></div>
    <div id="net-sub" ${_wnet.enabled?'':'hidden'}>
      <div class="row"><span class="rl">Provider</span><div class="segr">
        <label class="segr-opt"><input type="radio" name="net-prov" value="myspeed" ${prov==='myspeed'?'checked':''}><span class="segr-dot"></span><span>MySpeed</span></label>
        <label class="segr-opt"><input type="radio" name="net-prov" value="speedtest-tracker" ${prov==='speedtest-tracker'?'checked':''}><span class="segr-dot"></span><span>Speedtest Tracker</span></label>
      </div></div>
      <div class="row ie-row" id="net-url-row"><span class="rl">Service URL</span><span class="rv${_wnet.url?'':' is-ph'}">${_wnet.url?esc(_wnet.url):(prov==='myspeed'?'myspeed:5216':'your-server:8850')}</span><input id="net-url" type="text" value="${esc(_wnet.url||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit service URL">${PE_SVG}</button></div>
    </div>`;
  const netEn=netCard.querySelector('#net-en'), netSub=netCard.querySelector('#net-sub');
  netEn.onchange=()=>{ _wnet.enabled=netEn.checked; netSub.hidden=!netEn.checked; };
  netCard.querySelectorAll('input[name="net-prov"]').forEach(r=>r.addEventListener('change',()=>{
    if(!r.checked)return; _wnet.provider=r.value;
    const pr=netCard.querySelector('#net-pass-row'); if(pr)pr.hidden=(r.value!=='myspeed');
    const uv=netCard.querySelector('#net-url-row .rv'); if(uv&&uv.classList.contains('is-ph'))uv.textContent=(r.value==='myspeed'?'myspeed:5216':'your-server:8850');
  }));
  initInlineEdit('net-url-row','net-url',{placeholder:(prov==='myspeed'?'myspeed:5216':'your-server:8850'),onCommit(v){_wnet.url=v;}});
  _secretRow(netSub,{rowId:'net-pass-row',inpId:'net-pass',label:'Password',opt:true,isSet:_wnet.myspeedPassSet,hidden:(prov!=='myspeed')});
}



function _renderConnectionsConfig(body){
  if(_wconnView==='vpn') return _renderVpnConfig(body);
  return _renderMapConfig(body);
}

/* VPN view config — single tunnel, VPN services only (Gluetun / NetBird). */
function _renderVpnConfig(body){
  const svc=_wvpnCfg.service||'gluetun';
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  card.innerHTML=`
    <div class="row"><span class="rl">Service</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="vpn-svc" value="gluetun" ${svc==='gluetun'?'checked':''}><span class="segr-dot"></span><span>Gluetun</span></label>
      <label class="segr-opt"><input type="radio" name="vpn-svc" value="netbird" ${svc==='netbird'?'checked':''}><span class="segr-dot"></span><span>NetBird</span></label>
    </div></div>
    <div class="row ie-row" id="vpn-name-row"><span class="rl">Display Name <span class="opt-span">(optional)</span></span><span class="rv${_wvpnCfg.name?'':' is-ph'}">${_wvpnCfg.name?esc(_wvpnCfg.name):(svc==='gluetun'?'VPN':'Mesh')}</span><input id="vpn-name" type="text" value="${esc(_wvpnCfg.name||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit display name">${PE_SVG}</button></div>`;
  card.querySelectorAll('input[name="vpn-svc"]').forEach(r=>r.addEventListener('change',()=>{ if(r.checked){_wvpnCfg.service=r.value; _renderWidgetForm(body);} }));
  initInlineEdit('vpn-name-row','vpn-name',{placeholder:(svc==='gluetun'?'VPN':'Mesh'),onCommit(v){_wvpnCfg.name=v;}});

  const colHdr=document.createElement('p'); colHdr.className='grp-hdr'; colHdr.textContent='Dot Color'; body.appendChild(colHdr);
  const colCard=document.createElement('div'); colCard.className='grp'; body.appendChild(colCard);
  if(!_wvpnCfg.color)_wvpnCfg.color='#30d158';
  renderColorControl(colCard,{value:_wvpnCfg.color,idPrefix:'vpncol',onChange(v){_wvpnCfg.color=v;}});

  const cCard=document.createElement('div'); cCard.className='grp'; body.appendChild(cCard);
  if(svc==='gluetun'){
    cCard.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="vpn-url-row"><span class="rl">Control Server URL <span class="req">*</span></span><span class="rv${_wvpnCfg.url?'':' is-ph'}">${_wvpnCfg.url?esc(_wvpnCfg.url):'http://gluetun:8000'}</span><input id="vpn-url" type="text" value="${esc(_wvpnCfg.url||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit URL">${PE_SVG}</button></div>`);
    initInlineEdit('vpn-url-row','vpn-url',{placeholder:'http://gluetun:8000',onCommit(v){_wvpnCfg.url=v;}});
    _secretRow(cCard,{rowId:'vpn-apikey-row',inpId:'vpn-apikey',label:'API Key',opt:true,isSet:_wvpnCfg.apiKeySet,onInput(v){_wvpnCfg.apiKey=v;}});
  } else {
    cCard.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="vpn-url-row"><span class="rl">Management API URL <span class="req">*</span></span><span class="rv${_wvpnCfg.url?'':' is-ph'}">${_wvpnCfg.url?esc(_wvpnCfg.url):'http://netbird:33073'}</span><input id="vpn-url" type="text" value="${esc(_wvpnCfg.url||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit URL">${PE_SVG}</button></div>`);
    initInlineEdit('vpn-url-row','vpn-url',{placeholder:'http://netbird:33073',onCommit(v){_wvpnCfg.url=v;}});
    _secretRow(cCard,{rowId:'vpn-token-row',inpId:'vpn-token',label:'Access Token (PAT)',req:true,isSet:_wvpnCfg.tokenSet,onInput(v){_wvpnCfg.token=v;}});
  }
  cCard.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="vpn-href-row"><span class="rl">Click URL <span class="opt-span">(optional)</span></span><span class="rv${_wvpnCfg.href?'':' is-ph'}">${_wvpnCfg.href?esc(_wvpnCfg.href):'http://your-server:8000'}</span><input id="vpn-href" type="text" value="${esc(_wvpnCfg.href||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit click URL">${PE_SVG}</button></div>`);
  initInlineEdit('vpn-href-row','vpn-href',{placeholder:'http://your-server:8000',onCommit(v){_wvpnCfg.href=v;}});
}

function _newSvcId(){return 'svc_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
const _MAP_SVC={
  gluetun:{label:'Gluetun',adminPh:'http://your-server:3002',color:'#30D158',fields:[{key:'url',label:'Control server URL',ph:'gluetun:8000'}]},
  conduit:{label:'Conduit',adminPh:'http://your-server:9093',color:'#AF52DE',fields:[{key:'url',label:'Metrics URL',ph:'conduit:9090'}]},
  netbird:{label:'NetBird',adminPh:'http://your-server:33073',color:'#FF9F0A',fields:[{key:'url',label:'Management API URL',ph:'netbird:33073'},{key:'token',label:'Access token',ph:'NetBird PAT',secret:true}]},
  plausible:{label:'Plausible',adminPh:'http://your-server:8000',color:'#5E5CE6',fields:[{key:'url',label:'Plausible URL',ph:'plausible:8000'},{key:'siteId',label:'Site ID (domain)',ph:'example.com'},{key:'apiKey',label:'Stats API key',ph:'Bearer key',secret:true}]},
  umami:{label:'Umami',adminPh:'http://your-server:3000',color:'#64D2FF',fields:[{key:'url',label:'Umami URL',ph:'umami:3000'},{key:'websiteId',label:'Website ID',ph:'8dc7\u2026 (UUID)'},{key:'username',label:'Username',ph:'admin'},{key:'password',label:'Password',ph:'\u2022\u2022\u2022\u2022\u2022\u2022',secret:true}]},
};

function _renderMapConfig(body){
  if(!Array.isArray(_wmapCfg.services)) _wmapCfg.services=[];
  _wmapCfg.services.forEach(sv=>{ if(!sv.id)sv.id=_newSvcId(); });

  const listHost=document.createElement('div'); body.appendChild(listHost);

  function buildCard(svc,i){
    const meta=_MAP_SVC[svc.type]||_MAP_SVC.gluetun;
    const hdr=document.createElement('p'); hdr.className='grp-hdr grp-hdr-row';
    hdr.innerHTML=`<span>${esc(svc.name||meta.label||('Service '+(i+1)))}</span>`;
    const rm=document.createElement('button'); rm.type='button'; rm.className='grp-hdr-rm'; rm.textContent='Remove';
    rm.onclick=()=>{ _wmapCfg.services.splice(i,1); renderList(); };
    hdr.appendChild(rm); listHost.appendChild(hdr);

    const card=document.createElement('div'); card.className='grp'; listHost.appendChild(card);
    const typeOpts=Object.keys(_MAP_SVC).map(k=>`<option value="${k}"${k===svc.type?' selected':''}>${esc(_MAP_SVC[k].label)}</option>`).join('');
    card.insertAdjacentHTML('beforeend',`<div class="row"><span class="rl">Service</span><div class="sel-wrap"><select class="row-sel" aria-label="Service type">${typeOpts}</select>${CHEV_SVG}</div></div>`);
    card.querySelector('select').onchange=function(){ svc.type=this.value; svc.color=(_MAP_SVC[this.value]||{}).color||svc.color; renderList(); };

    const nid=`map-name-${svc.id}`;
    card.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="${nid}"><span class="rl">Display Name</span><span class="rv${svc.name?'':' is-ph'}">${svc.name?esc(svc.name):esc(meta.label||'Name')}</span><input id="${nid}-i" type="text" value="${esc(svc.name||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit display name">${PE_SVG}</button></div>`);

    (meta.fields||[]).forEach(fld=>{
      if(fld.secret){
        _secretRow(card,{rowId:`mapsec-${svc.id}-${fld.key}-row`,inpId:`mapsec-${svc.id}-${fld.key}`,label:esc(fld.label),isSet:!!svc[fld.key+'Set'],onInput(v){svc[fld.key]=v;}});
      } else {
        const rid=`mapf-${svc.id}-${fld.key}`;
        card.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="${rid}"><span class="rl">${esc(fld.label)}</span><span class="rv${svc[fld.key]?'':' is-ph'}">${svc[fld.key]?esc(svc[fld.key]):esc(fld.ph||'')}</span><input id="${rid}-i" type="text" value="${esc(svc[fld.key]||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit ${esc(fld.label)}">${PE_SVG}</button></div>`);
      }
    });

    const aid=`map-admin-${svc.id}`;
    card.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="${aid}"><span class="rl">Admin UI URL <span class="opt-span">(optional)</span></span><span class="rv${svc.adminUrl?'':' is-ph'}">${svc.adminUrl?esc(svc.adminUrl):esc(meta.adminPh||'https://...')}</span><input id="${aid}-i" type="text" value="${esc(svc.adminUrl||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit admin URL">${PE_SVG}</button></div>`);

    if(!svc.color)svc.color=(_MAP_SVC[svc.type]||{}).color||'#30d158';
    renderColorControl(card,{value:svc.color,idPrefix:`mapcol-${svc.id}`,onChange(v){svc.color=v;}});

    /* wire inline-edit rows now that the card is in the document */
    initInlineEdit(nid,`${nid}-i`,{placeholder:meta.label||'Name',onCommit(v){svc.name=v;renderList();}});
    initInlineEdit(aid,`${aid}-i`,{placeholder:meta.adminPh||'https://...',onCommit(v){svc.adminUrl=v;}});
    (meta.fields||[]).forEach(fld=>{
      if(fld.secret) return;
      initInlineEdit(`mapf-${svc.id}-${fld.key}`,`mapf-${svc.id}-${fld.key}-i`,{placeholder:fld.ph||'',onCommit(v){svc[fld.key]=v;}});
    });
  }

  function renderList(){
    _wmapCfg.services.sort((a,b)=>String(a.name||'').toLowerCase().localeCompare(String(b.name||'').toLowerCase()));
    listHost.innerHTML='';
    if(!_wmapCfg.services.length){
      const empty=document.createElement('p'); empty.className='grp-tip'; empty.textContent='No services yet. Add one below.'; listHost.appendChild(empty);
    }
    _wmapCfg.services.forEach((svc,i)=>buildCard(svc,i));
  }
  renderList();

  const addCard=document.createElement('div'); addCard.className='grp'; body.appendChild(addCard);
  const add=document.createElement('button'); add.type='button'; add.className='wcf-add-row';
  add.innerHTML='<span class="rl" style="color:var(--ac2)">+ Add Service</span>';
  add.onclick=()=>{ _wmapCfg.services.push({id:_newSvcId(),type:'gluetun',name:'',url:'',adminUrl:'',color:'#30d158',token:'',enabled:true}); renderList(); };
  addCard.appendChild(add);

  const legCard=document.createElement('div'); legCard.className='grp'; body.appendChild(legCard);
  legCard.innerHTML=`<div class="row"><span class="rl">Show Legend</span><label class="tog"><input type="checkbox" id="map-legend" ${_wmapCfg.showLegend!==false?'checked':''}><div class="tr"></div></label></div>`;
  legCard.querySelector('#map-legend').onchange=e=>{ _wmapCfg.showLegend=e.target.checked; };
  const legTip=document.createElement('p'); legTip.className='grp-tip'; legTip.textContent='Service key along the bottom of the map.'; body.appendChild(legTip);
}

function _renderCustomConfig(body){
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  card.innerHTML=`<div class="row ie-row" id="cust-url-row"><span class="rl">Iframe URL <span class="req">*</span></span><span class="rv${_customUrl?'':' is-ph'}">${_customUrl?esc(_customUrl):'https://app.example.com/widget.html'}</span><input id="f-url" type="url" value="${esc(_customUrl||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit iframe URL">${PE_SVG}</button></div>`;
  const tip=document.createElement('p'); tip.className='grp-tip'; tip.textContent='The URL will be embedded as an iframe in the dashboard.'; body.appendChild(tip);
  initInlineEdit('cust-url-row','f-url',{placeholder:'https://app.example.com/widget.html',onCommit(v){_customUrl=v;}});

  const o=_iframeOpts||{};
  const advHdr=document.createElement('p'); advHdr.className='grp-hdr'; advHdr.textContent='Advanced'; body.appendChild(advHdr);
  const adv=document.createElement('div'); adv.className='grp'; body.appendChild(adv);
  const refOpts=['','no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url'].map(v=>`<option value="${v}" ${(o.referrerPolicy||'')===v?'selected':''}>${v||'Default'}</option>`).join('');
  adv.innerHTML=`
    <div class="row"><span class="rl">Referrer Policy</span><div class="sel-wrap"><select class="row-sel" id="if-referrer" aria-label="Referrer policy">${refOpts}</select>${CHEV_SVG}</div></div>
    <div class="row ie-row" id="if-allow-row"><span class="rl">Allow (feature policy)</span><span class="rv${o.allow?'':' is-ph'}">${o.allow?esc(o.allow):'autoplay; fullscreen'}</span><input id="if-allow" type="text" value="${esc(o.allow||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit allow">${PE_SVG}</button></div>
    <div class="row"><span class="rl">Allow Fullscreen</span><label class="tog"><input type="checkbox" id="if-fs" ${o.allowFullscreen!==false?'checked':''}><div class="tr"></div></label></div>
    <div class="row ie-row" id="if-refresh-row"><span class="rl">Refresh Interval <span class="opt-span">(ms)</span></span><span class="rv${o.refreshInterval?'':' is-ph'}">${o.refreshInterval?o.refreshInterval:'e.g. 2000'}</span><input id="if-refresh" type="number" min="250" step="250" value="${o.refreshInterval||''}" style="display:none"><button class="pe" type="button" aria-label="Edit refresh interval">${PE_SVG}</button></div>`;
  const sync=()=>{ _iframeOpts.referrerPolicy=adv.querySelector('#if-referrer').value||undefined; _iframeOpts.allow=adv.querySelector('#if-allow').value.trim()||undefined; _iframeOpts.allowFullscreen=adv.querySelector('#if-fs').checked; const ri=parseInt(adv.querySelector('#if-refresh').value,10); _iframeOpts.refreshInterval=(ri&&ri>=250)?ri:undefined; };
  adv.querySelector('#if-referrer').onchange=sync; adv.querySelector('#if-fs').onchange=sync;
  initInlineEdit('if-allow-row','if-allow',{placeholder:'autoplay; fullscreen',onCommit(){sync();}});
  initInlineEdit('if-refresh-row','if-refresh',{placeholder:'e.g. 2000',onCommit(){sync();}});
}

function _normBackupSlots(saved, size) {
  const count = size === 'small' ? 1 : 3;
  const arr = Array.isArray(saved) ? saved : [];
  /* First slot index per provider (the "default instance") */
  const firstIdx = {};
  arr.forEach((s,k)=>{ if(s?.provider && firstIdx[s.provider]===undefined) firstIdx[s.provider]=k; });
  const inferUseDefault = (i) => {
    const s = arr[i]; if(!s?.provider) return true;
    if(s.useDefault!==undefined) return s.useDefault!==false;     /* explicit */
    const fi = firstIdx[s.provider];
    if(i===fi) return true;                                       /* the default instance itself */
    const key = s.provider==='duplicati' ? 'dupUrl' : 'kopiaUrl';
    const myUrl=(s[key]||'').trim(), fUrl=(arr[fi]?.[key]||'').trim();
    return !myUrl || myUrl===fUrl;   /* same/blank URL → used the default; different → independent */
  };
  return Array.from({length: count}, (_, i) => ({
    provider:    arr[i]?.provider    || null,
    jobId:       arr[i]?.jobId       || null,
    customName:  arr[i]?.customName  || '',
    useDefault:  inferUseDefault(i),
    dupUrl:      arr[i]?.dupUrl      || '',
    dupPassSet:  arr[i]?.dupPassSet  || false,
    dupHref:     arr[i]?.dupHref     || '',
    dupPollSec:  arr[i]?.dupPollSec  || 60,
    dupJobList:  [],
    kopiaUrl:    arr[i]?.kopiaUrl    || '',
    kopiaUser:   arr[i]?.kopiaUser   || '',
    kopiaPassSet:arr[i]?.kopiaPassSet|| false,
    kopiaHref:   arr[i]?.kopiaHref   || '',
    kopiaSrcList:[],
  }));
}

/* Auto-fill connection from first same-provider slot that has a URL */
function _autofillSlot(si, provider) {
  const slots = _wbackupCfg.slots;
  const first = slots.findIndex((s,i) => i!==si && s.provider===provider &&
    (provider==='duplicati' ? s.dupUrl : s.kopiaUrl));
  if (first === -1) return;
  const src = slots[first];
  if (provider === 'duplicati') {
    if (!slots[si].dupUrl)     slots[si].dupUrl     = src.dupUrl;
    if (!slots[si].dupPassSet) slots[si].dupPassSet  = src.dupPassSet;
    if (!slots[si].dupHref)    slots[si].dupHref     = src.dupHref;
    slots[si].dupPollSec  = src.dupPollSec;
    slots[si].dupJobList  = src.dupJobList;
  } else {
    if (!slots[si].kopiaUrl)  slots[si].kopiaUrl  = src.kopiaUrl;
    if (!slots[si].kopiaUser) slots[si].kopiaUser = src.kopiaUser;
    if (!slots[si].kopiaPassSet) slots[si].kopiaPassSet = src.kopiaPassSet;
    if (!slots[si].kopiaHref) slots[si].kopiaHref = src.kopiaHref;
    slots[si].kopiaSrcList = src.kopiaSrcList;
  }
}

/* Custom dropdown — native <select> popups don't open in some embedded webviews,
   so we render a button + listbox we fully control (same rationale as the colour picker). */
function _ddCloseAll(except){
  document.querySelectorAll('.dd-list').forEach(l=>{ if(l!==except) l.classList.add('d-none'); });
  document.querySelectorAll('.dd-btn[aria-expanded="true"]').forEach(b=>{ if(!except||b.nextElementSibling!==except) b.setAttribute('aria-expanded','false'); });
}
if(!window.__ddOutsideBound){
  window.__ddOutsideBound=true;
  document.addEventListener('click',e=>{ if(!e.target.closest('.dd')) _ddCloseAll(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') _ddCloseAll(); });
}

function _renderBackupConfig(body){
  const slotCount = _wsize === 'small' ? 1 : 3;
  const SLOT_NAMES = ['First','Second','Third'];
  const slots = _wbackupCfg.slots;
  const PLABEL = pr => pr==='duplicati' ? 'Duplicati' : 'Kopia';
  const firstProvIdx = pr => slots.findIndex(sl => sl.provider===pr);
  const defaultActive = pr => { const f=firstProvIdx(pr); return f>=0 && slots[f].useDefault!==false; };
  const usesDefault = si => {
    const slot=slots[si]; if(!slot.provider) return false;
    const f=firstProvIdx(slot.provider);
    return si!==f && defaultActive(slot.provider) && slot.useDefault!==false;
  };
  function flushDom(){
    const g = id => document.getElementById(id);
    slots.forEach((slot,si)=>{
      const nm=g(`bak-name-${si}`); if(nm) slot.customName=nm.value.trim();
      const defEl=g(`bak-def-${si}`); if(defEl) slot.useDefault=defEl.checked;
      const jv=g(`dup-job-${si}`)||g(`kopia-src-${si}`);
      if(jv&&!jv.disabled) slot.jobId=jv.value||null;
      if(slot.provider==='duplicati'){
        const u=g(`dup-url-${si}`);  if(u) slot.dupUrl=u.value.trim()||slot.dupUrl;
        const h=g(`dup-href-${si}`); if(h) slot.dupHref=h.value.trim();
        const pl=g(`dup-poll-${si}`); if(pl) slot.dupPollSec=Math.max(10,parseInt(pl.value||'60',10));
        const pw=g(`dup-pass-${si}`); if(pw&&pw.value.trim()) slot.dupPass=pw.value.trim();
      } else if(slot.provider==='kopia'){
        const u=g(`kopia-url-${si}`);  if(u) slot.kopiaUrl=u.value.trim()||slot.kopiaUrl;
        const us=g(`kopia-user-${si}`); if(us) slot.kopiaUser=us.value.trim()||slot.kopiaUser;
        const h=g(`kopia-href-${si}`); if(h) slot.kopiaHref=h.value.trim();
        const pw=g(`kopia-pass-${si}`); if(pw&&pw.value.trim()) slot.kopiaPass=pw.value.trim();
      }
    });
  }
  const rerender = () => { flushDom(); body.innerHTML=''; render(); };

  function ieRow(host,{id,label,req,opt,value,ph,type}){
    const rid=id+'-row';
    const tag=(req?' <span class="req">*</span>':'')+(opt?' <span class="opt-span">(optional)</span>':'');
    host.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="${rid}"><span class="rl">${esc(label)}${tag}</span><span class="rv${value?'':' is-ph'}">${value?esc(value):esc(ph||'')}</span><input id="${id}" type="${type||'text'}" value="${esc(value==null?'':value)}" style="display:none"><button class="pe" type="button" aria-label="Edit ${esc(label)}">${PE_SVG}</button></div>`);
    return rid;
  }
  function addNameField(host, si){
    const slot=slots[si];
    const rid=ieRow(host,{id:`bak-name-${si}`,label:'Display Name',opt:true,value:slot.customName||'',ph:'Shown on the card'});
    initInlineEdit(rid,`bak-name-${si}`,{placeholder:'Shown on the card',onCommit(v){slot.customName=v;}});
  }
  function addDefaultToggle(host, si){
    const slot=slots[si]; const prov=slot.provider; const isFirst=si===firstProvIdx(prov);
    const label=isFirst?`Set as default ${PLABEL(prov)} instance`:`Use default ${PLABEL(prov)} settings`;
    const desc =isFirst?`Other ${PLABEL(prov)} instances can reuse this connection.`:`Reuse the default ${PLABEL(prov)} container. Turn off to set its own.`;
    host.insertAdjacentHTML('beforeend',`<div class="row"><span class="rl">${label}</span><label class="tog"><input type="checkbox" id="bak-def-${si}" ${slot.useDefault!==false?'checked':''} aria-label="${label}"><div class="tr"></div></label></div>`);
    const tip=document.createElement('p'); tip.className='grp-tip in-card'; tip.textContent=desc; host.appendChild(tip);
    host.querySelector(`#bak-def-${si}`).onchange=e=>{ slot.useDefault=e.target.checked; rerender(); };
  }
  function fetchRow(host,{id,label}){
    const fr=document.createElement('div'); fr.className='row'; fr.innerHTML='<span class="rl"></span>';
    const btn=document.createElement('button'); btn.type='button'; btn.className='row-btn'; btn.id=id; btn.textContent=label;
    fr.appendChild(btn); host.appendChild(fr); return btn;
  }

  function renderJobDrop(si, container){
    const slot=slots[si]; container.innerHTML='';
    const row=document.createElement('div'); row.className='row';
    if(!slot.dupJobList.length){
      const saved=slot.jobId?(slot.customName||slot.jobId):'';
      row.innerHTML=`<span class="rl">Job</span><div class="sel-wrap"><select class="row-sel" id="dup-job-${si}" aria-label="Job" disabled><option>${saved?esc(saved)+', fetch to change':'Fetch jobs first'}</option></select>${CHEV_SVG}</div>`;
    } else {
      const opts=['<option value="">None</option>'].concat(slot.dupJobList.map(j=>`<option value="${esc(String(j.id))}"${String(j.id)===String(slot.jobId||'')?' selected':''}>${esc(j.name)}</option>`)).join('');
      row.innerHTML=`<span class="rl">Job</span><div class="sel-wrap"><select class="row-sel" id="dup-job-${si}" aria-label="Job">${opts}</select>${CHEV_SVG}</div>`;
    }
    container.appendChild(row);
    const sel=row.querySelector('select'); if(!sel.disabled) sel.onchange=()=>{ slot.jobId=sel.value||null; };
  }
  function renderSrcDrop(si, container){
    const slot=slots[si]; container.innerHTML='';
    const row=document.createElement('div'); row.className='row';
    if(!slot.kopiaSrcList.length){
      const saved=slot.jobId?(slot.customName||slot.jobId):'';
      row.innerHTML=`<span class="rl">Source</span><div class="sel-wrap"><select class="row-sel" id="kopia-src-${si}" aria-label="Source" disabled><option>${saved?esc(saved)+', fetch to change':'Fetch sources first'}</option></select>${CHEV_SVG}</div>`;
    } else {
      const opts=['<option value="">None</option>'].concat(slot.kopiaSrcList.map(src=>`<option value="${esc(src.id)}"${String(src.id)===String(slot.jobId||'')?' selected':''}>${esc(src.name)}</option>`)).join('');
      row.innerHTML=`<span class="rl">Source</span><div class="sel-wrap"><select class="row-sel" id="kopia-src-${si}" aria-label="Source">${opts}</select>${CHEV_SVG}</div>`;
    }
    container.appendChild(row);
    const sel=row.querySelector('select'); if(!sel.disabled) sel.onchange=()=>{ slot.jobId=sel.value||null; };
  }

  function buildConnSection(card, si){
    const slot=slots[si]; const prov=slot.provider;
    if(usesDefault(si)){
      const fIdx=firstProvIdx(prov);
      const note=document.createElement('p'); note.className='grp-tip in-card'; note.textContent=`Uses the ${PLABEL(prov)} container from ${SLOT_NAMES[fIdx]} Instance.`; card.appendChild(note);
      const wrap=document.createElement('div'); wrap.id=`${prov==='duplicati'?'dup-job':'kopia-src'}-wrap-${si}`; card.appendChild(wrap);
      prov==='duplicati' ? renderJobDrop(si,wrap) : renderSrcDrop(si,wrap);
      addNameField(card, si);
      return;
    }
    const shared = slotCount>1 && si===firstProvIdx(prov) && defaultActive(prov);

    if(prov==='duplicati'){
      const urlRid=ieRow(card,{id:`dup-url-${si}`,label:'URL',req:true,value:slot.dupUrl,ph:'http://duplicati:8200'});
      const fbtn=fetchRow(card,{id:`dup-fetch-${si}`,label:'Fetch Jobs'});
      _secretRow(card,{rowId:`dup-pass-row-${si}`,inpId:`dup-pass-${si}`,label:'Password',opt:true,isSet:!!(slot.dupPassSet||slot.dupPass)});
      const hrefRid=ieRow(card,{id:`dup-href-${si}`,label:'Click URL',opt:true,value:slot.dupHref,ph:'http://duplicati:8200'});
      const pollRid=ieRow(card,{id:`dup-poll-${si}`,label:'Poll Interval (sec)',value:slot.dupPollSec,ph:'60',type:'number'});
      const jobWrap=document.createElement('div'); jobWrap.id=`dup-job-wrap-${si}`; card.appendChild(jobWrap); renderJobDrop(si, jobWrap);
      addNameField(card, si);
      initInlineEdit(urlRid,`dup-url-${si}`,{placeholder:'http://duplicati:8200',onCommit(v){slot.dupUrl=v;}});
      initInlineEdit(hrefRid,`dup-href-${si}`,{placeholder:'http://duplicati:8200',onCommit(v){slot.dupHref=v;}});
      initInlineEdit(pollRid,`dup-poll-${si}`,{placeholder:'60',onCommit(v){slot.dupPollSec=Math.max(10,parseInt(v||'60',10));}});
      fbtn.onclick = async function(){
        const btn=this;
        const url=(document.getElementById(`dup-url-${si}`)?.value||'').trim();
        const pass=(document.getElementById(`dup-pass-${si}`)?.value||'').trim();
        if(!url){toast('Enter a Duplicati URL first','err');return;}
        btn.disabled=true; btn.textContent='Fetching...';
        try{
          slot.dupUrl=url;
          const b={url}; if(pass) b.password=pass; else if(slot.dupPassSet) b.useStoredPass=true;
          const wid=(eid!==null&&items[eid]?.id)?items[eid].id:'__preview__';
          const r=await fetch(`/api/duplicati-jobs/${encodeURIComponent(wid)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
          if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||r.status);}
          const data=await r.json();
          slot.dupJobList=Array.isArray(data)?data:(Array.isArray(data?.jobs)?data.jobs:[]);
          slots.forEach((sl,j)=>{ if(j!==si && sl.provider==='duplicati' && (shared && usesDefault(j) || sl.dupUrl===url)){ sl.dupJobList=slot.dupJobList; const w=document.getElementById(`dup-job-wrap-${j}`); if(w) renderJobDrop(j,w); } });
          const jw=document.getElementById(`dup-job-wrap-${si}`); if(jw) renderJobDrop(si, jw);
          toast(slot.dupJobList.length?`Loaded ${slot.dupJobList.length} job${slot.dupJobList.length>1?'s':''}`:'No backup jobs found', slot.dupJobList.length?'ok':'err');
        }catch(e){toast('Fetch failed: '+e.message,'err');}
        finally{btn.disabled=false; btn.textContent='Fetch Jobs';}
      };
    } else {
      const urlRid=ieRow(card,{id:`kopia-url-${si}`,label:'URL',req:true,value:slot.kopiaUrl,ph:'http://kopia:51515'});
      const fbtn=fetchRow(card,{id:`kopia-fetch-${si}`,label:'Fetch Sources'});
      const userRid=ieRow(card,{id:`kopia-user-${si}`,label:'Username',opt:true,value:slot.kopiaUser,ph:'admin'});
      _secretRow(card,{rowId:`kopia-pass-row-${si}`,inpId:`kopia-pass-${si}`,label:'Password',opt:true,isSet:!!(slot.kopiaPassSet||slot.kopiaPass)});
      const hrefRid=ieRow(card,{id:`kopia-href-${si}`,label:'Click URL',opt:true,value:slot.kopiaHref,ph:'http://kopia:51515'});
      const srcWrap=document.createElement('div'); srcWrap.id=`kopia-src-wrap-${si}`; card.appendChild(srcWrap); renderSrcDrop(si, srcWrap);
      addNameField(card, si);
      initInlineEdit(urlRid,`kopia-url-${si}`,{placeholder:'http://kopia:51515',onCommit(v){slot.kopiaUrl=v;}});
      initInlineEdit(userRid,`kopia-user-${si}`,{placeholder:'admin',onCommit(v){slot.kopiaUser=v;}});
      initInlineEdit(hrefRid,`kopia-href-${si}`,{placeholder:'http://kopia:51515',onCommit(v){slot.kopiaHref=v;}});
      fbtn.onclick = async function(){
        const btn=this;
        const url=(document.getElementById(`kopia-url-${si}`)?.value||'').trim();
        const user=(document.getElementById(`kopia-user-${si}`)?.value||'').trim();
        const pass=(document.getElementById(`kopia-pass-${si}`)?.value||'').trim();
        if(!url){toast('Enter a Kopia URL first','err');return;}
        btn.disabled=true; btn.textContent='Fetching...';
        try{
          slot.kopiaUrl=url; slot.kopiaUser=user||slot.kopiaUser;
          const b={url}; if(user)b.username=user; if(pass)b.password=pass; else if(slot.kopiaPassSet)b.useStoredPass=true;
          const wid=(eid!==null&&items[eid]?.id)?items[eid].id:'__preview__';
          const r=await fetch(`/api/kopia-sources/${encodeURIComponent(wid)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
          if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||r.status);}
          const srcs=await r.json();
          slot.kopiaSrcList=Array.isArray(srcs)?srcs:(Array.isArray(srcs?.sources)?srcs.sources:[]);
          slots.forEach((sl,j)=>{ if(j!==si && sl.provider==='kopia' && (shared && usesDefault(j) || sl.kopiaUrl===url)){ sl.kopiaSrcList=slot.kopiaSrcList; const w=document.getElementById(`kopia-src-wrap-${j}`); if(w) renderSrcDrop(j,w); } });
          const sw=document.getElementById(`kopia-src-wrap-${si}`); if(sw) renderSrcDrop(si, sw);
          toast(slot.kopiaSrcList.length?`Loaded ${slot.kopiaSrcList.length} source${slot.kopiaSrcList.length>1?'s':''}`:'No sources found', slot.kopiaSrcList.length?'ok':'err');
        }catch(e){toast('Fetch failed: '+e.message,'err');}
        finally{btn.disabled=false; btn.textContent='Fetch Sources';}
      };
    }
  }

  function buildSlotSection(si){
    const slot=slots[si];
    const hdr=document.createElement('p'); hdr.className='grp-hdr'; hdr.textContent= slotCount>1 ? SLOT_NAMES[si]+' Instance' : 'Instance'; body.appendChild(hdr);
    const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
    const prov=slot.provider||'';
    card.insertAdjacentHTML('beforeend',`<div class="row"><span class="rl">Provider</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="bak-prov-${si}" value="" ${!prov?'checked':''}><span class="segr-dot"></span><span>None</span></label>
      <label class="segr-opt"><input type="radio" name="bak-prov-${si}" value="duplicati" ${prov==='duplicati'?'checked':''}><span class="segr-dot"></span><span>Duplicati</span></label>
      <label class="segr-opt"><input type="radio" name="bak-prov-${si}" value="kopia" ${prov==='kopia'?'checked':''}><span class="segr-dot"></span><span>Kopia</span></label>
    </div></div>`);
    card.querySelectorAll(`input[name="bak-prov-${si}"]`).forEach(r=>r.addEventListener('change',()=>{ if(!r.checked)return; slot.provider=r.value||null; slot.jobId=null; if(slot.provider)slot.useDefault=true; rerender(); }));
    if(slot.provider){
      if(slotCount>1) addDefaultToggle(card, si);
      buildConnSection(card, si);
    }
  }

  function render(){
    for(let si=0; si<slotCount; si++) buildSlotSection(si);
  }
  render();
}

/* Folder form — settings-row system (PSD: add_new_folder).
   Folder Name = inline-edit row; Add Apps = tap-to-toggle checklist dropdown. */
function buildFolderForm(body,item){
  const children=item?.children||[];
  const apps=items.filter(i=>i.type==='app'&&!i.dock);
  /* In edit mode, surface current children even if they'd otherwise be filtered. */
  children.forEach(cid=>{ if(!apps.some(a=>a.id===cid)){ const a=items.find(i=>i.id===cid); if(a) apps.push(a); } });

  const opts=apps.map(a=>`<li role="option" data-val="${esc(a.id)}" aria-selected="${children.includes(a.id)?'true':'false'}">${esc(a.label||a.id)}</li>`).join('')
    || '<li class="row-dd-empty" aria-disabled="true">No apps available</li>';

  body.innerHTML=`
    <div class="grp">
      <div class="row ie-row" id="ie-fname">
        <span class="rl">Folder Name</span>
        <span class="rv${item?.label?'':' is-ph'}">${esc(item?.label||'My Folder')}</span>
        <input id="f-fname" type="text" value="${esc(item?.label||'')}" style="display:none">
        <button class="pe" type="button" aria-label="Edit folder name">${PE_SVG}</button>
      </div>
      <div class="row">
        <span class="rl">Add Apps</span>
        <div class="row-dd" id="folder-apps-dd">
          <button class="row-dd-btn" id="folder-apps-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="folder-apps-label">Select apps</span>
            ${CHEV_SVG}
          </button>
          <ul class="row-dd-list checklist" id="folder-apps-list" role="listbox" aria-multiselectable="true" aria-label="Apps in this folder" hidden>${opts}</ul>
        </div>
      </div>
    </div>
    <p class="grp-tip">Tap to add or remove apps from this folder.</p>`;

  initInlineEdit('ie-fname','f-fname',{placeholder:'My Folder'});
  _wireFolderApps();
}

/* Multi-select checklist: tap toggles aria-selected, list stays open. */
function _wireFolderApps(){
  const dd=document.getElementById('folder-apps-dd');
  const btn=document.getElementById('folder-apps-btn');
  const list=document.getElementById('folder-apps-list');
  const label=document.getElementById('folder-apps-label');
  if(!dd||!btn||!list||!label) return;
  const sync=()=>{
    const sel=[...list.querySelectorAll('li[aria-selected="true"]')];
    label.textContent = sel.length===0 ? 'Select apps'
      : sel.length===1 ? sel[0].textContent
      : sel.length+' selected';
  };
  const close=()=>{ list.hidden=true; btn.setAttribute('aria-expanded','false'); };
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    const open=list.hidden;
    if(open){ list.hidden=false; btn.setAttribute('aria-expanded','true'); }
    else close();
  });
  list.addEventListener('click',e=>{
    const li=e.target.closest('li[role="option"]');
    if(!li) return;
    li.setAttribute('aria-selected', li.getAttribute('aria-selected')==='true'?'false':'true');
    sync();
  });
  document.addEventListener('click',e=>{ if(!dd.contains(e.target)) close(); });
  sync();
}

/* ── Reusable color control (PSD: swatch row + Hue/Saturation/Brightness + Color Code).
   Operates in hex, resolves named CSS colors, calls onChange(hex) on any change.
   Used by the Icon, Fixed Label and Live Activity sections and the Widget slots. ── */
const CC_SWATCHES=['#1c1c1e','#8e8e93','#f2f2f7','#ff393c','#ffcd00','#35c759','#0289ff','#cb30df'];
const _ccIco={
  hueLo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  hueHi:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  satLo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/></svg>',
  satHi:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  brLo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3.2"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M6.5 6.5 5.4 5.4M18.6 18.6l-1.1-1.1M17.5 6.5l1.1-1.1M5.4 18.6l1.1-1.1"/></svg>',
  brHi:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="5"/><path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4"/></svg>',
};
function _hsvToRgb(h,s,v){ s/=100;v/=100; const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c; let r,g,b; h%=360; if(h<0)h+=360;
  if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]; }
function _hsvToHex(h,s,v){ return '#'+_hsvToRgb(h,s,v).map(n=>n.toString(16).padStart(2,'0')).join(''); }
function _cssToHex(str){ try{ const c=document.createElement('canvas').getContext('2d'); c.fillStyle='#000'; c.fillStyle=str; const v=c.fillStyle;
  if(/^#[0-9a-f]{6}$/i.test(v))return v;
  const m=v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return m?'#'+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,'0')).join(''):null; }catch{return null;} }
function _hexToHsv(hex){ const h6=_cssToHex(hex); if(!h6)return null;
  const r=parseInt(h6.slice(1,3),16)/255,g=parseInt(h6.slice(3,5),16)/255,b=parseInt(h6.slice(5,7),16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn; let h=0;
  if(d){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360; }
  return {h:Math.round(h),s:Math.round(mx?d/mx*100:0),v:Math.round(mx*100)}; }

function renderColorControl(container,{value='#0289ff',idPrefix,onChange,semantic=false}={}){
  const isSem=v=>v==='dark'||v==='light';
  const init=_hexToHsv(isSem(value)?'#0289ff':value)||{h:212,s:99,v:100};
  const swatches = semantic
    ? `<button type="button" class="cc-swatch cc-sem" data-v="dark" style="background:#1c1c1e" title="Dark (theme)" aria-label="Dark"></button>
       <button type="button" class="cc-swatch cc-sem" data-v="light" style="background:#f2f2f7" title="Light (theme)" aria-label="Light"></button>
       <button type="button" class="cc-swatch cc-rainbow" data-v="custom" aria-label="Custom color"></button>
       ${['#ff393c','#ffcd00','#35c759','#0289ff','#cb30df'].map(h=>`<button type="button" class="cc-swatch" data-v="${h}" style="background:${h}" aria-label="${h}"></button>`).join('')}`
    : `<button type="button" class="cc-swatch cc-rainbow" data-v="custom" aria-label="Custom color"></button>
       ${CC_SWATCHES.map(h=>`<button type="button" class="cc-swatch" data-v="${h}" style="background:${h}" aria-label="${h}"></button>`).join('')}`;
  const wrap=document.createElement('div');
  wrap.innerHTML=`
    <div class="row cc-row"><span class="rl">Color</span><div class="cc-sw">${swatches}</div></div>
    <div class="row hsb-row cc-tune"><span class="rl">Hue</span><div class="hsb-track"><span class="hsb-ico">${_ccIco.hueLo}</span><input type="range" class="hsb-range hsb-hue" id="${idPrefix}-h" min="0" max="360" value="${init.h}" aria-label="Hue"><span class="hsb-ico">${_ccIco.hueHi}</span></div></div>
    <div class="row hsb-row cc-tune"><span class="rl">Saturation</span><div class="hsb-track"><span class="hsb-ico">${_ccIco.satLo}</span><input type="range" class="hsb-range" id="${idPrefix}-s" min="0" max="100" value="${init.s}" aria-label="Saturation"><span class="hsb-ico">${_ccIco.satHi}</span></div></div>
    <div class="row hsb-row cc-tune"><span class="rl">Brightness</span><div class="hsb-track"><span class="hsb-ico">${_ccIco.brLo}</span><input type="range" class="hsb-range" id="${idPrefix}-v" min="0" max="100" value="${init.v}" aria-label="Brightness"><span class="hsb-ico">${_ccIco.brHi}</span></div></div>
    <div class="row ie-row cc-tune" id="${idPrefix}-code-row"><span class="rl">Color Code</span><span class="rv is-ph">#rrggbb or any CSS color</span><input id="${idPrefix}-hex" type="text" style="display:none"><button class="pe" type="button" aria-label="Edit color code">${PE_SVG}</button></div>`;
  const rows=[...wrap.children]; rows.forEach(r=>container.appendChild(r));
  const q=sel=>container.querySelector(sel);
  const hEl=q(`#${idPrefix}-h`),sEl=q(`#${idPrefix}-s`),vEl=q(`#${idPrefix}-v`);
  const codeRv=q(`#${idPrefix}-code-row .rv`);
  const tune=rows.filter(r=>r.classList.contains('cc-tune'));
  const hidden=document.createElement('input'); hidden.type='hidden'; hidden.id=`${idPrefix}-val`; container.appendChild(hidden);
  let mode=isSem(value)?value:'color';
  let showTune=false;
  const curHex=()=>_hsvToHex(+hEl.value,+sEl.value,+vEl.value);
  const _rgb=h=>{const x=_cssToHex(h);return x?[parseInt(x.slice(1,3),16),parseInt(x.slice(3,5),16),parseInt(x.slice(5,7),16)]:null;};
  const _near=(a,b)=>{const ra=_rgb(a),rb=_rgb(b);return ra&&rb&&ra.every((n,i)=>Math.abs(n-rb[i])<=3);};
  function paint(){
    const h=+hEl.value,s=+sEl.value,v=+vEl.value,hex=curHex();
    sEl.style.background=`linear-gradient(90deg, ${_hsvToHex(h,0,v)}, ${_hsvToHex(h,100,v)})`;
    vEl.style.background=`linear-gradient(90deg, #000, ${_hsvToHex(h,100,100)})`;
    let matched=null;
    container.querySelectorAll('.cc-swatch').forEach(b=>{
      let on=false;
      if(mode==='dark'||mode==='light') on=(b.dataset.v===mode);
      else if(!showTune) on=(b.dataset.v!=='custom'&&!b.classList.contains('cc-sem')&&_near(b.dataset.v,hex));
      b.classList.toggle('on',on); if(on)matched=b;
    });
    const rb=container.querySelector('.cc-rainbow'); if(rb)rb.classList.toggle('on',mode==='color'&&showTune);
    tune.forEach(r=>r.style.display=showTune?'':'none');
    if(!codeRv.closest('.editing')){
      codeRv.textContent = mode==='color'?hex:(mode==='dark'?'Dark':'Light');
      codeRv.classList.remove('is-ph');
    }
    hidden.value = mode==='color'?hex:mode;
  }
  const commit=()=>{ paint(); onChange?.(hidden.value); };
  [hEl,sEl,vEl].forEach(el=>el.addEventListener('input',()=>{ mode='color'; showTune=true; commit(); }));
  container.querySelectorAll('.cc-swatch').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.v==='dark'||b.dataset.v==='light'){ mode=b.dataset.v; showTune=false; commit(); return; }
    if(b.dataset.v==='custom'){ mode='color'; showTune=true; commit(); return; }
    mode='color'; showTune=false;
    const hv=_hexToHsv(b.dataset.v); if(hv){hEl.value=hv.h;sEl.value=hv.s;vEl.value=hv.v;}
    commit();
  }));
  initInlineEdit(`${idPrefix}-code-row`,`${idPrefix}-hex`,{placeholder:'#rrggbb or any CSS color',onCommit(val){
    const hv=_hexToHsv(val); if(hv){ mode='color'; showTune=true; hEl.value=hv.h; sEl.value=hv.s; vEl.value=hv.v; } commit();
  }});
  if(mode==='color'){
    const presets=[...container.querySelectorAll('.cc-swatch')].filter(b=>b.dataset.v!=='custom'&&!b.classList.contains('cc-sem')).map(b=>b.dataset.v);
    showTune=!presets.some(pv=>_near(pv,value));
  }
  paint();
  return { getValue:()=>hidden.value };
}

function buildAppForm(body,item){
  const docks=items.filter(i=>i.type==='app'&&i.dock&&i.id!==item?.id).length;
  const dockFull=docks>=4;
  const mon=item?.monitoring||{};
  const hc=mon.healthcheck||{enabled:!!(item?.container||item?.ping),container:item?.container||'',pingUrl:item?.ping||''};
  const act=mon.activity||{enabled:!!(item?.badge?.enabled),url:item?.badge?.url||'',interval:item?.badge?.interval||30};
  const actCustom=mon.activity?.custom||{};
  const staticBadge=mon.staticBadge||{};
  const hasStatic=!!staticBadge.enabled;
  const isPing=!!hc.pingUrl;
  const skipTls=!!(item?.skipTlsVerify);

  /* inline-edit row helper */
  const ier=(rowId,label,inpId,val,ph,type='text')=>{
    const has=val!=null&&val!=='';
    return `<div class="row ie-row" id="${rowId}"><span class="rl">${label}</span>`
      +`<span class="rv${has?'':' is-ph'}">${has?esc(val):esc(ph)}</span>`
      +`<input id="${inpId}" type="${type}" value="${esc(val||'')}" style="display:none">`
      +`<button class="pe" type="button" aria-label="Edit ${label}">${PE_SVG}</button></div>`;
  };
  const tog=(id,on,extra='')=>`<label class="tog${extra}"><input type="checkbox" id="${id}" ${on?'checked':''}><div class="tr"></div></label>`;

  body.innerHTML=`
    <div class="grp">
      ${ier('ie-name','Name','f-lbl',item?.label,'My App')}
      ${ier('ie-url','URL','f-href',item?.href,'https://app.example.com','url')}
    </div>

    <p class="grp-hdr">Icon</p>
    <div class="grp" id="ipw">
      <div class="row icon-src-row">
        <span class="icon-prev" id="ipv" style="background:${rc(scol)}">${siurl?`<img src="${esc(resolveIcon(siurl))}" alt="" id="ipv-img">`:`<span>${(item?.label||'?')[0]?.toUpperCase()||'?'}</span>`}</span>
        <input class="icon-srch" id="ip-in" type="text" autocomplete="off" placeholder="Name or full URL" value="${esc(siurl)}">
        <button type="button" class="row-btn" id="ip-upload-lbl">Upload</button>
        <input type="file" id="ip-upload" accept=".svg,.png,.ico,image/svg+xml,image/png,image/x-icon" style="position:absolute;width:1px;height:1px;opacity:0">
      </div>
      <div class="iprs" id="iprs"></div>
      <div id="icon-color-slot"></div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">Show in Dock</span>${tog('f-dock',!!item?.dock,(dockFull&&!item?.dock)?' tog-disabled':'')}</div>
    </div>
    ${dockFull&&!item?.dock?'<p class="grp-tip">Dock full (4/4). Remove an app first.</p>':''}

    <p class="grp-hdr">Badge</p>
    <div class="grp">
      <div class="row"><span class="rl">Health Check</span>${tog('hc-en',hc.enabled)}</div>
      <div id="hc-sub" ${hc.enabled?'':'hidden'}>
        <div class="row"><span class="rl">Type</span><div class="segr">
          <label class="segr-opt"><input type="radio" name="hc-type" id="hc-type-con" ${isPing?'':'checked'}><span class="segr-dot"></span><span>Container</span></label>
          <label class="segr-opt"><input type="radio" name="hc-type" id="hc-type-ping" ${isPing?'checked':''}><span class="segr-dot"></span><span>Ping</span></label>
        </div></div>
        <div id="hc-con-row" ${isPing?'hidden':''}>${ier('ie-hc-con','Container','hc-con',hc.container,'container-name')}</div>
        <div id="hc-ping-row" ${isPing?'':'hidden'}>
          ${ier('ie-hc-ping','Ping URL','hc-ping',hc.pingUrl,'http://your-server-ip:port','url')}
          <div class="row"><span class="rl"></span><span id="hc-ping-status" class="row-status"></span><button type="button" class="row-btn" id="hc-ping-test">Test</button></div>
        </div>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">Fixed Label</span>${tog('static-en',hasStatic)}</div>
      <div id="static-sub" ${hasStatic?'':'hidden'}>
        ${ier('ie-static-label','Label Text','f-static-label',staticBadge.label,'e.g. Backup')}
        <div id="static-color-slot"></div>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">Live Activity</span>${tog('act-en',act.enabled)}</div>
      <div id="act-sub" ${act.enabled?'':'hidden'}>
        ${ier('ie-burl','API URL','f-burl',act.url,'http://container-name:port/api/v2','url')}
        <div class="row"><span class="rl"></span><span id="bst" class="row-status">${spaths.length?'Saved: '+esc(spaths.join(' + ')):''}</span><button type="button" class="row-btn" id="bfetch">Fetch</button></div>
        <div id="bprow" class="${spaths.length?'':'bprow-hidden'}">
          <div class="row"><span class="rl">Value</span></div>
          <div class="bval-box"><input class="bval-search" id="bsearch" type="text" placeholder="Filter values" autocomplete="off"><div class="blist" id="blist"></div></div>
        </div>
        <div id="auth-row-wrap">
          <div class="row"><span class="rl">Authentication</span>${tog('auth-en',!!(act.params||act.headers))}</div>
          <div id="auth-sub" ${(act.params||act.headers)?'':'hidden'}>
            <div class="row ta-row"><span class="rl">Add to URL<br><span class="rl-sub">(query params)</span></span><textarea class="ta-field" id="f-bpar" placeholder="One key=value per line.&#10;Added to the URL as ?key=value.">${act.params?Object.entries(act.params).map(([k,v])=>k+'='+v).join('\n'):''}</textarea></div>
            <div class="row ta-row"><span class="rl">Add to Header</span><textarea class="ta-field" id="f-bhdr" placeholder="One key=value per line.&#10;Sent as an HTTP request header.">${act.headers?Object.entries(act.headers).map(([k,v])=>k+'='+v).join('\n'):''}</textarea></div>
          </div>
        </div>
        <div id="act-color-slot"></div>
        ${ier('ie-bunit','Unit','bcust-unit',actCustom.unit,'e.g. GB')}
        <div id="poll-row"><div class="row"><span class="rl">Poll</span><div class="poll-inline">every <input id="f-bint" type="number" min="10" max="3600" value="${act.interval||30}"> seconds</div></div></div>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">Allow self-signed certificate</span>${tog('f-skip-tls',skipTls)}</div>
    </div>
    <p class="grp-tip">Skip TLS verification for this app's URLs. Skipping verification is insecure and should only be done if you fully understand the risks.</p>`;

  /* Inline-edit rows */
  initInlineEdit('ie-name','f-lbl',{placeholder:'My App',onCommit(){updPrev();}});
  initInlineEdit('ie-url','f-href',{placeholder:'https://app.example.com'});
  initInlineEdit('ie-hc-con','hc-con',{placeholder:'container-name'});
  initInlineEdit('ie-hc-ping','hc-ping',{placeholder:'http://your-server-ip:port'});
  initInlineEdit('ie-static-label','f-static-label',{placeholder:'e.g. Backup'});
  initInlineEdit('ie-burl','f-burl',{placeholder:'http://container-name:port/api/v2'});
  initInlineEdit('ie-bunit','bcust-unit',{placeholder:'e.g. GB'});

  /* Color controls */
  renderColorControl(document.getElementById('icon-color-slot'),{value:scol||'dark',idPrefix:'icon-col',semantic:true,onChange(v){scol=v;const pv=document.getElementById('ipv');if(pv)pv.style.background=rc(scol);}});
  renderColorControl(document.getElementById('static-color-slot'),{value:staticBadge.color||'#0289ff',idPrefix:'static-col'});
  renderColorControl(document.getElementById('act-color-slot'),{value:actCustom.color||'#0289ff',idPrefix:'act-col'});

  /* Icon search/upload */
  wireIcon();
  if(siurl)updPrev();

  /* Health check enable state honours the global Docker toggle */
  const globalHealthOn=!!(document.getElementById('srv-docker-en')?.checked);
  const hcEn=document.getElementById('hc-en');
  if(hcEn){
    hcEn.disabled=!globalHealthOn;
    if(!globalHealthOn){const sub=document.getElementById('hc-sub');if(sub){sub.style.opacity='0.45';sub.style.pointerEvents='none';}}
  }
  const showHide=(id,on)=>{const el=document.getElementById(id);if(el)el.hidden=!on;};
  hcEn?.addEventListener('change',e=>{if(globalHealthOn)showHide('hc-sub',e.target.checked);});
  document.querySelectorAll('input[name="hc-type"]').forEach(r=>r.addEventListener('change',()=>{
    const ping=document.getElementById('hc-type-ping')?.checked;
    showHide('hc-con-row',!ping); showHide('hc-ping-row',ping);
  }));
  document.getElementById('hc-ping-test')?.addEventListener('click',testPing);
  document.getElementById('static-en')?.addEventListener('change',e=>showHide('static-sub',e.target.checked));
  document.getElementById('act-en')?.addEventListener('change',e=>showHide('act-sub',e.target.checked));
  document.getElementById('auth-en')?.addEventListener('change',e=>showHide('auth-sub',e.target.checked));
  document.getElementById('bfetch')?.addEventListener('click',fetchBadge);
  document.getElementById('bsearch')?.addEventListener('input',e=>renderBadgeList(fnums,false,e.target.value));
  if(spaths.length){['bprow','auth-row-wrap','poll-row'].forEach(id=>document.getElementById(id)?.classList.remove('bprow-hidden'));renderBadgeList([],true);}
}

function wireIcon(){
  const inp=document.getElementById('ip-in'),rs=document.getElementById('iprs');
  if(!inp)return;
  let t;
  inp.oninput=()=>{
    const v=inp.value.trim();
    /* Full URL — use directly */
    if(v.startsWith('http://')||v.startsWith('https://')){siurl=v;updPrev();rs.classList.remove('open');return;}
    /* Shorthand like "radarr.svg" or "radarr" — resolve and preview immediately */
    if(v&&!v.includes('/')){
      siurl=v;updPrev();
      /* Also search CDN */
      clearTimeout(t);
      t=setTimeout(async()=>{
        const q=v.replace(/\.(svg|png)$/i,'');
        try{const d=await ag(`/api/icons/search?q=${encodeURIComponent(q)}`);showIPRes(d.results||[],v);}
        catch{rs.classList.remove('open');}
      },300);
      return;
    }
    clearTimeout(t);if(!v){rs.classList.remove('open');return;}
    t=setTimeout(async()=>{
      try{const d=await ag(`/api/icons/search?q=${encodeURIComponent(v)}`);showIPRes(d.results||[],v);}
      catch{rs.classList.remove('open');}
    },300);
  };

  /* Upload handler */
  const upInput=document.getElementById('ip-upload');
  const upBtn=document.getElementById('ip-upload-lbl');
  /* Explicit click handler — more reliable than a <label> wrapping the input,
     especially since the button text is swapped during upload. */
  if(upBtn&&upInput){
    upBtn.onclick=()=>upInput.click();
    upInput.onchange=async()=>{
      const file=upInput.files[0];if(!file)return;
      const origText=upBtn.textContent;
      upBtn.textContent='↑ Uploading…';
      try{
        const form=new FormData();form.append('icon',file,file.name);
        const r=await fetch('/api/icons/upload',{method:'POST',body:form});
        const d=await r.json();
        if(!r.ok)throw new Error(d.error||'Upload failed');
        /* Refresh local icon manifest so resolveIcon sees the new file */
        await loadLocalIcons();
        siurl=d.filename;
        const ipIn=document.getElementById('ip-in');
        if(ipIn)ipIn.value=d.filename;
        updPrev();
        toast(`Uploaded ${d.filename}`);
      }catch(e){toast('Upload failed: '+e.message,'err');}
      finally{upBtn.textContent=origText;upInput.value='';}
    };
  }

  document.addEventListener('click',e=>{if(!document.getElementById('ipw')?.contains(e.target))rs?.classList.remove('open');});
}
function showIPRes(list, rawInput){
  const rs=document.getElementById('iprs');if(!rs)return;rs.innerHTML='';
  /* Show CDN matches */
  list.forEach(ic=>{
    const r=document.createElement('button');r.type='button';r.className='ipr';
    const img=document.createElement('img');img.alt='';img.src=ic.svgUrl;img.onerror=()=>{img.src=ic.pngUrl;};
    const sp=document.createElement('span');sp.textContent=ic.name;r.append(img,sp);
    r.onclick=()=>{siurl=ic.svgUrl;document.getElementById('ip-in').value=ic.svgUrl;updPrev();rs.classList.remove('open');};
    rs.appendChild(r);
  });
  /* If no CDN matches but input looks like a filename, offer to use it as local/CDN icon */
  if(!list.length&&rawInput&&!rawInput.includes('/')){
    const val=rawInput.trim();
    const srcs=iconChain(val);
    if(!srcs.length){rs.classList.remove('open');return;}
    const r=document.createElement('button');r.type='button';r.className='ipr';
    const img=document.createElement('img');img.alt='';
    img.style.cssText='width:24px;height:24px;object-fit:contain;';
    let step=0;
    img.src=srcs[0];
    img.onerror=()=>{step++;if(step<srcs.length)img.src=srcs[step];else{img.onerror=null;img.src='';img.style.display='none';}};
    const sp=document.createElement('span');sp.textContent=val;r.append(img,sp);
    r.onclick=()=>{siurl=val;document.getElementById('ip-in').value=val;updPrev();rs.classList.remove('open');};
    rs.appendChild(r);
  }
  if(rs.children.length)rs.classList.add('open');
  else rs.classList.remove('open');
}
function updPrev(){
  const p=document.getElementById('ipv');if(!p)return;
  p.style.background=rc(scol);
  if(!siurl){const l=document.getElementById('f-lbl')?.value||'?';p.innerHTML=`<span>${l[0]?.toUpperCase()||'?'}</span>`;return;}
  const fallbacks=iconChain(siurl);
  if(!fallbacks.length){const l=document.getElementById('f-lbl')?.value||'?';p.innerHTML=`<span>${l[0]?.toUpperCase()||'?'}</span>`;return;}
  let step=0;
  const img=document.createElement('img');
  img.style.cssText='width:30px;height:30px;object-fit:contain;';
  img.alt='';
  img.onerror=()=>{step++;if(step<fallbacks.length){img.src=fallbacks[step];}else{
    const l=document.getElementById('f-lbl')?.value||'?';
    p.innerHTML=`<span>${l[0]?.toUpperCase()||'?'}</span>`;
  }};
  img.src=fallbacks[0];
  p.innerHTML='';p.appendChild(img);
}

/* HSL <-> hex helpers for the custom slider picker */

async function testPing(){
  const url=document.getElementById('hc-ping')?.value?.trim();
  const st=document.getElementById('hc-ping-status');
  if(!url){st.textContent='Enter a URL first.';return;}
  st.textContent='Testing…';
  const skipTls=document.getElementById('f-skip-tls')?.checked||false;
  try{const r=await ap('/api/ping',{url,skipTls});
    st.textContent=r.ok?`✓ Reachable (${r.status})`:`✗ HTTP ${r.status}`;}
  catch(e){st.textContent='✗ '+e.message;}
}

const parseKV=t=>{const r={};for(const l of t.split('\n')){const i=l.indexOf('=');if(i<1)continue;r[l.slice(0,i).trim()]=l.slice(i+1).trim();}return r;};
function collectNums(obj,path='',out=[]){
  if(obj==null)return out;
  if(typeof obj==='number'){out.push({path:path||'(root)',value:obj});return out;}
  if(Array.isArray(obj)){
    const countPath=path?`${path}.$count`:'$count';
    out.push({path:countPath,value:obj.length,label:`Total count (${obj.length} items)`});
    const sample=obj.find(i=>i&&typeof i==='object'&&!Array.isArray(i));
    if(sample){
      const seen={};
      for(const[field,val]of Object.entries(sample)){
        if(typeof val==='boolean'){
          for(const bval of[true,false]){
            const n=obj.filter(i=>i&&i[field]===bval).length;
            if(n>0){const p=`${path?path+'.':''}filter(${field}==${bval}).count`;
              if(!seen[p]){seen[p]=1;out.push({path:p,value:n,label:`${field} = ${bval}`,computed:true});}}
          }
        }else if(typeof val==='string'&&val.length<32){
          const distinct=[...new Set(obj.map(i=>i&&i[field]).filter(v=>typeof v==='string'))];
          for(const dval of distinct.slice(0,8)){
            const n=obj.filter(i=>i&&i[field]===dval).length;
            const p=`${path?path+'.':''}filter(${field}==${dval}).count`;
            if(!seen[p]){seen[p]=1;out.push({path:p,value:n,label:`${field} = "${dval}"`,computed:true});}
          }
        }else if(typeof val==='number'){
          const total=obj.reduce((s,i)=>s+(typeof i?.[field]==='number'?i[field]:0),0);
          const p=`${path?path+'.':''}sum(${field})`;
          if(!seen[p]){seen[p]=1;out.push({path:p,value:total,label:`Sum of ${field}`,computed:true});}
        }
      }
    }
    obj.slice(0,5).forEach((v,i)=>collectNums(v,path?`${path}[${i}]`:`[${i}]`,out));
    return out;
  }
  if(typeof obj==='object'){for(const[k,v]of Object.entries(obj))collectNums(v,path?`${path}.${k}`:k,out);}
  return out;
}
async function fetchBadge(){
  const url=document.getElementById('f-burl')?.value?.trim();
  const st=document.getElementById('bst');
  if(!url){if(st)st.style.cssText='margin-top:4px;color:var(--dm)';if(st)st.textContent='Enter a URL first.';return;}
  if(st){st.style.cssText='margin-top:4px;color:var(--dm)';st.textContent='Fetching…';}
  const btn=document.getElementById('bfetch');
  if(btn)btn.disabled=true;
  try{
    const params=parseKV(document.getElementById('f-bpar')?.value||'');
    const headers=parseKV(document.getElementById('f-bhdr')?.value||'');
    const skipTls=document.getElementById('f-skip-tls')?.checked||false;
    const r=await ap('/api/badge-proxy',{url,params,headers,skipTls});
    fnums=r.numbers||[];
    if(st){
      st.style.cssText='margin-top:4px;color:#34c759';
      if(!fnums.length) st.textContent='✓ Connected, no numeric values found';
      else st.textContent=`✓ Found ${fnums.length} value${fnums.length!==1?'s':''}`;
    }
    ['bprow','auth-row-wrap','poll-row'].forEach(id=>document.getElementById(id)?.classList.remove('bprow-hidden'));
    if(fnums.length) renderBadgeList(fnums,false);
  }catch(e){
    if(st){
      const msg=e.message||'';
      const isNetwork=msg.includes('ECONNREFUSED')||msg.includes('ENOTFOUND')||msg.includes('ETIMEDOUT')||msg.includes('fetch')||msg.includes('network')||msg.includes('502')||msg.includes('503');
      const isAuth=msg.includes('401')||msg.includes('403')||msg.includes('Unauthori')||msg.includes('Forbidden');
      if(isNetwork){
        st.style.cssText='margin-top:4px;color:#ff9f0a';
        st.textContent="Can't reach this address from Docker. Try using the container name, e.g. http://container-name:8181/api/v2";
      }else if(isAuth){
        st.style.cssText='margin-top:4px;color:#ff9f0a';
        st.textContent='Authentication required. Enable the Authentication toggle below and add your API key.';
        /* Auto-toggle auth on as a hint */
        const authCb=document.getElementById('auth-en');
        const authSub=document.getElementById('auth-sub');
        if(authCb&&!authCb.checked){
          authCb.checked=true;
          if(authSub)authSub.classList.add('open');
        }
      }else{
        st.style.cssText='margin-top:4px;color:#ff453a';
        st.textContent='✗ '+msg;
      }
    }
  }finally{
    if(btn)btn.disabled=false;
  }
}
function renderBadgeList(nums,existingOnly,query=''){
  const list=document.getElementById('blist');if(!list)return;list.innerHTML='';
  if(existingOnly&&!nums.length){
    /* Issue #8: saved paths already shown in #bst hint — don't repeat here */
    if(spaths.length){
      spaths.forEach(p=>{
        const it=document.createElement('div');it.className='bi on';
        it.innerHTML=`<div class="bck"></div><div class="binfo"><div class="blabel">${esc(p)}</div><div class="bpath">${esc(p)}</div></div>`;
        it.onclick=()=>{const i=spaths.indexOf(p);if(i>=0){spaths.splice(i,1);it.classList.remove('on');}else{spaths.push(p);it.classList.add('on');}};
        list.appendChild(it);
      });
    }
    return;
  }
  if(!nums.length){
    const e=document.createElement('div');
    e.style.cssText='padding:8px 12px;font-size:13px;color:var(--dm)';
    e.textContent='No numeric values in response.';
    list.appendChild(e);return;
  }
  const q=query.toLowerCase().trim();
  const filtered=q?nums.filter(n=>(n.label||n.path).toLowerCase().includes(q)):nums;
  if(!filtered.length){
    const e=document.createElement('div');
    e.style.cssText='padding:8px 12px;font-size:13px;color:var(--dm)';
    e.textContent='No matches.';
    list.appendChild(e);return;
  }
  const direct=filtered.filter(n=>!n.computed);
  const computed=filtered.filter(n=>n.computed);
  const addItem=({path,value,label})=>{
    const it=document.createElement('div');it.className='bi'+(spaths.includes(path)?' on':'');
    const displayLabel=label||path;
    it.innerHTML=`<div class="bck"></div><div class="binfo"><div class="blabel">${esc(displayLabel)}</div><div class="bpath">${esc(path)}</div></div><div class="bval">${value}</div>`;
    it.onclick=()=>{const i=spaths.indexOf(path);if(i>=0){spaths.splice(i,1);it.classList.remove('on');}else{spaths.push(path);it.classList.add('on');}};
    list.appendChild(it);
  };
  if(direct.length){
    if(computed.length&&!q){const s=document.createElement('div');s.className='bsep';s.textContent='Values';list.appendChild(s);}
    direct.forEach(addItem);
  }
  if(computed.length){
    if(!q){const s=document.createElement('div');s.className='bsep';s.textContent='Computed from array';list.appendChild(s);}
    computed.forEach(addItem);
  }
}

function openFolderPicker(appId,targetFolderId=null){
  const trigger=document.activeElement;
  const folders=items.filter(i=>i.type==='folder');
  const currentFolder=folders.find(f=>(f.children||[]).includes(appId));
  const appItem=items.find(i=>i.id===appId);
  const appName=appItem?.label||appId;

  document.getElementById('folder-picker-ov')?.remove();

  const ov=document.createElement('div');ov.id='folder-picker-ov';ov.className='fp-ov';
  const box=document.createElement('div');box.className='fp-box';
  box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','fp-hdr');

  const hdr=document.createElement('div');hdr.className='fp-hdr';hdr.id='fp-hdr';
  hdr.textContent=appId?`Move "${appName}" to folder`:'Add app to folder';

  const list=document.createElement('div');list.className='fp-list';

  const close=()=>{document.removeEventListener('keydown',onKey);ov.remove();if(trigger&&trigger.focus)trigger.focus();};
  const trap=trapFocus(box);
  const onKey=e=>{if(e.key==='Escape'){e.preventDefault();close();}else trap(e);};

  const rowBtn=(cls,onAct)=>{const b=document.createElement('button');b.type='button';
    b.className='fp-row'+(cls?' '+cls:'');b.onclick=onAct;return b;};

  if(targetFolderId){
    const tf=folders.find(f=>f.id===targetFolderId);
    const available=tf?items.filter(i=>i.type==='app'&&!i.dock&&!(tf.children||[]).includes(i.id)):[];
    if(!available.length){
      const em=document.createElement('div');em.className='fp-empty';
      em.textContent='All apps are already in this folder.';list.appendChild(em);
    }
    available.forEach(app=>{
      const b=rowBtn('',()=>{
        items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==app.id);});
        if(!tf.children)tf.children=[];tf.children.push(app.id);save();close();});
      const ri=document.createElement('span');ri.className='fp-ic';ri.style.background=rc(app.color);
      if(app.iconUrl){const img=document.createElement('img');img.alt='';img.src=resolveIcon(app.iconUrl);ri.appendChild(img);}
      else ri.textContent=(app.label||'?')[0];
      const nm=document.createElement('span');nm.className='fp-nm';nm.textContent=app.label||app.id;
      b.append(ri,nm);list.appendChild(b);
    });
  }else{
    const none=rowBtn(currentFolder?'muted':'cur',()=>{
      items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==appId);});
      save();close();});
    const ns=document.createElement('span');ns.textContent='No folder';none.append(ns);list.appendChild(none);

    folders.forEach(f=>{
      const cur=currentFolder?.id===f.id;
      const b=rowBtn(cur?'cur':'',()=>{
        items.forEach(ff=>{if(ff.type==='folder')ff.children=(ff.children||[]).filter(id=>id!==appId);});
        if(!f.children)f.children=[];if(!f.children.includes(appId))f.children.push(appId);save();close();});
      const nm=document.createElement('span');nm.textContent='📁 '+f.label;
      const chk=document.createElement('span');chk.className='fp-chk';if(cur)chk.textContent='✓';
      b.append(nm,chk);list.appendChild(b);
    });

    const divider=document.createElement('div');divider.className='div';divider.style.margin='4px 8px';list.appendChild(divider);

    const nr=rowBtn('accent',()=>{
      const name=prompt('Folder name:');if(!name?.trim())return;
      const fid='folder_'+Date.now();
      items.push({id:fid,type:'folder',label:name.trim(),children:[appId]});
      items.forEach(f=>{if(f.type==='folder'&&f.id!==fid)f.children=(f.children||[]).filter(id=>id!==appId);});
      save();close();});
    const nrs=document.createElement('span');nrs.textContent='+ Create new folder';nr.append(nrs);list.appendChild(nr);
  }

  const footer=document.createElement('div');footer.className='fp-foot';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='btn bg sm';
  cancel.textContent='Cancel';cancel.onclick=close;footer.appendChild(cancel);

  ov.onclick=e=>{if(e.target===ov)close();};
  document.addEventListener('keydown',onKey);
  box.append(hdr,list,footer);ov.appendChild(box);document.body.appendChild(ov);
  (list.querySelector('button')||cancel).focus();
}

async function doSave(orig){
  try{
    let item;
    if(ctype==='widget'){
      /* Generate clean IDs: only letters, digits and underscores */
      const cleanId=s=>s.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'widget';
      const wlabel=_wlabel.trim()||(_wtype==='stats'?(_wstatsSubType==='disk-health'?'Disk Health':'System Summary'):WIDGET_TYPES[_wtype]?.label||'Widget');
      if(_autoForm && _autoFormType===_wtype && _widgetReg[_wtype] && !_widgetReg[_wtype].customEditor){
        const missing=_autoForm.validate();
        if(missing.length){ toast(missing[0]+' is required','err'); return; }
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:_wtype,
          label:wlabel,widgetSize:_wsize,widgetConfig:_autoForm.getValues()};
      }
      else if(_wtype==='weather'){
        const city=document.getElementById('wx-city')?.value?.trim()||_wweatherCfg.city;
        if(_wweatherCfg.lat===''||_wweatherCfg.lat==null){ toast('Search and select a city first','err'); return; }
        const wcfg={ city:_wweatherCfg.city||city, lat:_wweatherCfg.lat, lon:_wweatherCfg.lon, units:_wweatherCfg.units||'c' };
        if(_wweatherCfg.feelsLike) wcfg.feelsLike=true;
        const href=document.getElementById('wx-href')?.value?.trim();
        if(href) wcfg.href=href;
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'weather',
          label:wlabel,widgetSize:'small',widgetConfig:wcfg};
      }
      else if(_wtype==='custom'){
        const url=document.getElementById('f-url')?.value?.trim();
        if(!url){toast('URL required','err');return;}
        const ifo={};
        if(_iframeOpts.referrerPolicy) ifo.referrerPolicy=_iframeOpts.referrerPolicy;
        if(_iframeOpts.allow) ifo.allow=_iframeOpts.allow;
        if(_iframeOpts.allowFullscreen===false) ifo.allowFullscreen=false;
        if(_iframeOpts.refreshInterval) ifo.refreshInterval=_iframeOpts.refreshInterval;
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'custom',
          label:wlabel, widgetSize:_wsize,url};
        if(Object.keys(ifo).length) item.iframe=ifo;
      }else if(_wtype==='connections'){
        if(_wconnView==='vpn'){
          const url=(document.getElementById('vpn-url')?.value||'').trim();
          if(!url){toast('Connection URL is required','err');return;}
          const vpn={ service:_wvpnCfg.service||'gluetun', url };
          vpn.color=_wvpnCfg.color||'#30D158';
          const nm=(document.getElementById('vpn-name')?.value||'').trim();
          if(nm) vpn.name=nm; else if(_wvpnCfg.name) vpn.name=_wvpnCfg.name;
          const hf=(document.getElementById('vpn-href')?.value||'').trim();
          if(hf) vpn.href=hf; else if(_wvpnCfg.href) vpn.href=_wvpnCfg.href;
          if(vpn.service==='gluetun'){
            const k=(document.getElementById('vpn-apikey')?.value||'').trim();
            /* Only send a new key if typed; otherwise flag that one is stored so
               the server preserves it (POST /api/config merge) and the UI shows it. */
            if(k){ vpn.apiKey=k; vpn.apiKeySet=true; }
            else if(_wvpnCfg.apiKeySet){ vpn.apiKeySet=true; }
          }else{
            const tk=(document.getElementById('vpn-token')?.value||'').trim();
            if(tk){ vpn.token=tk; vpn.tokenSet=true; }
            else if(_wvpnCfg.tokenSet){ vpn.tokenSet=true; }
            else { toast('NetBird access token is required','err'); return; }
          }
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'connections',
            label:wlabel, widgetSize:_wsize, widgetConfig:{ view:'vpn', vpn }};
        } else {
          const SVC_PLAIN=['siteId','websiteId','username'], SVC_SECRET=['token','apiKey','password'];
          const services=(_wmapCfg.services||[]).filter(s=>s && s.type && (s.url||'').trim())
            .map(s=>{const o={id:s.id,type:s.type,name:(s.name||'').trim(),url:s.url.trim(),adminUrl:(s.adminUrl||'').trim(),color:s.color||'',enabled:true};
              SVC_PLAIN.forEach(k=>{ if((s[k]||'').trim()) o[k]=s[k].trim(); });
              SVC_SECRET.forEach(k=>{ if((s[k]||'').trim()) o[k]=s[k].trim(); }); /* blank → server keeps saved */
              return o;});
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'connections',
            label:wlabel, widgetSize:'medium',widgetConfig:{ view:'map', services, showLegend:_wmapCfg.showLegend!==false }};
        }
      }else if(_wtype==='backup'){
        /* Flush current DOM values into slot state before saving */
        _wbackupCfg.slots.forEach((slot,si) => {
          slot.customName = (document.getElementById(`bak-name-${si}`)?.value||'').trim();
          const defEl = document.getElementById(`bak-def-${si}`);
          if (defEl) slot.useDefault = defEl.checked;
          /* Only overwrite jobId from an enabled picker — a disabled (un-fetched)
             picker has no value and must not wipe a previously-saved selection. */
          const jv = document.getElementById(`dup-job-${si}`) || document.getElementById(`kopia-src-${si}`);
          if (jv && !jv.disabled) slot.jobId = jv.value || null;
          if(slot.provider==='duplicati'){
            slot.dupUrl    = (document.getElementById(`dup-url-${si}`)?.value||'').trim() || slot.dupUrl;
            slot.dupHref   = (document.getElementById(`dup-href-${si}`)?.value||'').trim();
            const pollEl   = document.getElementById(`dup-poll-${si}`);
            if(pollEl) slot.dupPollSec = Math.max(10,parseInt(pollEl.value||'60',10));
            const p=(document.getElementById(`dup-pass-${si}`)?.value||'').trim();
            if(p) slot.dupPass=p;
          } else if(slot.provider==='kopia'){
            slot.kopiaUrl  = (document.getElementById(`kopia-url-${si}`)?.value||'').trim() || slot.kopiaUrl;
            slot.kopiaUser = (document.getElementById(`kopia-user-${si}`)?.value||'').trim() || slot.kopiaUser;
            slot.kopiaHref = (document.getElementById(`kopia-href-${si}`)?.value||'').trim();
            const p=(document.getElementById(`kopia-pass-${si}`)?.value||'').trim();
            if(p) slot.kopiaPass=p;
          }
        });
        /* Copy the default instance's connection to every same-provider slot that
           uses the default, so the runtime resolves each slot directly. */
        if(_wsize!=='small'){
          const propagate=(prov)=>{
            const fi=_wbackupCfg.slots.findIndex(s=>s.provider===prov);
            if(fi<0) return;
            const def=_wbackupCfg.slots[fi];
            if(def.useDefault===false) return;   /* default instance opted out → no sharing */
            _wbackupCfg.slots.forEach((t,j)=>{
              if(j===fi || t.provider!==prov || t.useDefault===false) return;
              if(prov==='duplicati'){
                t.dupUrl=def.dupUrl; t.dupHref=def.dupHref; t.dupPollSec=def.dupPollSec;
                if(def.dupPass)t.dupPass=def.dupPass; t.dupPassSet=def.dupPassSet;
              } else {
                t.kopiaUrl=def.kopiaUrl; t.kopiaUser=def.kopiaUser; t.kopiaHref=def.kopiaHref;
                if(def.kopiaPass)t.kopiaPass=def.kopiaPass; t.kopiaPassSet=def.kopiaPassSet;
              }
            });
          };
          propagate('duplicati'); propagate('kopia');
        }
        /* Validate (after propagation, every provider slot has a URL) */
        for(const [si,slot] of _wbackupCfg.slots.entries()){
          if(slot.provider==='duplicati'&&!slot.dupUrl){toast(`URL required for ${['First','Second','Third'][si]||''} Duplicati instance`,'err');return;}
          if(slot.provider==='kopia'&&!slot.kopiaUrl){toast(`URL required for ${['First','Second','Third'][si]||''} Kopia instance`,'err');return;}
        }
        /* Strip runtime-only fields before saving */
        const savableSlots = _wbackupCfg.slots.map(s=>({
          provider:    s.provider,
          jobId:       s.jobId    ||null,
          customName:  s.customName||undefined,
          useDefault:  s.provider ? (s.useDefault!==false) : undefined,
          dupUrl:      s.dupUrl   ||undefined,
          dupPassSet:  s.dupPassSet||undefined,
          dupHref:     s.dupHref  ||undefined,
          dupPollSec:  s.dupPollSec!==60?s.dupPollSec:undefined,
          dupPass:     s.dupPass  ||undefined,
          kopiaUrl:    s.kopiaUrl ||undefined,
          kopiaUser:   s.kopiaUser||undefined,
          kopiaPassSet:s.kopiaPassSet||undefined,
          kopiaHref:   s.kopiaHref||undefined,
          kopiaPass:   s.kopiaPass||undefined,
        }));
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'backup',
          label:wlabel,widgetSize:_wsize,widgetConfig:{slots:savableSlots}};

      }else{
        /* stats — slot values are kept live in _wslots by the row commit handlers */
        const slots=_wslots.slice(0,3).map((s)=>{
          const slotColor=s.color||undefined;
          if(s.type==='disk') return {type:'disk',primary:s.primary||'/',secondary:s.secondary||undefined,color:slotColor};
          if(s.type==='temp') return {type:'temp',thermalZone:Number.isInteger(s.thermalZone)?s.thermalZone:0,color:slotColor};
          return {type:s.type,color:slotColor};
        });
        _wnet.url      = document.getElementById('net-url')?.value?.trim()||'';
        _wnet.provider = _wnet.provider || 'myspeed';
        const newPass  = document.getElementById('net-pass')?.value||'';
        if (newPass) _wnet.myspeedPass = newPass;
        /* strip passSet flag from saved config — only real pass is stored */
        const netToSave = {..._wnet};
        delete netToSave.myspeedPassSet;

        if (_wstatsSubType === 'disk-health') {
          const prov = (document.getElementById('dh-prov')?.value) || _wdiskCfg.diskProvider || 'scrutiny';
          const dhUrl  = document.getElementById('dh-url')?.value?.trim()  || '';
          const dhHref = document.getElementById('dh-href')?.value?.trim() || '';
          const wcfg = { widgetSubType:'disk-health', diskProvider:prov, bays:_wdiskCfg.bays };

          if (prov === 'truenas') {
            const u = dhUrl || _wdiskCfg.truenasUrl;
            if (!u) { toast('TrueNAS URL is required','err'); return; }
            wcfg.truenasUrl  = u;
            wcfg.truenasHref = dhHref || undefined;
            /* Send the key only if newly entered; otherwise the server re-merges the stored one. */
            const k = document.getElementById('dh-key')?.value?.trim();
            if (k) wcfg.truenasKey = k;
          } else {
            const u = dhUrl || _wdiskCfg.scrutinyUrl;
            if (!u) { toast('Scrutiny URL is required','err'); return; }
            wcfg.scrutinyUrl  = u;
            wcfg.scrutinyHref = dhHref || undefined;
          }

          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel,widgetSize:_wsize,widgetConfig:wcfg};
        } else {
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel, widgetSize:_wsize,widgetConfig:{widgetSubType:_wstatsSubType,slots,network:netToSave}};
        }
      }
    }else if(ctype==='folder'){
      const label=document.getElementById('f-fname')?.value?.trim();
      if(!label){toast('Name required','err');return;}
      const cleanId=s=>s.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'folder';
      /* Prevent adding an app to multiple folders — remove it from any existing folder first */
      const children=[...document.querySelectorAll('#folder-apps-list li[aria-selected="true"]')].map(li=>li.dataset.val);
      if(!orig){
        children.forEach(cid=>{
          items.forEach(it=>{
            if(it.type==='folder'&&it.children?.includes(cid))
              it.children=it.children.filter(x=>x!==cid);
          });
        });
      }
      item={id:orig?.id||cleanId(label)+'_'+Date.now(),type:'folder',label,children};
    }else{
      const label=document.getElementById('f-lbl')?.value?.trim();
      const href=document.getElementById('f-href')?.value?.trim();
      if(!label){toast('Name required','err');return;}
      if(!href){toast('URL required','err');return;}
      const cleanId=s=>s.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'app';
      const hcEn=document.getElementById('hc-en')?.checked;
      const isPing=document.getElementById('hc-type-ping')?.checked;
      const hcCon=isPing?'':(document.getElementById('hc-con')?.value?.trim()||'');
      const hcPing=isPing?(document.getElementById('hc-ping')?.value?.trim()||''):'';
      const skipTlsVerify=document.getElementById('f-skip-tls')?.checked||false;
      const actEn=document.getElementById('act-en')?.checked;
      const actUrl=document.getElementById('f-burl')?.value?.trim()||'';
      const actInt=Math.min(3600,Math.max(10,parseInt(document.getElementById('f-bint')?.value||'30',10)));
      const actParams=parseKV(document.getElementById('f-bpar')?.value||'');
      const actHeaders=parseKV(document.getElementById('f-bhdr')?.value||'');
      /* Activity badge custom display (color from the color control) */
      const actColor=document.getElementById('act-col-val')?.value||'#0289ff';
      const custUnit=document.getElementById('bcust-unit')?.value?.trim()||'';
      const DEFCOL='#0289ff';
      const customObj=(actColor&&actColor!==DEFCOL)||custUnit?{
        color:actColor&&actColor!==DEFCOL?actColor:undefined,
        unit:custUnit||undefined,
      }:undefined;
      /* Static (fixed label) badge */
      const staticEn=document.getElementById('static-en')?.checked||false;
      const staticLabel=document.getElementById('f-static-label')?.value?.trim()||'';
      const staticColor=document.getElementById('static-col-val')?.value||'#0289ff';
      const staticBadgeObj=staticEn&&staticLabel?{enabled:true,label:staticLabel.slice(0,10),color:staticColor||'blue'}:undefined;
      const finalIcon=siurl;
      item={
        id:orig?.id||cleanId(label)+'_'+Date.now(),
        type:'app',label,href,
        iconUrl:finalIcon,color:scol||'dark',
        dock:document.getElementById('f-dock')?.checked||false,
        skipTlsVerify:skipTlsVerify||undefined,
        monitoring:{
          healthcheck:{enabled:hcEn&&(!!hcCon||!!hcPing),container:hcCon,pingUrl:hcPing},
          activity:{enabled:actEn&&!!actUrl,url:actUrl,
            params:Object.keys(actParams).length?actParams:undefined,
            headers:Object.keys(actHeaders).length?actHeaders:undefined,
            extract:spaths.length===1?spaths[0]:spaths.length>1?spaths.map(p=>({path:p})):undefined,
            interval:Math.max(10,actInt),
            custom:customObj},
          staticBadge:staticBadgeObj,
        },
      };
    }
    if(eid!==null)items[eid]=item;else items.push(item);
    await save();closeModal();toast(eid!==null?'Updated':'Added');
  }catch(e){toast('Error: '+e.message,'err');}
}

function loadSettings(c){
  const s=c.settings||{};
  const ld=document.getElementById('set-lbl-d');
  const lm=document.getElementById('set-lbl-m');
  if(ld){ld.checked=s.showLabels?.desktop!==false;ld.addEventListener('change',saveLabels);}
  if(lm){lm.checked=s.showLabels?.ios===true;lm.addEventListener('change',saveLabels);}
  const bg=s.background||{type:'unsplash',brightness:0.62};
  const typeEl=document.getElementById('bg-type');
  if(typeEl){
    typeEl.value=bg.type||'unsplash';
    showBgFields(bg.type||'unsplash');
    const btn=document.getElementById('bg-type-btn');
    const labels={'unsplash':'Unsplash','url':'Image URL','color':'Solid color'};
    if(btn){const tn=btn.childNodes[0];if(tn&&tn.nodeType===3)tn.textContent=labels[typeEl.value]||typeEl.value;}
    document.querySelectorAll('#bg-type-list li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===typeEl.value)));
  }
  /* Unsplash API key — fetch whether one is configured via dedicated endpoint
     (the key itself is never included in /api/config to avoid exposure) */
  const apiEl=(document.getElementById('bg-apikey-inp')||document.getElementById('bg-apikey'));
  if(apiEl){
    apiEl.placeholder='●●●●●●●●●● (configured)';
    ag('/api/settings/unsplash-key').then(d=>{
      const vEl=document.getElementById('ie-apikey-v');
      if(!d.configured){
        apiEl.placeholder='Paste your Unsplash API key';
        if(vEl)vEl.textContent='Not set';
      }else{
        if(vEl)vEl.textContent='Configured';
      }
    }).catch(()=>{});
  }
  const colEl=document.getElementById('bg-col');if(colEl)colEl.value=bg.collection||'';
  const urlEl=document.getElementById('bg-url');if(urlEl)urlEl.value=bg.url||'';
  const colorEl=document.getElementById('bg-color');if(colorEl)colorEl.value=bg.color||'';
  const brEl=document.getElementById('bg-br');
  const brVal=document.getElementById('bg-br-val');
  function updateSliderFill(el){
    if(!el)return;
    const min=parseFloat(el.min)||0.1, max=parseFloat(el.max)||1.0;
    const pct=((parseFloat(el.value)-min)/(max-min))*100;
    el.style.background=`linear-gradient(to right, var(--ac) 0%, var(--ac) ${pct}%, var(--bd-inner) ${pct}%, var(--bd-inner) 100%)`;
  }
  if(brEl){brEl.value=bg.brightness??0.62;if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);
    updateSliderFill(brEl);
    brEl.addEventListener('input',()=>{updateSliderFill(brEl);if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);});}
  document.getElementById('bg-save').addEventListener('click',saveWallpaper);

  /* Populate General inline-edit value spans (empty → greyed placeholder, no dash) */
  const _sv=(id,v,ph='')=>{const el=document.getElementById(id);if(!el)return;
    if(v){el.textContent=v;el.classList.remove('is-ph');}
    else{el.textContent=ph;el.classList.add('is-ph');}};
  _sv('ie-title-v',s.title||'Stackyard','Stackyard');
  _sv('ie-desc-v',s.description||'Stackyard · self-hosted homelab dashboard','Stackyard · self-hosted homelab dashboard');
  _sv('ie-ip-v',s.server?.hostIp,'192.168.1.100');
  _sv('ie-socket-v',s.server?.socketProxyUrl,'tcp://socket-proxy:2375');
  _sv('ie-pw-v','','Not set'); /* set below after auth check */
  /* Sync hidden input values used by save */
  const _si=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null)el.value=v;};
  _si('srv-ip',s.server?.hostIp||'');
  _si('srv-socket',s.server?.socketProxyUrl||'');
  /* Appearance */
  _sv('ie-bgcol-v',s.background?.collection,'Collection ID');
  _si('bg-col-inp',s.background?.collection||'');
  _si('bg-url-inp',s.background?.url||'');
  _si('bg-color-inp',s.background?.color||'');
  _sv('ie-bgurl-v',s.background?.url,'Image URL');
  _sv('ie-bgcolor-v',s.background?.color,'#rrggbb or any CSS color');

  const ipEl=document.getElementById('srv-ip');if(ipEl)ipEl.value=s.server?.hostIp||'';
  const dockerEnEl=document.getElementById('srv-docker-en');
  const dockerSubEl=document.getElementById('srv-docker-sub');
  const socketEl=document.getElementById('srv-socket');
  const hideHealthyRowEl=document.getElementById('srv-hide-healthy-row');
  const hideHealthyEl=document.getElementById('srv-hide-healthy');
  /* Reflect global Docker health state onto per-app hc-en if the modal is open */
  function applyGlobalHealthState(enabled){
    const hcEnEl=document.getElementById('hc-en');
    if(!hcEnEl)return;
    hcEnEl.disabled=!enabled;
    const trow=hcEnEl.closest('.trow');
    if(trow)trow.style.opacity=enabled?'':'0.45';
    if(!enabled)document.getElementById('hc-sub')?.classList.remove('open');
  }
  if(dockerEnEl){
    dockerEnEl.checked=!!(s.server?.socketProxyUrl);
    const applyDocker=v=>{
      if(dockerSubEl)dockerSubEl.classList.toggle('open',v);
      if(hideHealthyRowEl)hideHealthyRowEl.style.display=v?'':'none';
      const socketRow=document.getElementById('ie-socket');
      if(socketRow)socketRow.style.display=v?'':'none';
      const socketHint=document.getElementById('socket-hint');
      if(socketHint)socketHint.style.display=v?'':'none';
    };
    applyDocker(dockerEnEl.checked);
    dockerEnEl.addEventListener('change',()=>{
      applyDocker(dockerEnEl.checked);
      applyGlobalHealthState(dockerEnEl.checked);
    });
  }
  if(hideHealthyEl)hideHealthyEl.checked=s.server?.hideHealthyBadge!==false;
  if(socketEl)socketEl.value=s.server?.socketProxyUrl||'';
  document.getElementById('srv-save').addEventListener('click',saveServer);

  /* Wire password toggle unconditionally — doesn't depend on auth check */
  const secEnEl=document.getElementById('sec-en');
  const secSubEl=document.getElementById('sec-sub');
  const secPwEl=document.getElementById('sec-pw');
  let pwStrengthWired=false;
  function openSecSub(){
    secSubEl.classList.add('open');
    /* Wire strength meter on first open — avoids Safari input event bug
       where listeners on password fields in hidden containers don't fire */
    if(!pwStrengthWired&&secPwEl){
      pwStrengthWired=true;
      wirePasswordStrength('sec-pw','sec-pw-bars','sec-pw-hint');
    }
  }
  const secLogout=document.getElementById('sec-logout');
  const syncLogout=()=>{ if(secLogout) secLogout.classList.toggle('d-none', !secEnEl?.checked); };
  secLogout?.addEventListener('click',async()=>{
    await ap('/api/auth/logout',{}).catch(()=>{});
    location.reload();
  });
  if(secEnEl&&secSubEl){
    secEnEl.addEventListener('change',()=>{
      if(secEnEl.checked)openSecSub();
      else secSubEl.classList.remove('open');
      syncLogout();
    });
  }

  /* Load auth state from server and apply */
  ag('/api/auth/check').then(d=>{
    if(secEnEl){
      secEnEl.checked=!!(d.enabled);
      const pwRow=document.getElementById('ie-pw');
      const pwHint=document.getElementById('pw-hint-static');
      if(pwRow)pwRow.style.display=d.enabled?'':'none';
      if(pwHint)pwHint.style.display=d.enabled?'':'none';
    }
    const pwValEl=document.getElementById('ie-pw-v');
    if(pwValEl)pwValEl.textContent=d.passwordSet?'Configured':'Not set';
    syncLogout();
  }).catch(()=>{
    /* Auth check failed — toggle still works, just without pre-loaded state */
  });
}
function showBgFields(type){
  ['unsplash','url','color'].forEach(t=>{
    const el=document.getElementById(`bg-${t}-fields`);
    if(el)el.classList.toggle('d-none', t!==type);
  });
  /* Brightness dims a wallpaper image — meaningless for a solid colour,
     so it's shown only for the unsplash/url sources. */
  const brRow=document.getElementById('bg-brightness-row');
  if(brRow)brRow.classList.toggle('d-none', type==='color');
}
async function saveLabels(){
  const c=await ag('/api/config');c.settings=c.settings||{};
  c.settings.showLabels={desktop:document.getElementById('set-lbl-d')?.checked!==false,ios:document.getElementById('set-lbl-m')?.checked||false};
  await ap('/api/config',c);toast('Saved');
}
async function saveWallpaper(){
  try{
    const type=document.getElementById('bg-type')?.value||'unsplash';
    const br=parseFloat(document.getElementById('bg-br')?.value||'0.62');
    const bg={type,brightness:br};
    if(type==='unsplash'){
      bg.collection=(document.getElementById('bg-col-inp')||document.getElementById('bg-col'))?.value?.trim()||'';
    }
    else if(type==='url'){bg.url=(document.getElementById('bg-url-inp')||document.getElementById('bg-url'))?.value?.trim()||'';}
    else if(type==='color'){bg.color=(document.getElementById('bg-color-inp')||document.getElementById('bg-color'))?.value?.trim()||'';}
    /* Save main config first */
    const c=await ag('/api/config');c.settings=c.settings||{};c.settings.background=bg;
    await ap('/api/config',c);
    /* Save Unsplash key separately AFTER main config — the GET /api/config strips the key,
       so saving it before would cause the subsequent config write to overwrite it with nothing */
    if(type==='unsplash'){
      const keyVal=(document.getElementById('bg-apikey-inp')||document.getElementById('bg-apikey'))?.value?.trim()||'';
      if(keyVal) await ap('/api/settings/unsplash-key',{apiKey:keyVal});
    }
    toast('Wallpaper saved');
  }catch(e){toast('Save failed: '+e.message,'err');}
}
async function saveServer(){
  try{
    const c=await ag('/api/config');c.settings=c.settings||{};
    const dockerEnabled=document.getElementById('srv-docker-en')?.checked||false;
    const socketUrl=document.getElementById('srv-socket')?.value?.trim()||'';
    /* Title / description from inline-edit value spans (committed on blur).
       A greyed placeholder (.is-ph) means empty, so it is not saved. */
    const titleEl=document.getElementById('ie-title-v');
    const descEl=document.getElementById('ie-desc-v');
    const titleV=titleEl&&!titleEl.classList.contains('is-ph')?titleEl.textContent.trim():'';
    const descV=descEl&&!descEl.classList.contains('is-ph')?descEl.textContent.trim():'';
    if(titleV) c.settings.title=titleV;
    if(descV) c.settings.description=descV;
    c.settings.server={
      ...c.settings.server,
      hostIp:document.getElementById('srv-ip')?.value?.trim()||'',
      socketProxyUrl:dockerEnabled?socketUrl:'',
      hideHealthyBadge:document.getElementById('srv-hide-healthy')?.checked!==false,
    };
    await ap('/api/config',c);

    /* Handle password and auth toggle */
    const pw=document.getElementById('sec-pw')?.value||'';
    const enabled=document.getElementById('sec-en')?.checked||false;
    if(pw){
      const {ok,label}=pwStrength(pw);
      if(!ok){toast('Password too weak: '+label,'err');return;}
      await ap('/api/auth/set-password',{password:pw});
      const pwEl=document.getElementById('sec-pw');
      if(pwEl){pwEl.value='';pwEl.placeholder='●●●●●●●●●● (configured)';}
    }
    await ap('/api/auth/toggle',{enabled});
    toast('Saved');
  }catch(e){toast('Save failed: '+e.message,'err');}
}

/* ══ Nav ══ */
function initNav(){
  const links=document.querySelectorAll('.nl, .mtab');
  const STORE='admin_sec';
  const stored=localStorage.getItem(STORE)||'general';
  function show(id){
    document.querySelectorAll('.sec').forEach(s=>{s.hidden=s.id!=='sec-'+id;});
    links.forEach(l=>l.classList.toggle('active',l.dataset.sec===id));
    localStorage.setItem(STORE,id);
  }
  links.forEach(l=>l.addEventListener('click',()=>show(l.dataset.sec)));
  show(stored);
}

/* ══ Inline edit rows ══
   Each .ie-row has: .rl (label), .rv (value span), .pe (pencil btn).
   On pencil click: hide .rv and .pe, insert <input> in place, focus it.
   On blur/Enter: restore value span with new text, remove input. */
function initInlineEdit(rowId,inputId,{type='text',placeholder='',onCommit}={}){
  const row=document.getElementById(rowId);
  const inp=document.getElementById(inputId);
  if(!row||!inp) return;
  const valEl=row.querySelector('.rv');
  const pen=row.querySelector('.pe');
  if(!valEl||!pen) return;

  /* Move input into row */
  inp.type=type;
  inp.placeholder=placeholder;
  inp.className='row-inp';
  inp.style.display='';
  inp.style.cssText='';
  row.insertBefore(inp,pen);

  function open(){
    if(row.classList.contains('editing')) return;
    row.classList.add('editing');
    inp.value=valEl.classList.contains('is-ph')?'':valEl.textContent;
    inp.focus();inp.select?.();
  }
  function commit(){
    if(!row.classList.contains('editing')) return;
    row.classList.remove('editing');
    const v=inp.value.trim();
    if(v){ valEl.textContent=v; valEl.classList.remove('is-ph'); }
    else { valEl.textContent=placeholder||''; valEl.classList.add('is-ph'); }
    onCommit?.(v);
  }

  pen.addEventListener('click',open);
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();commit();}
    if(e.key==='Escape'){e.preventDefault();row.classList.remove('editing');}
  });
}

/* Secret inline-edit row: shows Configured/Not set, edits via a password field,
   never renders the plaintext back. Input keeps its id/value for the save path. */
function _secretRow(host, {rowId, inpId, label, req, opt, isSet, hidden, onInput}){
  const disp = isSet ? 'Configured' : 'Not set';
  host.insertAdjacentHTML('beforeend', `<div class="row ie-row" id="${rowId}"${hidden?' hidden':''}><span class="rl">${label}${req?' <span class="req">*</span>':''}${opt?' <span class="opt-span">(optional)</span>':''}</span><span class="rv${isSet?'':' is-ph'}">${disp}</span><input id="${inpId}" type="password" autocomplete="new-password" style="display:none"><button class="pe" type="button" aria-label="Edit ${label}">${PE_SVG}</button></div>`);
  const row=document.getElementById(rowId), rv=row.querySelector('.rv'), inp=document.getElementById(inpId), pe=row.querySelector('.pe');
  const open=()=>{ row.classList.add('editing'); inp.style.display='block'; inp.focus(); };
  const commit=()=>{ row.classList.remove('editing'); inp.style.display='none'; const has=!!inp.value; rv.textContent=has?'New value set':disp; rv.classList.toggle('is-ph',!(has||isSet)); };
  pe.addEventListener('click',open); rv.addEventListener('click',open);
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();inp.blur();} });
  if(onInput) inp.addEventListener('input',()=>onInput(inp.value));
  return row;
}

function initAllInlineEdits(){
  initInlineEdit('ie-title','ie-input',{placeholder:'Stackyard',
    onCommit(v){document.getElementById('ie-title-v').textContent=v||'Stackyard';}});

  /* desc uses a second input — create one */
  const descInp=document.createElement('input');descInp.id='ie-desc-input';document.body.appendChild(descInp);
  initInlineEdit('ie-desc','ie-desc-input',{placeholder:'Stackyard · self-hosted homelab dashboard'});

  initInlineEdit('ie-ip','srv-ip',{placeholder:'192.168.1.100'});
  initInlineEdit('ie-socket','srv-socket',{placeholder:'tcp://socket-proxy:2375'});

  /* Password inline edit with strength meter */
  initInlineEdit('ie-pw','sec-pw',{type:'password',placeholder:'New password (min 8 chars)',
    onCommit(){
      const bars=document.getElementById('sec-pw-bars');
      const hint=document.getElementById('sec-pw-hint');
      if(bars) bars.style.display='none';
      if(hint) hint.style.display='none';
    }});
  const pwInp=document.getElementById('sec-pw');
  if(pwInp){
    pwInp.addEventListener('input',()=>{
      const bars=document.getElementById('sec-pw-bars');
      const hint=document.getElementById('sec-pw-hint');
      if(bars){bars.style.display='flex';}
      if(hint){hint.style.display='block';}
      wirePasswordStrength('sec-pw','sec-pw-bars','sec-pw-hint');
    },{once:true});
  }

  /* Appearance inline edits */
  const apiInp=document.createElement('input');apiInp.id='bg-apikey-inp';document.body.appendChild(apiInp);
  initInlineEdit('ie-apikey','bg-apikey-inp',{placeholder:'Paste your Unsplash API key'});

  const colInp=document.createElement('input');colInp.id='bg-col-inp';document.body.appendChild(colInp);
  initInlineEdit('ie-bgcol','bg-col-inp',{placeholder:'AGVpqBZnzUE'});

  const urlInp=document.createElement('input');urlInp.id='bg-url-inp';urlInp.type='url';document.body.appendChild(urlInp);
  initInlineEdit('ie-bgurl','bg-url-inp',{placeholder:'https://example.com/photo.jpg'});

  const colorInp=document.createElement('input');colorInp.id='bg-color-inp';document.body.appendChild(colorInp);
  initInlineEdit('ie-bgcolor','bg-color-inp',{placeholder:'#0d1117'});
}

/* ══ Version display ══ */
async function initVersion(){
  try{
    const d=await ag('/api/version');
    const v=(d.current||d.version||'').replace(/^v/i,'');
    if(v){
      const vEl=document.getElementById('sidebar-version');
      const aEl=document.getElementById('about-version');
      if(vEl)vEl.textContent='v'+v;
      if(aEl)aEl.textContent='Version v'+v;
      if(d.updateAvailable){
        const dot=document.getElementById('about-update-dot');
        if(dot)dot.style.display='flex';
        if(aEl&&d.latest){
          const lv=String(d.latest).replace(/^v/i,'');
          aEl.innerHTML='Version v'+esc(v)+' &middot; <a href="https://github.com/SandObserver/stackyard/releases/latest" target="_blank" rel="noopener" class="upd-link">Update to v'+esc(lv)+'</a>';
        }
      }
    }
  }catch{}
}

/* ══ Password Protection toggle shows/hides password row ══ */
function initSecToggle(){
  const en=document.getElementById('sec-en');
  const pwRow=document.getElementById('ie-pw');
  const pwHint=document.getElementById('pw-hint-static');
  if(!en)return;
  function apply(on){
    if(pwRow)pwRow.style.display=on?'':'none';
    if(pwHint)pwHint.style.display=on?'':'none';
  }
  apply(en.checked);
  en.addEventListener('change',()=>apply(en.checked));
}

/* ══ Docker toggle shows/hides socket + hide-healthy rows ══ */
function initDockerToggle(){
  const en=document.getElementById('srv-docker-en');
  const hideRow=document.getElementById('srv-hide-healthy-row');
  const socketRow=document.getElementById('ie-socket');
  if(!en)return;
  function apply(on){
    if(hideRow)hideRow.style.display=on?'':'none';
    if(socketRow)socketRow.style.display=on?'':'none';
  }
  apply(en.checked);
  en.addEventListener('change',()=>apply(en.checked));
}

/* ══ Wallpaper source toggle ══ */
function initBgType(){
  const btn=document.getElementById('bg-type-btn');
  const list=document.getElementById('bg-type-list');
  const hidden=document.getElementById('bg-type');
  if(!btn||!list||!hidden) return;

  function setVal(val){
    hidden.value=val;
    const labels={'unsplash':'Unsplash','url':'Image URL','color':'Solid color'};
    /* Update only the text node, preserve the SVG chevron */
    const textNode=btn.childNodes[0];
    if(textNode&&textNode.nodeType===3) textNode.textContent=labels[val]||val;
    list.querySelectorAll('li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===val)));
    list.hidden=true;
    showBgFields(val);
    const hint=document.getElementById('bgcol-hint');
    if(hint) hint.style.display=val==='unsplash'?'':'none';
  }

  btn.addEventListener('click',e=>{e.stopPropagation();list.hidden=!list.hidden;});
  list.querySelectorAll('li').forEach(li=>{
    li.addEventListener('click',()=>setVal(li.dataset.val));
  });
  document.addEventListener('click',()=>{list.hidden=true;});

  /* sync to loadSettings value */
  const observer=new MutationObserver(()=>{});
  setVal(hidden.value||'unsplash');
}

/* ══ Dashboard Save ══ */
const dashSaveEl=document.getElementById('dash-save');
if(dashSaveEl)dashSaveEl.onclick=()=>save();

/* ══ Export/Import ══ */
document.getElementById('btn-exp').onclick=async()=>{
  try{
    const a=document.createElement('a');
    a.href=API+'/api/config/export';
    a.download='stackyard-config.json';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
  }catch(e){toast('Export failed: '+e.message,'err');}
};
document.getElementById('imp').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const d=JSON.parse(await f.text());if(!d.items)throw new Error('Invalid');
    items=d.items;await save();toast('Imported');}
  catch(e){toast('Import failed: '+e.message,'err');}
  e.target.value='';
};

document.getElementById('btn-add').onclick=()=>openModal(null);

/* ══ Bottom init ══ */
initNav();
initAllInlineEdits();
initVersion();
initSecToggle();
initDockerToggle();
initBgType();

checkAuth().then(ok => {
  if (!ok) return;
  load().catch(e=>{
    toast('Could not load config. Is the API container running? ('+e.message+')','err');
    const al=document.getElementById('al');
    if(al){
      al.innerHTML='<div style="padding:32px;text-align:center;color:rgba(255,255,255,.4);font-size:14px">'+
        'Failed to load dashboard config.<br><br>'+
        '<button onclick="location.reload()" style="padding:8px 20px;border-radius:16px;'+
        'background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);'+
        'color:#fff;cursor:pointer;font-size:14px;font-family:inherit;">Retry</button></div>';
    }
  });
});
