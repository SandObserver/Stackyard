import { LOCAL_ICONS, loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=36';
import { clr as rc, esc } from '/js/utils.js?v=37';
import { WIDGET_TYPES } from '/js/widget-types.js?v=39';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=2';

/* Admin UI — Stackyard Dashboard */
const API = '';
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
  render();
  loadSettings(c);
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
  else mt.textContent=item.href||'';
  inf.append(nm,mt);
  /* Pills */
  const pb=document.createElement('div');pb.className='rpills';
  if(item.dock)pb.innerHTML+='<span class="pill p-dk">Dock</span>';
  if(item.type==='widget')pb.innerHTML+='<span class="pill p-wg">Widget</span>';
  if(item.type==='folder')pb.innerHTML+='<span class="pill p-fl">Folder</span>';
  if(item.monitoring?.healthcheck?.enabled||item.container)pb.innerHTML+='<span class="pill p-hl">Health</span>';
  if(item.monitoring?.activity?.enabled||item.badge?.enabled)pb.innerHTML+='<span class="pill p-bg">Badge</span>';
  /* Actions */
  const ac=document.createElement('div');ac.className='ract';
  const mkMove=(dir,can)=>{const b=document.createElement('button');b.className='btn bg sm ic';
    const lbl=dir<0?'Move up':'Move down';b.title=lbl;b.setAttribute('aria-label',lbl+': '+(item.label||item.id||'item'));
    b.textContent=dir<0?'↑':'↓';b.disabled=!can;b.onclick=()=>moveRow(item,dir,{folderId,childIdx});return b;};
  if(!_filtering) ac.append(mkMove(-1,canUp),mkMove(1,canDown));
  if(item.type!=='folder'){
    const ed=document.createElement('button');ed.className='btn bg sm';ed.textContent='Edit';ed.onclick=()=>openModal(idx);
    ac.append(ed);
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
function _a11yFields(root){
  if(!root)return;
  root.querySelectorAll('.tog input[type=checkbox]').forEach(inp=>{
    if(inp.getAttribute('aria-label'))return;
    const row=inp.closest('.trow')||inp.closest('.fr')||(inp.parentElement&&inp.parentElement.parentElement);
    const lbl=row&&row.querySelector('.tlbl');
    if(lbl&&lbl.textContent.trim()) inp.setAttribute('aria-label',lbl.textContent.trim());
  });
  let uid=0;
  root.querySelectorAll('.fr').forEach(fr=>{
    const lbl=fr.querySelector('label');
    const ctl=fr.querySelector('input:not([type=hidden]),select,textarea');
    if(!lbl||!ctl||lbl.getAttribute('for')||ctl.getAttribute('aria-label'))return;
    if(!ctl.id) ctl.id='fld-'+Date.now().toString(36)+'-'+(uid++);
    lbl.setAttribute('for',ctl.id);
  });
}
let _a11yObs=null;
function _ensureFieldObserver(){
  if(_a11yObs)return;
  const mb=document.getElementById('mb'); if(!mb)return;
  _a11yObs=new MutationObserver(()=>_a11yFields(document.querySelector('#ov .modal')));
  _a11yObs.observe(mb,{childList:true,subtree:true});
}
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
let _modalPrevFocus=null;
function _modalKeydown(e){
  const ov=document.getElementById('ov');
  if(!ov.classList.contains('open'))return;
  if(e.key==='Escape'){ e.preventDefault(); closeModal(); return; }
  if(e.key!=='Tab')return;
  const f=[...ov.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
  if(!f.length)return;
  const first=f[0],last=f[f.length-1];
  if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
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

function buildTypeSwitch(item){
  const container=document.getElementById('type-sw');
  if(eid!==null){container.innerHTML='';container.className='';return;}
  container.className='active';
  const sw=document.createElement('div');sw.className='tsw';
  ['app','widget','folder'].forEach(t=>{
    const b=document.createElement('button');b.type='button';
    b.textContent=t==='app'?'App':t==='widget'?'Widget':'Folder';
    if(t===ctype)b.classList.add('on');
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();
      if(ctype===t)return;ctype=t;
      sw.querySelectorAll('button').forEach(btn=>btn.classList.toggle('on',btn===b));
      buildFormBody(null);});
    sw.appendChild(b);
  });
  container.innerHTML='';container.appendChild(sw);
}

function buildFormBody(item){
  const body=document.getElementById('mb');body.innerHTML='';
  if(ctype==='widget')buildWidgetForm(body,item);
  else if(ctype==='folder')buildFolderForm(body,item);
  else buildAppForm(body,item);
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

    const nameDiv=document.createElement('div');nameDiv.className='fr';
  const nameLbl=document.createElement('label');nameLbl.textContent='Name';
  const nameInp=document.createElement('input');
  nameInp.className='fc';nameInp.id='f-wlabel';nameInp.type='text';
  nameInp.placeholder='My Widget';nameInp.value=_wlabel;
  nameInp.oninput=e=>{_wlabel=e.target.value;};
  nameDiv.append(nameLbl,nameInp);
  body.appendChild(nameDiv);

  const typeDiv=document.createElement('div');typeDiv.className='fr';
  typeDiv.innerHTML='<label>Widget Type</label>';
  const typeSel=document.createElement('select');typeSel.className='fc';typeSel.id='f-wtype';
  [...Object.values(_widgetReg).map(w=>[w.name,w.label]), ['custom','Custom']]
    .sort((a,b)=>a[1].localeCompare(b[1])).forEach(([t,label])=>{
      const o=document.createElement('option');o.value=t;o.textContent=label;
      if(t===_wtype) o.selected=true;
      typeSel.appendChild(o);
    });
  typeSel.onchange=()=>{ _wtype=typeSel.value; _wsize=widgetSizes(_wtype)[0]; _renderWidgetForm(body); };
  typeDiv.appendChild(typeSel);
  body.appendChild(typeDiv);

  /* GitHub view is now a field in the registry auto-editor (githubView). */

  /* Clock style is now a field in the registry auto-editor (clockStyle). */

  /* Connections view chips (Map / VPN) — like github's view switch */
  if(_wtype==='connections'){
    const cvDiv=document.createElement('div');cvDiv.className='fr';
    cvDiv.innerHTML='<label>View</label>';
    const cvRow=document.createElement('div');cvRow.className='wtype-row';
    cvRow.setAttribute('role','group');cvRow.setAttribute('aria-label','Connections view');
    [['map','Map'],['vpn','VPN']].forEach(([v,l])=>{
      const b=document.createElement('button');b.type='button';
      b.className='wchip'+(v===_wconnView?' on':'');
      b.setAttribute('aria-pressed',String(v===_wconnView));
      b.textContent=l;
      b.onclick=()=>{ _wconnView=v; if(v==='map')_wsize='medium'; _renderWidgetForm(body); };
      cvRow.appendChild(b);
    });
    cvDiv.appendChild(cvRow);body.appendChild(cvDiv);
  }

    const sizeDiv=document.createElement('div');sizeDiv.className='fr';
  sizeDiv.innerHTML='<label>Size</label>';
  const sizeRow=document.createElement('div');sizeRow.className='wtype-row';sizeRow.setAttribute('role','group');sizeRow.setAttribute('aria-label','Widget size');
  /* Only render sizes this widget actually supports (no greyed-out chips).
     Contributions view further restricts github to small/medium. */
  const _ghContrib=(_wtype==='github'&&(_wAutoCfg.githubView||'prs')==='contributions');
  let _sizeOpts=widgetSizes(_wtype).filter(s=>!(_ghContrib&&(s==='large'||s==='xlarge')));
  if(_wtype==='connections') _sizeOpts = (_wconnView==='map') ? ['medium'] : ['small','medium'];
  if(!_sizeOpts.includes(_wsize)) _wsize=_sizeOpts.includes('medium')?'medium':_sizeOpts[0];
  _sizeOpts.forEach(s=>{
    const b=document.createElement('button');b.type='button';
    b.className='wchip'+(s===_wsize?' on':'');b.textContent=SIZE_LABELS[s];
    b.setAttribute('aria-pressed',String(s===_wsize));
    b.onclick=()=>{
      _wsize=s;
      sizeRow.querySelectorAll('.wchip').forEach(c=>{c.classList.toggle('on',c===b);c.setAttribute('aria-pressed',String(c===b));});
      /* Re-norm backup slots when size changes so slot count matches */
      if(_wtype==='backup'){
        _wbackupCfg.slots=_normBackupSlots(_wbackupCfg.slots, s);
        const cfgBody=body.querySelector('#bak-cfg-body');
        if(cfgBody){ cfgBody.innerHTML=''; _renderBackupConfig(cfgBody); }
      }
      /* Re-render disk-health bay rows when size changes */
      if(_wtype==='stats'&&_wstatsSubType==='disk-health'){
        const cfgBody=body.querySelector('#stats-cfg-body');
        if(cfgBody){ cfgBody.innerHTML=''; _renderStatsBody(cfgBody); }
      }
    };
    sizeRow.appendChild(b);
  });
  sizeDiv.appendChild(sizeRow);
  body.appendChild(sizeDiv);

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
  /* City search → resolve to lat/long via the geocoding proxy, confirm the match. */
  const searchRow=document.createElement('div');searchRow.className='fr';
  searchRow.innerHTML=`<label for="wx-city">City</label>
    <div style="display:flex;gap:8px;align-items:center">
      <input class="fc" id="wx-city" type="text" placeholder="e.g. Ottawa" value="${esc(_wweatherCfg.city||'')}" style="flex:1;margin:0">
      <button type="button" id="wx-search" class="btn bg sm" style="flex-shrink:0;white-space:nowrap">Search</button>
    </div>`;
  body.appendChild(searchRow);

  const resWrap=document.createElement('div');resWrap.className='fr';resWrap.style.display='none';
  resWrap.innerHTML=`<label for="wx-result">Match</label><select class="fc" id="wx-result"></select>`;
  body.appendChild(resWrap);

  const msg=document.createElement('div');msg.id='wx-msg';msg.className='hint';msg.style.marginTop='-4px';body.appendChild(msg);
  if(_wweatherCfg.lat!==''&&_wweatherCfg.lat!=null){ msg.textContent='Current: '+(_wweatherCfg.city||(_wweatherCfg.lat+', '+_wweatherCfg.lon)); msg.style.color='#008932'; }

  /* Units toggle */
  const unitRow=document.createElement('div');unitRow.className='fr';
  const unitLbl=document.createElement('label');unitLbl.textContent='Units';unitLbl.setAttribute('for','wx-units');
  const unitPills=document.createElement('div');unitPills.className='wtype-row';unitPills.style.marginTop='2px';
  [['c','°C'],['f','°F']].forEach(([v,l])=>{
    const b=document.createElement('button');b.type='button';b.className='wchip'+(v===(_wweatherCfg.units||'c')?' on':'');b.textContent=l;
    b.onclick=()=>{ _wweatherCfg.units=v; unitPills.querySelectorAll('.wchip').forEach(x=>x.classList.toggle('on',x===b)); };
    unitPills.appendChild(b);
  });
  unitRow.append(unitLbl,unitPills);body.appendChild(unitRow);

  /* Feels-like toggle */
  const flRow=document.createElement('div');flRow.className='fr';
  const flLbl=document.createElement('label');flLbl.textContent='Temperature';flLbl.setAttribute('for','wx-feels');
  const flPills=document.createElement('div');flPills.className='wtype-row';flPills.style.marginTop='2px';
  [[false,'Actual'],[true,'Feels like']].forEach(([v,l])=>{
    const b=document.createElement('button');b.type='button';b.className='wchip'+(v===!!_wweatherCfg.feelsLike?' on':'');b.textContent=l;
    b.onclick=()=>{ _wweatherCfg.feelsLike=v; flPills.querySelectorAll('.wchip').forEach(x=>x.classList.toggle('on',x===b)); };
    flPills.appendChild(b);
  });
  flRow.append(flLbl,flPills);body.appendChild(flRow);

  /* Optional click-through href */
  const hrefRow=document.createElement('div');hrefRow.className='fr';
  hrefRow.innerHTML=`<label for="wx-href">Link URL <span style="opacity:.45;font-weight:400">(optional)</span></label>
    <input class="fc" id="wx-href" type="text" placeholder="https://..." value="${esc(_wweatherCfg.href||'')}">`;
  body.appendChild(hrefRow);
  hrefRow.querySelector('#wx-href').oninput=e=>{ _wweatherCfg.href=e.target.value.trim(); };

  const resultSel=resWrap.querySelector('#wx-result');
  resultSel.onchange=()=>{
    const o=resultSel.selectedOptions[0]; if(!o||!o.value) return;
    const p=JSON.parse(o.value);
    _wweatherCfg.city=p.label; _wweatherCfg.lat=p.lat; _wweatherCfg.lon=p.lon;
    msg.textContent='Selected: '+p.label; msg.style.color='#008932';
  };

  async function doSearch(){
    const q=document.getElementById('wx-city').value.trim();
    if(!q){ msg.textContent='Enter a city name.'; msg.style.color='#e9152d'; return; }
    const btn=document.getElementById('wx-search');
    btn.disabled=true;btn.textContent='…';msg.textContent='';
    try{
      const r=await fetch(`/api/geocode-proxy?q=${encodeURIComponent(q)}`);
      const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
      const results=d.results||[];
      if(!results.length){ msg.textContent='No matches found.'; msg.style.color='#ffcc00'; resWrap.style.display='none'; return; }
      resultSel.innerHTML='';
      results.forEach(p=>{
        const label=[p.name,p.admin1,p.country].filter(Boolean).join(', ');
        const opt=document.createElement('option');
        opt.value=JSON.stringify({label,lat:p.lat,lon:p.lon});
        opt.textContent=label;
        resultSel.appendChild(opt);
      });
      resWrap.style.display='';
      /* auto-select first match */
      _wweatherCfg.city=JSON.parse(resultSel.value).label;
      _wweatherCfg.lat=JSON.parse(resultSel.value).lat;
      _wweatherCfg.lon=JSON.parse(resultSel.value).lon;
      msg.textContent=results.length+' match(es), pick one.'; msg.style.color='#008932';
    }catch(e){ msg.textContent='Search failed: '+e.message; msg.style.color='#e9152d'; }
    finally{ btn.disabled=false;btn.textContent='Search'; }
  }
  searchRow.querySelector('#wx-search').onclick=doSearch;
}

function _renderStatsConfig(body){
  /* ── Sub-type pill: System Summary | Disk Health ── */
  const subRow=document.createElement('div');subRow.className='fr';
  const subLbl=document.createElement('label');subLbl.textContent='Stats Type';
  const subPills=document.createElement('div');subPills.className='wtype-row';subPills.style.marginTop='2px';
  [['system-summary','System Summary'],['disk-health','Disk Health']].forEach(([v,lbl])=>{
    const b=document.createElement('button');b.type='button';b.className='wchip'+(v===_wstatsSubType?' on':'');
    b.textContent=lbl;
    b.onclick=()=>{
      _wstatsSubType=v;
      subPills.querySelectorAll('.wchip').forEach(x=>x.classList.toggle('on',x===b));

      const cfg=body.querySelector('#stats-cfg-body');
      if(cfg){cfg.innerHTML='';_renderStatsBody(cfg);}
    };
    subPills.appendChild(b);
  });
  subRow.append(subLbl,subPills);body.appendChild(subRow);

  const cfgBody=document.createElement('div');cfgBody.id='stats-cfg-body';body.appendChild(cfgBody);
  _renderStatsBody(cfgBody);
}

function _renderStatsBody(body){
  if(_wstatsSubType==='disk-health'){
    const bayCount = _wsize==='medium' ? 10 : 4;

    /* Ensure bays array is the right length */
    while(_wdiskCfg.bays.length < bayCount) _wdiskCfg.bays.push(null);
    _wdiskCfg.bays = _wdiskCfg.bays.slice(0, bayCount);

    /* Provider toggle */
    const provRow=document.createElement('div');provRow.className='fr';
    provRow.innerHTML=`<label for="dh-prov">Source</label>
      <select class="fc" id="dh-prov">
        <option value="scrutiny">Scrutiny (per-disk SMART)</option>
        <option value="truenas">TrueNAS (per-pool health)</option>
      </select>`;
    body.appendChild(provRow);
    const provSel=provRow.querySelector('#dh-prov');
    provSel.value=_wdiskCfg.diskProvider||'scrutiny';

    /* Provider-specific field area + status message */
    const fieldArea=document.createElement('div');body.appendChild(fieldArea);
    const dhMsg=document.createElement('div');dhMsg.id='dh-msg';dhMsg.className='hint';
    dhMsg.style.marginTop='-4px';body.appendChild(dhMsg);

    /* Bay assignment section */
    const bayHd=document.createElement('div');bayHd.className='stl';
    bayHd.style.cssText='margin-top:14px;margin-bottom:8px';
    bayHd.textContent=`Bays (${bayCount})`;body.appendChild(bayHd);
    const bayRows=document.createElement('div');bayRows.id='dh-bay-rows';body.appendChild(bayRows);

    /* Available items cache: {value,label,capacity} for whichever provider loaded */
    let _items=[];

    function renderBayRows(){
      bayRows.innerHTML='';
      for(let i=0;i<bayCount;i++){
        const row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        const lbl=document.createElement('label');
        lbl.style.cssText='min-width:44px;font-size:12px;opacity:.6;flex-shrink:0;';
        lbl.textContent='Bay '+(i+1);
        const sel=document.createElement('select');
        sel.className='fc';sel.style.flex='1';sel.dataset.bay=i;
        sel.id='dh-bay-'+i; lbl.setAttribute('for', sel.id); sel.setAttribute('aria-label','Bay '+(i+1));
        const emptyOpt=document.createElement('option');
        emptyOpt.value='';emptyOpt.textContent='Empty';
        sel.appendChild(emptyOpt);
        _items.forEach(it=>{
          const opt=document.createElement('option');
          opt.value=it.value;
          const cap=it.capacity
            ?(it.capacity>=1e12?(it.capacity/1e12).toFixed(1)+' TB':(it.capacity/1e9).toFixed(0)+' GB')
            :'';
          opt.textContent=it.label+(cap?' - '+cap:'');
          sel.appendChild(opt);
        });
        /* keep current assignment even if items not yet loaded */
        const cur=_wdiskCfg.bays[i]||'';
        if(cur && !_items.some(it=>it.value===cur)){
          const opt=document.createElement('option');opt.value=cur;opt.textContent=cur;sel.appendChild(opt);
        }
        sel.value=cur;
        sel.onchange=()=>{ _wdiskCfg.bays[i]=sel.value||null; };
        row.append(lbl,sel);bayRows.appendChild(row);
      }
    }

    async function loadScrutiny(){
      const url=document.getElementById('dh-url')?.value?.trim();
      if(!url){dhMsg.textContent='Enter a Scrutiny URL first.';dhMsg.style.color='#e9152d';return;}
      _wdiskCfg.scrutinyUrl=url;
      const btn=document.getElementById('dh-load');
      btn.disabled=true;btn.textContent='Fetching…';dhMsg.textContent='';
      try{
        const r=await fetch(`/api/scrutiny-proxy?url=${encodeURIComponent(url)}`);
        if(!r.ok) throw new Error('HTTP '+r.status);
        const d=await r.json();
        _items=(d.devices||[]).map(dev=>({value:dev.device_id,label:(dev.model_name||dev.device_name),capacity:dev.capacity}));
        if(!_items.length){dhMsg.textContent='No SMART-enabled drives found.';dhMsg.style.color='#ffcc00';}
        else{dhMsg.textContent=_items.length+' drive(s) found.';dhMsg.style.color='#008932';}
        renderBayRows();
      }catch(e){ dhMsg.textContent='Failed to reach Scrutiny: '+e.message;dhMsg.style.color='#e9152d'; }
      finally{ btn.disabled=false;btn.textContent='Fetch Drives'; }
    }

    async function loadTrueNas(){
      const url=document.getElementById('dh-url')?.value?.trim();
      const key=document.getElementById('dh-key')?.value?.trim()||(_wdiskCfg.truenasKeySet?'__keep__':'');
      if(!url){dhMsg.textContent='Enter a TrueNAS URL first.';dhMsg.style.color='#e9152d';return;}
      if(!key){dhMsg.textContent='Enter an API key first.';dhMsg.style.color='#e9152d';return;}
      _wdiskCfg.truenasUrl=url;
      const btn=document.getElementById('dh-load');
      btn.disabled=true;btn.textContent='Fetching…';dhMsg.textContent='';
      try{
        if(key==='__keep__'){
          /* Key already saved; pools can only be listed with the live key, so ask for it. */
          dhMsg.textContent='Re-enter the API key to fetch pools.';dhMsg.style.color='#ffcc00';
          return;
        }
        const r=await fetch(`/api/truenas-proxy?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`);
        const d=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
        _items=(d.pools||[]).map(p=>({value:p.name,label:p.name+(p.healthy?'':' (unhealthy)'),capacity:p.capacity}));
        if(!_items.length){dhMsg.textContent='No pools found.';dhMsg.style.color='#ffcc00';}
        else{dhMsg.textContent=_items.length+' pool(s) found.';dhMsg.style.color='#008932';}
        renderBayRows();
      }catch(e){ dhMsg.textContent='Failed to reach TrueNAS: '+e.message;dhMsg.style.color='#e9152d'; }
      finally{ btn.disabled=false;btn.textContent='Fetch Pools'; }
    }

    function renderFields(){
      const prov=_wdiskCfg.diskProvider;
      _items=[];
      if(prov==='truenas'){
        fieldArea.innerHTML=`
          <div class="fr"><label for="dh-url">TrueNAS URL</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input class="fc" id="dh-url" type="text" placeholder="truenas:443" value="${esc(_wdiskCfg.truenasUrl||'')}" style="flex:1;margin:0">
              <button type="button" id="dh-load" class="btn bg sm" style="flex-shrink:0;white-space:nowrap">Fetch Pools</button>
            </div></div>
          <div class="fr"><label for="dh-key">API Key</label>
            <input class="fc" id="dh-key" type="password" placeholder="${_wdiskCfg.truenasKeySet?'•••••• (saved, re-enter to change)':'paste API key'}" value=""></div>
          <div class="fr"><label for="dh-href">Link URL <span style="opacity:.45;font-weight:400">(optional)</span></label>
            <input class="fc" id="dh-href" type="text" placeholder="https://truenas/ui/storage" value="${esc(_wdiskCfg.truenasHref||'')}"></div>`;
        fieldArea.querySelector('#dh-load').onclick=loadTrueNas;
      }else{
        fieldArea.innerHTML=`
          <div class="fr"><label for="dh-url">Scrutiny URL</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input class="fc" id="dh-url" type="text" placeholder="scrutiny:8080" value="${esc(_wdiskCfg.scrutinyUrl||'')}" style="flex:1;margin:0">
              <button type="button" id="dh-load" class="btn bg sm" style="flex-shrink:0;white-space:nowrap">Fetch Drives</button>
            </div></div>
          <div class="fr"><label for="dh-href">Link URL <span style="opacity:.45;font-weight:400">(optional)</span></label>
            <input class="fc" id="dh-href" type="text" placeholder="https://your-server:8080" value="${esc(_wdiskCfg.scrutinyHref||'')}"></div>`;
        fieldArea.querySelector('#dh-load').onclick=loadScrutiny;
      }
      renderBayRows();
    }

    provSel.onchange=()=>{ _wdiskCfg.diskProvider=provSel.value; dhMsg.textContent=''; renderFields(); };

    renderFields();
    /* Auto-fetch on open if Scrutiny URL already configured (TrueNAS needs the key re-entered). */
    if(_wdiskCfg.diskProvider!=='truenas' && _wdiskCfg.scrutinyUrl){ const b=document.getElementById('dh-load'); if(b) b.click(); }
    return;
  }

  /* ── System Summary ── */
  const hd=document.createElement('div');hd.className='stl';hd.textContent='Slot Configuration';body.appendChild(hd);
  const hint=document.createElement('div');hint.className='hint';hint.style.marginBottom='12px';
  hint.textContent='Configure up to 3 stat slots. Each slot shows a live value and chart.';body.appendChild(hint);

  _wslots.slice(0,3).forEach((slot,idx)=>{
    const card=document.createElement('div');card.className='slot-card';
    const hdr=document.createElement('div');hdr.className='slot-hd';
    const lbl=document.createElement('div');lbl.className='slot-lbl';lbl.textContent='Slot '+(idx+1);
    hdr.appendChild(lbl);card.appendChild(hdr);

    const seg=document.createElement('div');seg.className='seg';seg.setAttribute('role','group');seg.setAttribute('aria-label','Stat type');
    STAT_TYPES.forEach(t=>{
      const b=document.createElement('button');b.type='button';b.textContent=STAT_LABELS[t];
      b.classList.toggle('on',slot.type===t);
      b.onclick=()=>{
        _wslots[idx]={type:t};
        if(t==='disk'){_wslots[idx].primary='/';_wslots[idx].secondary='';}
        if(t==='temp'){_wslots[idx].thermalZone=0;}
        seg.querySelectorAll('button').forEach(btn=>btn.classList.toggle('on',btn===b));
        const existing=card.querySelector('.slot-subfields');
        if(existing)existing.remove();
        if(t==='disk')card.appendChild(_mkDiskFields(idx));
        else if(t==='temp')card.appendChild(_mkTempFields(idx));
      };
      seg.appendChild(b);
    });
    card.appendChild(seg);

    if(slot.type==='disk') card.appendChild(_mkDiskFields(idx));
    else if(slot.type==='temp') card.appendChild(_mkTempFields(idx));

    const SLOT_DEFS=['#ff2d55','#30d158','#00c0e8'];
    const SLOT_OPTS=[
      {v:'red',   hex:'#ff3838',lbl:'Red'},
      {v:'yellow',hex:'#ffcc00',lbl:'Yellow'},
      {v:'green', hex:'#30d158',lbl:'Green'},
      {v:'pink',  hex:'#ff2d55',lbl:'Pink'},
      {v:'cyan',  hex:'#00c0e8',lbl:'Cyan'},
      {v:'blue',  hex:'#0088ff',lbl:'Blue'},
      {v:'gray',  hex:'#f2f2f7',lbl:'Gray'},
    ];
    const savedSlotColor=slot.color||SLOT_DEFS[idx]||'';
    const slotColorDiv=document.createElement('div');slotColorDiv.className='fr fr-mb0 slot-color-row';
    const slotLblEl=document.createElement('label');slotLblEl.textContent='Color';slotLblEl.setAttribute('for','slot-hex-'+idx);
    const colsDiv=document.createElement('div');colsDiv.className='cols';
    SLOT_OPTS.forEach(({v,hex,lbl})=>{
      const sw=document.createElement('div');
      sw.className='co co-slot-'+v+(savedSlotColor===hex||savedSlotColor===v?' on':'');
      sw.dataset.v=hex;sw.title=lbl;
      sw.addEventListener('click',()=>{
        colsDiv.querySelectorAll('.co').forEach(s=>s.classList.remove('on'));
        sw.classList.add('on');
        hexInp.value='';
        _wslots[idx].color=hex;
      });
      colsDiv.appendChild(sw);
    });
    const hexInp=document.createElement('input');
    hexInp.className='fc';hexInp.type='text';hexInp.placeholder='#rrggbb';hexInp.id='slot-hex-'+idx;hexInp.setAttribute('aria-label','Custom colour hex');
    const isCustomSlotColor=savedSlotColor&&!SLOT_OPTS.find(o=>o.hex===savedSlotColor||o.v===savedSlotColor);
    hexInp.value=isCustomSlotColor?savedSlotColor:'';
    hexInp.addEventListener('input',()=>{
      colsDiv.querySelectorAll('.co').forEach(s=>s.classList.remove('on'));
      _wslots[idx].color=hexInp.value.trim()||SLOT_DEFS[idx];
    });
    slotColorDiv.append(slotLblEl,colsDiv,hexInp);
    card.appendChild(slotColorDiv);
    body.appendChild(card);
  });

  /* ── Slot 4: Network Speed ── */
  const netCard=document.createElement('div');netCard.className='slot-card';
  const netHdr=document.createElement('div');netHdr.className='slot-hd';
  const netLbl=document.createElement('div');netLbl.className='slot-lbl';netLbl.textContent='Slot 4: Network Speed';
  const netTog=document.createElement('label');netTog.className='tog';
  const netCb=document.createElement('input');netCb.type='checkbox';netCb.checked=_wnet.enabled;
  const netTr=document.createElement('div');netTr.className='tr';
  netTog.append(netCb,netTr);netHdr.append(netLbl,netTog);netCard.appendChild(netHdr);

  const netSub=document.createElement('div');netSub.className='sub'+((_wnet.enabled)?' open':'');

  /* Provider pill */
  const provRow=document.createElement('div');provRow.className='fr';
  const provLbl=document.createElement('label');provLbl.textContent='Provider';
  const provPills=document.createElement('div');provPills.className='chips';
  [['myspeed','MySpeed'],['speedtest-tracker','Speedtest Tracker']].forEach(([v,lbl])=>{
    const b=document.createElement('button');b.type='button';
    b.className='wchip'+((_wnet.provider||'myspeed')===v?' on':'');
    b.textContent=lbl;
    b.onclick=()=>{
      _wnet.provider=v;
      provPills.querySelectorAll('.wchip').forEach(x=>x.classList.toggle('on',x===b));
      /* Show/hide password field */
      const pf=netSub.querySelector('#net-pass-row');
      if(pf) pf.style.display=v==='myspeed'?'':'none';
    };
    provPills.appendChild(b);
  });
  provRow.append(provLbl,provPills);netSub.appendChild(provRow);

  /* URL field */
  const urlRow=document.createElement('div');urlRow.className='fr';
  const isMySpeed=(_wnet.provider||'myspeed')==='myspeed';
  urlRow.innerHTML=`<label>Service URL</label>
    <input class="fc" id="net-url" type="text"
      placeholder="${isMySpeed?'myspeed:5216':'your-server:8850'}"
      value="${esc(_wnet.url||'')}">
    <div class="hint">Container name/IP and port of your speed tracking service.</div>`;
  netSub.appendChild(urlRow);

  /* Update placeholder when provider switches */
  provPills.querySelectorAll('.wchip').forEach(b=>{
    const orig=b.onclick;
    b.onclick=()=>{
      orig?.call(b);
      const inp=netSub.querySelector('#net-url');
      if(inp) inp.placeholder=(_wnet.provider==='myspeed')?'myspeed:5216':'your-server:8850';
    };
  });

  /* MySpeed password field */
  const passRow=document.createElement('div');passRow.className='fr';passRow.id='net-pass-row';
  passRow.style.display=isMySpeed?'':'none';
  passRow.innerHTML=`<label>Password <span style="opacity:.45;font-weight:400">(optional)</span></label>
    <input class="fc" id="net-pass" type="password"
      placeholder="${_wnet.myspeedPassSet?'••••••••  (saved, leave blank to keep)':'Leave blank if no password set'}"
      autocomplete="new-password">
    <div class="hint">Only required if you set a password in MySpeed settings.</div>`;
  netSub.appendChild(passRow);

  netCb.onchange=()=>{
    _wnet.enabled=netCb.checked;
    netSub.classList.toggle('open',netCb.checked);
  };
  netCard.appendChild(netSub);
  body.appendChild(netCard);
}

function _mkDiskFields(idx){
  const df=document.createElement('div');df.className='slot-subfields disk-fields';df.style.marginTop='10px';
  df.innerHTML=`<div class="fr"><label>Primary mount path</label>
    <input class="fc slot-disk-primary" type="text" placeholder="/" value="${esc(_wslots[idx]?.primary||'/')}">
    <div class="hint">e.g. / for root SSD</div></div>
    <div class="fr fr-mb0"><label>Secondary mount path <span class="opt-span">(optional)</span></label>
    <input class="fc slot-disk-secondary" type="text" placeholder="/mnt/data" value="${esc(_wslots[idx]?.secondary||'')}">
    <div class="hint">e.g. /mnt/data for HDD</div></div>`;
  df.querySelector('.slot-disk-primary').oninput=e=>{_wslots[idx].primary=e.target.value.trim();};
  df.querySelector('.slot-disk-secondary').oninput=e=>{_wslots[idx].secondary=e.target.value.trim();};
  return df;
}

function _mkTempFields(idx){
  const df=document.createElement('div');df.className='slot-subfields temp-fields';df.style.marginTop='10px';
  const zone=Number.isInteger(_wslots[idx]?.thermalZone)?_wslots[idx].thermalZone:0;
  df.innerHTML=`<div class="fr fr-mb0">
    <label>Thermal zone <span class="opt-span">(default: 0)</span></label>
    <input class="fc slot-temp-zone zone-input" type="number" min="0" max="20" value="${zone}">
    <div class="hint">Zone 0 is correct for most systems. Only change this if the temperature shown is wrong. Check <code>/sys/class/thermal/</code> on your host to find the right zone number.</div></div>`;
  df.querySelector('.slot-temp-zone').oninput=e=>{
    _wslots[idx].thermalZone=parseInt(e.target.value,10)||0;
  };
  return df;
}

function _renderConnectionsConfig(body){
  if(_wconnView==='vpn') return _renderVpnConfig(body);
  return _renderMapConfig(body);
}

/* VPN view config — single tunnel, VPN services only (Gluetun / NetBird). */
function _renderVpnConfig(body){
  const hd=document.createElement('div');hd.className='stl';hd.textContent='VPN Configuration';body.appendChild(hd);

  const svcDiv=document.createElement('div');svcDiv.className='fr';
  svcDiv.innerHTML='<label>Service</label>';
  const svcRow=document.createElement('div');svcRow.className='wtype-row';
  svcRow.setAttribute('role','group');svcRow.setAttribute('aria-label','VPN service');
  [['gluetun','Gluetun'],['netbird','NetBird']].forEach(([v,l])=>{
    const b=document.createElement('button');b.type='button';
    b.className='wchip'+(v===_wvpnCfg.service?' on':'');
    b.setAttribute('aria-pressed',String(v===_wvpnCfg.service));
    b.textContent=l;
    b.onclick=()=>{ _wvpnCfg.service=v; _renderWidgetForm(body); };
    svcRow.appendChild(b);
  });
  svcDiv.appendChild(svcRow);body.appendChild(svcDiv);

  const nm=document.createElement('div');nm.className='fr';
  nm.innerHTML=`<label>Display name <span class="opt-span">(optional)</span></label>
    <input class="fc" id="vpn-name" type="text" placeholder="${_wvpnCfg.service==='gluetun'?'VPN':'Mesh'}" value="${esc(_wvpnCfg.name||'')}">
    <div class="hint">Overrides the title shown on the card.</div>`;
  nm.querySelector('#vpn-name').oninput=e=>{_wvpnCfg.name=e.target.value;};
  body.appendChild(nm);

  const col=document.createElement('div');col.className='fr';
  col.innerHTML='<label>Dot colour</label>';
  const sw=document.createElement('div');sw.style.cssText='display:flex;gap:10px;flex-wrap:wrap;';
  const COLORS=['#30D158','#0A84FF','#5E5CE6','#BF5AF2','#FF375F','#FF453A','#FF9F0A','#FFD60A','#40C8E0','#66D4CF'];
  if(!_wvpnCfg.color) _wvpnCfg.color='#30D158';
  const paint=(b,hex,on)=>{b.style.border='2px solid '+(on?'#fff':'transparent');b.style.boxShadow='0 0 0 1px rgba(255,255,255,.15)'+(on?(',0 0 8px '+hex):'');};
  COLORS.forEach(hex=>{
    const b=document.createElement('button');b.type='button';b.setAttribute('data-hex',hex);
    b.setAttribute('aria-label','Colour '+hex);b.setAttribute('aria-pressed',String(_wvpnCfg.color===hex));
    b.style.cssText='width:24px;height:24px;border-radius:50%;cursor:pointer;background:'+hex+';';
    paint(b,hex,_wvpnCfg.color===hex);
    b.onclick=()=>{_wvpnCfg.color=hex;sw.querySelectorAll('button').forEach(x=>{const h=x.getAttribute('data-hex');paint(x,h,h===hex);x.setAttribute('aria-pressed',String(h===hex));});};
    sw.appendChild(b);
  });
  col.appendChild(sw);body.appendChild(col);

  if(_wvpnCfg.service==='gluetun'){
    const u=document.createElement('div');u.className='fr';
    u.innerHTML=`<label>Control server URL <span class="req">*</span></label>
      <input class="fc" id="vpn-url" type="text" placeholder="http://gluetun:8000" value="${esc(_wvpnCfg.url||'')}">
`;
    u.querySelector('#vpn-url').oninput=e=>{_wvpnCfg.url=e.target.value.trim();};
    body.appendChild(u);

    const k=document.createElement('div');k.className='fr fr-mb0';
    k.innerHTML=`<label>API key <span class="opt-span">(optional)</span></label>
      <input class="fc" id="vpn-apikey" type="password" autocomplete="new-password" placeholder="${_wvpnCfg.apiKeySet?'•••••••• (stored)':'only if control server requires auth'}">
      <div class="hint">Only if the control server requires auth.</div>`;
    k.querySelector('#vpn-apikey').oninput=e=>{_wvpnCfg.apiKey=e.target.value;};
    body.appendChild(k);
  } else {
    const u=document.createElement('div');u.className='fr';
    u.innerHTML=`<label>Management API URL <span class="req">*</span></label>
      <input class="fc" id="vpn-url" type="text" placeholder="http://netbird:33073" value="${esc(_wvpnCfg.url||'')}">
      <div class="hint">The /api path is added automatically.</div>`;
    u.querySelector('#vpn-url').oninput=e=>{_wvpnCfg.url=e.target.value.trim();};
    body.appendChild(u);

    const t=document.createElement('div');t.className='fr fr-mb0';
    t.innerHTML=`<label>Access token (PAT) <span class="req">*</span></label>
      <input class="fc" id="vpn-token" type="password" autocomplete="new-password" placeholder="${_wvpnCfg.tokenSet?'•••••••• (stored)':'nbp_...'}">
`;
    t.querySelector('#vpn-token').oninput=e=>{_wvpnCfg.token=e.target.value;};
    body.appendChild(t);
  }

  const h=document.createElement('div');h.className='fr fr-mb0';h.style.marginTop='14px';
  h.innerHTML=`<label>Click URL <span class="opt-span">(optional)</span></label>
    <input class="fc" id="vpn-href" type="url" placeholder="http://your-server:8000" value="${esc(_wvpnCfg.href||'')}">
    <div class="hint">Opens when you tap the widget.</div>`;
  h.querySelector('#vpn-href').oninput=e=>{_wvpnCfg.href=e.target.value.trim();};
  body.appendChild(h);
}

function _newSvcId(){return 'svc_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
const _MAP_SVC={
  gluetun:{label:'Gluetun',adminPh:'http://your-server:3002',color:'#30D158',fields:[{key:'url',label:'Control server URL',ph:'gluetun:8000'}]},
  conduit:{label:'Conduit',adminPh:'http://your-server:9093',color:'#AF52DE',fields:[{key:'url',label:'Metrics URL',ph:'conduit:9090'}]},
  netbird:{label:'NetBird',adminPh:'http://your-server:33073',color:'#FF9F0A',fields:[{key:'url',label:'Management API URL',ph:'netbird:33073'},{key:'token',label:'Access token',ph:'NetBird PAT',secret:true}]},
  plausible:{label:'Plausible',adminPh:'http://your-server:8000',color:'#5E5CE6',fields:[{key:'url',label:'Plausible URL',ph:'plausible:8000'},{key:'siteId',label:'Site ID (domain)',ph:'example.com'},{key:'apiKey',label:'Stats API key',ph:'Bearer key',secret:true}]},
  umami:{label:'Umami',adminPh:'http://your-server:3000',color:'#64D2FF',fields:[{key:'url',label:'Umami URL',ph:'umami:3000'},{key:'websiteId',label:'Website ID',ph:'8dc7\u2026 (UUID)'},{key:'username',label:'Username',ph:'admin'},{key:'password',label:'Password',ph:'\u2022\u2022\u2022\u2022\u2022\u2022',secret:true}]},
};
function _mapSvcColorRow(svc){
  const COLORS=['#30D158','#0A84FF','#5E5CE6','#BF5AF2','#FF375F','#FF453A','#FF9F0A','#FFD60A','#40C8E0','#66D4CF'];
  const fr=document.createElement('div');fr.className='fr fr-mb0';fr.innerHTML='<label>Map colour</label>';
  const sw=document.createElement('div');sw.style.cssText='display:flex;gap:9px;flex-wrap:wrap;';
  if(!svc.color)svc.color=(_MAP_SVC[svc.type]||{}).color||'#30D158';
  const paint=(b,hex,on)=>{b.style.border='2px solid '+(on?'#fff':'transparent');b.style.boxShadow='0 0 0 1px rgba(255,255,255,.15)'+(on?(',0 0 8px '+hex):'');};
  COLORS.forEach(hex=>{const b=document.createElement('button');b.type='button';b.setAttribute('data-hex',hex);b.setAttribute('aria-label','Colour '+hex);b.setAttribute('aria-pressed',String(svc.color===hex));b.style.cssText='width:26px;height:26px;border-radius:50%;cursor:pointer;background:'+hex+';';paint(b,hex,svc.color===hex);b.onclick=()=>{svc.color=hex;sw.querySelectorAll('button').forEach(x=>{const hh=x.getAttribute('data-hex');paint(x,hh,hh===hex);x.setAttribute('aria-pressed',String(hh===hex));});};sw.appendChild(b);});
  fr.appendChild(sw);return fr;
}

function _renderMapConfig(body){
  if(!Array.isArray(_wmapCfg.services)) _wmapCfg.services=[];
  _wmapCfg.services.forEach(s=>{if(!s.id)s.id=_newSvcId();});

  const hd=document.createElement('div');hd.className='stl';hd.textContent='Map services';body.appendChild(hd);
  const intro=document.createElement('div');intro.className='hint';intro.style.margin='-2px 0 12px';
  intro.textContent='Add a card per service.';
  body.appendChild(intro);

  const list=document.createElement('div');body.appendChild(list);

  function card(svc,i){
    const meta=_MAP_SVC[svc.type]||_MAP_SVC.gluetun;
    const c=document.createElement('div');c.className='slot-card';c.style.position='relative';

    const del=document.createElement('button');del.type='button';del.setAttribute('aria-label','Remove service');
    del.style.cssText='position:absolute;top:8px;right:8px;width:32px;height:32px;border:none;background:none;cursor:pointer;color:var(--dm);font-size:20px;line-height:1;border-radius:8px;';
    del.textContent='\u00d7';
    del.onclick=()=>{_wmapCfg.services.splice(i,1);renderList();};
    c.appendChild(del);

    const typeWrap=document.createElement('div');typeWrap.className='fr';typeWrap.style.marginRight='36px';
    _customDrop(typeWrap,{idBase:'map-svc-type-'+svc.id,label:'Service',value:svc.type,
      items:Object.keys(_MAP_SVC).map(k=>({value:k,label:_MAP_SVC[k].label})),
      onChange:v=>{svc.type=v; svc.color=(_MAP_SVC[v]||{}).color||svc.color; renderList();}});
    c.appendChild(typeWrap);

    const nm=document.createElement('div');nm.className='fr';
    nm.innerHTML='<label>Display name</label><input class="fc" type="text" placeholder="'+esc(meta.label)+'" value="'+esc(svc.name||'')+'">';
    nm.querySelector('input').oninput=e=>{svc.name=e.target.value;};
    c.appendChild(nm);

    (meta.fields||[]).forEach(fld=>{
      const fr=document.createElement('div');fr.className='fr';
      const saved=fld.secret&&svc[fld.key+'Set'];
      const ph=saved?'\u2022\u2022\u2022\u2022\u2022\u2022 saved':fld.ph;
      const hint=saved?'Leave blank to keep the saved value.':(fld.key==='url'?'Reachable from the server, e.g. container:port.':'');
      fr.innerHTML='<label>'+esc(fld.label)+'</label><input class="fc" type="text" placeholder="'+esc(ph)+'" value="'+esc(svc[fld.key]||'')+'">'+(hint?'<div class="hint">'+esc(hint)+'</div>':'');
      fr.querySelector('input').oninput=e=>{svc[fld.key]=e.target.value.trim();};
      c.appendChild(fr);
    });

    const ad=document.createElement('div');ad.className='fr';
    ad.innerHTML='<label>Admin UI URL <span class="opt-span">(optional)</span></label><input class="fc" type="url" placeholder="'+esc(meta.adminPh)+'" value="'+esc(svc.adminUrl||'')+'"><div class="hint">Opens when you click this service in the legend.</div>';
    ad.querySelector('input').oninput=e=>{svc.adminUrl=e.target.value.trim();};
    c.appendChild(ad);

    c.appendChild(_mapSvcColorRow(svc));
    return c;
  }

  function renderList(){
    _wmapCfg.services.sort((a,b)=>String(a.name||'').toLowerCase().localeCompare(String(b.name||'').toLowerCase()));
    list.innerHTML='';
    if(!_wmapCfg.services.length){
      const empty=document.createElement('div');empty.className='hint';empty.style.cssText='padding:10px 0 14px;opacity:.7;';
      empty.textContent='No services yet. Add one below.';
      list.appendChild(empty);
    }
    _wmapCfg.services.forEach((svc,i)=>list.appendChild(card(svc,i)));
  }
  renderList();

  const add=document.createElement('button');add.type='button';
  add.style.cssText='width:100%;border:1px dashed var(--bd);background:none;color:var(--ac2);border-radius:var(--rs);padding:11px;min-height:44px;font-weight:600;font-size:14px;cursor:pointer;';
  add.textContent='+ Add service';
  add.onclick=()=>{_wmapCfg.services.push({id:_newSvcId(),type:'gluetun',name:'',url:'',adminUrl:'',color:'#30D158',token:'',enabled:true});renderList();};
  body.appendChild(add);

  const div1=document.createElement('div');div1.className='div';div1.style.margin='14px 0';body.appendChild(div1);

  const lRow=document.createElement('div');lRow.className='trow';
  lRow.innerHTML='<div><div class="tlbl">Show legend</div><div class="tdsc">Service key along the bottom of the map</div></div>'+
    '<label class="tog"><input type="checkbox" '+((_wmapCfg.showLegend!==false)?'checked':'')+'><div class="tr"></div></label>';
  lRow.querySelector('input').onchange=e=>{_wmapCfg.showLegend=e.target.checked;};
  body.appendChild(lRow);
}

function _renderCustomConfig(body){
  const fr=document.createElement('div');fr.className='fr';fr.style.marginBottom='0';
  const lbl=document.createElement('label');
  lbl.innerHTML='Iframe URL <span class="req">*</span>';
  const inp=document.createElement('input');
  inp.className='fc';inp.id='f-url';inp.type='url';
  inp.placeholder='https://app.example.com/widget.html';
  inp.value=esc(_customUrl||'');
  inp.oninput=e=>{ _customUrl=e.target.value; };
  const hint=document.createElement('div');hint.className='hint';
  hint.textContent='The URL will be embedded as an iframe in the dashboard.';
  fr.append(lbl,inp,hint);
  body.appendChild(fr);

  /* ── Advanced (iframe) settings — collapsed by default to keep the form clean ── */
  const o=_iframeOpts||{};
  const adv=document.createElement('div');adv.className='adv-wrap';
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='adv-toggle';
  toggle.setAttribute('aria-expanded','false');
  toggle.innerHTML='<span>Advanced</span><span class="adv-chev">▾</span>';
  const panel=document.createElement('div');panel.className='adv-panel d-none';
  panel.innerHTML=`
    <div class="fr">
      <label for="if-referrer">Referrer policy</label>
      <select class="fc" id="if-referrer">
        ${['','no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url']
          .map(v=>`<option value="${v}" ${(o.referrerPolicy||'')===v?'selected':''}>${v||'Default'}</option>`).join('')}
      </select>
      <div class="hint">Leave Default unless the page needs it.</div>
    </div>
    <div class="fr">
      <label for="if-allow">Allow (feature policy)</label>
      <input class="fc" id="if-allow" type="text" placeholder="autoplay; fullscreen; gamepad" value="${esc(o.allow||'')}">
      <div class="hint">Browser features the embedded page may use, separated by semicolons.</div>
    </div>
    <div class="trow trow-noborder">
      <div><div class="tlbl">Allow fullscreen</div><div class="tdsc">Let the embedded page enter fullscreen</div></div>
      <label class="tog"><input type="checkbox" id="if-fs" ${o.allowFullscreen!==false?'checked':''}><div class="tr"></div></label>
    </div>
    <div class="fr">
      <label for="if-refresh">Refresh interval <span style="opacity:.45;font-weight:400">(ms, optional)</span></label>
      <input class="fc" id="if-refresh" type="number" min="250" step="250" placeholder="e.g. 2000" value="${o.refreshInterval||''}">
      <div class="hint">Leave empty to never auto-reload.</div>
    </div>`;
  toggle.onclick=()=>{const open=panel.classList.toggle('d-none')===false;toggle.setAttribute('aria-expanded',String(open));toggle.classList.toggle('open',open);};
  /* Live-bind into _iframeOpts */
  panel.addEventListener('input',()=>{
    _iframeOpts.referrerPolicy=panel.querySelector('#if-referrer').value||undefined;
    _iframeOpts.allow=panel.querySelector('#if-allow').value.trim()||undefined;
    _iframeOpts.allowFullscreen=panel.querySelector('#if-fs').checked;
    const ri=parseInt(panel.querySelector('#if-refresh').value,10);
    _iframeOpts.refreshInterval=(ri&&ri>=250)?ri:undefined;
  });
  adv.append(toggle,panel);body.appendChild(adv);
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
function _customDrop(container, opt){
  container.innerHTML='';
  let curVal = opt.value;
  const items = opt.items||[];
  if(opt.label){ const lbl=document.createElement('label'); lbl.id=opt.idBase+'-lbl'; lbl.textContent=opt.label; container.appendChild(lbl); }
  const wrap=document.createElement('div'); wrap.className='dd';
  const btn=document.createElement('button'); btn.type='button'; btn.className='fc dd-btn'; btn.id=opt.idBase;
  btn.setAttribute('aria-haspopup','listbox'); btn.setAttribute('aria-expanded','false');
  if(opt.label) btn.setAttribute('aria-labelledby', opt.idBase+'-lbl '+opt.idBase);
  const labelFor=v=>{ const it=items.find(i=>String(i.value)===String(v)); return it?it.label:null; };
  const setText=()=>{
    const t=labelFor(curVal);
    btn.textContent = opt.disabled ? (opt.placeholder||'') : (t!=null?t:(opt.placeholder||'None'));
    btn.value = (opt.disabled || curVal==null) ? '' : String(curVal);
  };
  setText();
  if(opt.disabled){ btn.disabled=true; wrap.appendChild(btn); container.appendChild(wrap); return; }
  const list=document.createElement('div'); list.className='dd-list d-none'; list.setAttribute('role','listbox');
  if(opt.label) list.setAttribute('aria-label', opt.label);
  function render(){
    list.innerHTML='';
    items.forEach(it=>{
      const sel=String(it.value)===String(curVal);
      const o=document.createElement('div'); o.className='dd-opt'+(sel?' sel':'');
      o.setAttribute('role','option'); o.setAttribute('aria-selected',String(sel)); o.tabIndex=-1;
      o.textContent=it.label;
      o.onclick=ev=>{ ev.stopPropagation(); curVal=it.value; setText(); close(); render(); opt.onChange&&opt.onChange(it.value); };
      list.appendChild(o);
    });
  }
  function open(){ render(); _ddCloseAll(list); list.classList.remove('d-none'); btn.setAttribute('aria-expanded','true'); }
  function close(){ list.classList.add('d-none'); btn.setAttribute('aria-expanded','false'); }
  btn.onclick=ev=>{ ev.stopPropagation(); list.classList.contains('d-none')?open():close(); };
  wrap.append(btn,list); container.appendChild(wrap);
}

function _renderBackupConfig(body){
  const slotCount = _wsize === 'small' ? 1 : 3;
  const SLOT_NAMES = ['First','Second','Third'];
  const slots = _wbackupCfg.slots;
  const PLABEL = p => p==='duplicati' ? 'Duplicati' : 'Kopia';
  const firstProvIdx = prov => slots.findIndex(s => s.provider===prov);
  /* The provider's default is active only if its first instance opts to be the default. */
  const defaultActive = prov => { const f=firstProvIdx(prov); return f>=0 && slots[f].useDefault!==false; };
  /* A later instance uses the default iff the default is active AND it hasn't opted out. */
  const usesDefault = si => {
    const slot=slots[si]; if(!slot.provider) return false;
    const f=firstProvIdx(slot.provider);
    return si!==f && defaultActive(slot.provider) && slot.useDefault!==false;
  };
  /* Capture current DOM values into slot state (so a re-render from a toggle
     doesn't discard what the user just typed). */
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
        const p=g(`dup-poll-${si}`); if(p) slot.dupPollSec=Math.max(10,parseInt(p.value||'60',10));
        const pw=g(`dup-pass-${si}`); if(pw&&pw.value.trim()) slot.dupPass=pw.value.trim();
      } else if(slot.provider==='kopia'){
        const u=g(`kopia-url-${si}`);  if(u) slot.kopiaUrl=u.value.trim()||slot.kopiaUrl;
        const us=g(`kopia-user-${si}`); if(us) slot.kopiaUser=us.value.trim()||slot.kopiaUser;
        const h=g(`kopia-href-${si}`); if(h) slot.kopiaHref=h.value.trim();
        const pw=g(`kopia-pass-${si}`); if(pw&&pw.value.trim()) slot.kopiaPass=pw.value.trim();
      }
    });
  }
  /* Scoped re-render — body IS the #bak-cfg-body sub-container, never the whole form. */
  const rerender = () => { flushDom(); body.innerHTML=''; _renderBackupConfig(body); };

  function addNameField(div, si){
    const slot=slots[si];
    const w=document.createElement('div'); w.className='fr';
    w.innerHTML=`<label for="bak-name-${si}">Display name <span class="opt-span">(optional)</span></label>
      <input class="fc" id="bak-name-${si}" type="text" placeholder="Shown on the card"
        value="${esc(slot.customName||'')}">
      <div class="hint">Overrides the backup name on the widget.</div>`;
    div.appendChild(w);
  }

  /* iOS-style toggle row controlling whether this instance is / uses the default */
  function addDefaultToggle(div, si){
    const slot=slots[si];
    const prov=slot.provider;
    const isFirst = si===firstProvIdx(prov);
    const label = isFirst ? `Set as default ${PLABEL(prov)} instance`
                          : `Use default ${PLABEL(prov)} settings`;
    const desc  = isFirst ? `Other ${PLABEL(prov)} instances can reuse this connection.`
                          : `Reuse the default ${PLABEL(prov)} container. Turn off to set its own.`;
    const row=document.createElement('div'); row.className='trow';
    row.innerHTML=`<div><div class="tlbl">${label}</div><div class="tdsc">${desc}</div></div>
      <label class="tog"><input type="checkbox" id="bak-def-${si}" ${slot.useDefault!==false?'checked':''}
        aria-label="${label}"><div class="tr"></div></label>`;
    row.querySelector('input').onchange=e=>{ slot.useDefault=e.target.checked; rerender(); };
    div.appendChild(row);
  }

  function buildSlotSection(si) {
    const slot = slots[si];
    const wrap = document.createElement('div'); wrap.className='bak-slot';

    const hd = document.createElement('div'); hd.className='stl';
    hd.textContent = slotCount>1 ? SLOT_NAMES[si] + ' Instance' : 'Instance';
    wrap.appendChild(hd);

    const pillDiv = document.createElement('div'); pillDiv.className='fr';
    const row = document.createElement('div'); row.className='wtype-row';
    row.setAttribute('role','group'); row.setAttribute('aria-label','Backup provider');
    const dupBtn = document.createElement('button'); dupBtn.type='button';
    dupBtn.className='wchip'+(slot.provider==='duplicati'?' on':'');
    dupBtn.setAttribute('aria-pressed',String(slot.provider==='duplicati'));
    dupBtn.textContent='Duplicati';
    const kopiaBtn = document.createElement('button'); kopiaBtn.type='button';
    kopiaBtn.className='wchip'+(slot.provider==='kopia'?' on':'');
    kopiaBtn.setAttribute('aria-pressed',String(slot.provider==='kopia'));
    kopiaBtn.textContent='Kopia';
    [dupBtn, kopiaBtn].forEach(btn => {
      btn.onclick = () => {
        const val = btn===dupBtn ? 'duplicati' : 'kopia';
        slot.provider = slot.provider===val ? null : val;
        slot.jobId = null;
        if(slot.provider) slot.useDefault = true;   /* default on when (re)selecting */
        rerender();
      };
      row.appendChild(btn);
    });
    pillDiv.appendChild(row); wrap.appendChild(pillDiv);

    if (slot.provider) {
      /* Show the default toggle only when sharing is meaningful (more than one slot) */
      if (slotCount>1) addDefaultToggle(wrap, si);
      wrap.appendChild(buildConnSection(si));
    }
    return wrap;
  }

  function buildConnSection(si) {
    const slot = slots[si];
    const prov = slot.provider;
    const div  = document.createElement('div'); div.className='bak-slot-conn';

    /* Secondary instance reusing the default container: just picker + name */
    if (usesDefault(si)) {
      const fIdx=firstProvIdx(prov);
      const note=document.createElement('div'); note.className='hint';
      note.style.cssText='margin-bottom:8px;font-style:italic;color:var(--dm)';
      note.textContent=`Uses the ${PLABEL(prov)} container from ${SLOT_NAMES[fIdx]} Instance.`;
      div.appendChild(note);
      const wrap=document.createElement('div');wrap.className='fr';
      wrap.id=`${prov==='duplicati'?'dup-job':'kopia-src'}-wrap-${si}`;
      div.appendChild(wrap);
      prov==='duplicati' ? renderJobDrop(si,wrap) : renderSrcDrop(si,wrap);
      addNameField(div, si);
      return div;
    }

    /* whether this slot's connection should propagate to default-using peers */
    const shared = slotCount>1 && si===firstProvIdx(prov) && defaultActive(prov);

    if (prov === 'duplicati') {
      const urlWrap=document.createElement('div');urlWrap.className='fr';
      urlWrap.innerHTML=`<label for="dup-url-${si}">URL <span class="req">*</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="fc" id="dup-url-${si}" type="text" placeholder="http://duplicati:8200"
            value="${esc(slot.dupUrl)}" style="flex:1;min-width:0">
          <button type="button" class="btn bg sm" id="dup-fetch-${si}" style="flex-shrink:0;white-space:nowrap">Fetch Jobs</button>
        </div>`;
      div.appendChild(urlWrap);

      const passWrap=document.createElement('div');passWrap.className='fr';
      passWrap.innerHTML=`<label for="dup-pass-${si}">Password <span class="opt-span">(${(slot.dupPassSet||slot.dupPass)?'saved':'optional'})</span></label>
        <input class="fc" id="dup-pass-${si}" type="password" autocomplete="new-password"
          placeholder="${(slot.dupPassSet||slot.dupPass)?'\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf  (saved, leave blank to keep)':'Enter if required'}">`;
      div.appendChild(passWrap);

      const hrefWrap=document.createElement('div');hrefWrap.className='fr';
      hrefWrap.innerHTML=`<label for="dup-href-${si}">Click URL <span class="opt-span">(optional)</span></label>
        <input class="fc" id="dup-href-${si}" type="text" placeholder="http://duplicati:8200"
          value="${esc(slot.dupHref)}">`;
      div.appendChild(hrefWrap);

      const pollWrap=document.createElement('div');pollWrap.className='fr';
      pollWrap.innerHTML=`<label for="dup-poll-${si}">Poll interval <span class="opt-span">(sec)</span></label>
        <input class="fc" id="dup-poll-${si}" type="number" min="10" max="3600"
          value="${esc(slot.dupPollSec)}" style="width:90px">`;
      div.appendChild(pollWrap);

      const jobWrap=document.createElement('div');jobWrap.className='fr';jobWrap.id=`dup-job-wrap-${si}`;
      div.appendChild(jobWrap);
      renderJobDrop(si, jobWrap);
      addNameField(div, si);

      div.querySelector(`#dup-fetch-${si}`).onclick = async function(){
        const btn=this;
        const url=(div.querySelector(`#dup-url-${si}`)?.value||'').trim();
        const pass=(div.querySelector(`#dup-pass-${si}`)?.value||'').trim();
        if(!url){toast('Enter a Duplicati URL first','err');return;}
        btn.disabled=true; btn.textContent='Fetching…';
        try {
          slot.dupUrl=url;
          const b={url};
          if(pass) b.password=pass;
          else if(slot.dupPassSet) b.useStoredPass=true;
          const wid=(eid!==null&&items[eid]?.id)?items[eid].id:'__preview__';
          const r=await fetch(`/api/duplicati-jobs/${encodeURIComponent(wid)}`,{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),
          });
          if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||r.status);}
          const data = await r.json();
          slot.dupJobList = Array.isArray(data) ? data : (Array.isArray(data?.jobs) ? data.jobs : []);
          slots.forEach((s,j)=>{
            if(j!==si && s.provider==='duplicati' && (shared && usesDefault(j) || s.dupUrl===url)){
              s.dupJobList=slot.dupJobList;
              const w=document.getElementById(`dup-job-wrap-${j}`); if(w) renderJobDrop(j,w);
            }
          });
          const jw = document.getElementById(`dup-job-wrap-${si}`); if(jw) renderJobDrop(si, jw);
          toast(slot.dupJobList.length?`Loaded ${slot.dupJobList.length} job${slot.dupJobList.length>1?'s':''}`:'No backup jobs found', slot.dupJobList.length?'ok':'err');
        } catch(e){toast('Fetch failed: '+e.message,'err');}
        finally{btn.disabled=false; btn.textContent='Fetch Jobs';}
      };

    } else {
      const urlWrap=document.createElement('div');urlWrap.className='fr';
      urlWrap.innerHTML=`<label for="kopia-url-${si}">URL <span class="req">*</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="fc" id="kopia-url-${si}" type="text" placeholder="http://kopia:51515"
            value="${esc(slot.kopiaUrl)}" style="flex:1;min-width:0">
          <button type="button" class="btn bg sm" id="kopia-fetch-${si}" style="flex-shrink:0;white-space:nowrap">Fetch Sources</button>
        </div>`;
      div.appendChild(urlWrap);

      const userWrap=document.createElement('div');userWrap.className='fr';
      userWrap.innerHTML=`<label for="kopia-user-${si}">Username <span class="opt-span">(optional)</span></label>
        <input class="fc" id="kopia-user-${si}" type="text" placeholder="admin"
          value="${esc(slot.kopiaUser)}">`;
      div.appendChild(userWrap);

      const passWrap=document.createElement('div');passWrap.className='fr';
      passWrap.innerHTML=`<label for="kopia-pass-${si}">Password <span class="opt-span">(${(slot.kopiaPassSet||slot.kopiaPass)?'saved':'optional'})</span></label>
        <input class="fc" id="kopia-pass-${si}" type="password" autocomplete="new-password"
          placeholder="${(slot.kopiaPassSet||slot.kopiaPass)?'\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf  (saved, leave blank to keep)':'Enter if required'}">`;
      div.appendChild(passWrap);

      const hrefWrap=document.createElement('div');hrefWrap.className='fr';
      hrefWrap.innerHTML=`<label for="kopia-href-${si}">Click URL <span class="opt-span">(optional)</span></label>
        <input class="fc" id="kopia-href-${si}" type="text" placeholder="http://kopia:51515"
          value="${esc(slot.kopiaHref)}">`;
      div.appendChild(hrefWrap);

      const srcWrap=document.createElement('div');srcWrap.className='fr';srcWrap.id=`kopia-src-wrap-${si}`;
      div.appendChild(srcWrap);
      renderSrcDrop(si, srcWrap);
      addNameField(div, si);

      div.querySelector(`#kopia-fetch-${si}`).onclick = async function(){
        const btn=this;
        const url=(div.querySelector(`#kopia-url-${si}`)?.value||'').trim();
        const user=(div.querySelector(`#kopia-user-${si}`)?.value||'').trim();
        const pass=(div.querySelector(`#kopia-pass-${si}`)?.value||'').trim();
        if(!url){toast('Enter a Kopia URL first','err');return;}
        btn.disabled=true; btn.textContent='Fetching…';
        try {
          slot.kopiaUrl=url;
          slot.kopiaUser=user||slot.kopiaUser;
          const b={url};
          if(user)b.username=user;
          if(pass)b.password=pass;
          else if(slot.kopiaPassSet)b.useStoredPass=true;
          const wid=(eid!==null&&items[eid]?.id)?items[eid].id:'__preview__';
          const r=await fetch(`/api/kopia-sources/${encodeURIComponent(wid)}`,{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),
          });
          if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||r.status);}
          const srcs = await r.json();
          slot.kopiaSrcList = Array.isArray(srcs) ? srcs : (Array.isArray(srcs?.sources) ? srcs.sources : []);
          slots.forEach((s,j)=>{
            if(j!==si && s.provider==='kopia' && (shared && usesDefault(j) || s.kopiaUrl===url)){
              s.kopiaSrcList=slot.kopiaSrcList;
              const w=document.getElementById(`kopia-src-wrap-${j}`); if(w) renderSrcDrop(j,w);
            }
          });
          const sw = document.getElementById(`kopia-src-wrap-${si}`); if(sw) renderSrcDrop(si, sw);
          toast(slot.kopiaSrcList.length?`Loaded ${slot.kopiaSrcList.length} source${slot.kopiaSrcList.length>1?'s':''}`:'No sources found', slot.kopiaSrcList.length?'ok':'err');
        } catch(e){toast('Fetch failed: '+e.message,'err');}
        finally{btn.disabled=false; btn.textContent='Fetch Sources';}
      };
    }
    return div;
  }

  function renderJobDrop(si, container) {
    const slot=slots[si];
    if(!slot.dupJobList.length){
      const saved = slot.jobId ? (slot.customName || slot.jobId) : '';
      _customDrop(container,{idBase:`dup-job-${si}`,label:'Job',items:[],value:'',
        placeholder: saved ? `${saved}, fetch to change` : 'Fetch jobs first', disabled:true});
      return;
    }
    const items=[{value:'',label:'None'}].concat(slot.dupJobList.map(j=>({value:String(j.id),label:j.name})));
    _customDrop(container,{idBase:`dup-job-${si}`,label:'Job',items,value:slot.jobId||'',placeholder:'None',
      onChange:v=>{ slot.jobId=v||null; }});
  }

  function renderSrcDrop(si, container) {
    const slot=slots[si];
    if(!slot.kopiaSrcList.length){
      const saved = slot.jobId ? (slot.customName || slot.jobId) : '';
      _customDrop(container,{idBase:`kopia-src-${si}`,label:'Source',items:[],value:'',
        placeholder: saved ? `${saved}, fetch to change` : 'Fetch sources first', disabled:true});
      return;
    }
    const items=[{value:'',label:'None'}].concat(slot.kopiaSrcList.map(src=>({value:src.id,label:src.name})));
    _customDrop(container,{idBase:`kopia-src-${si}`,label:'Source',items,value:slot.jobId||'',placeholder:'None',
      onChange:v=>{ slot.jobId=v||null; }});
  }

  /* ── Render all slots ── */
  for (let si=0; si<slotCount; si++) {
    if (si > 0) { const d=document.createElement('div');d.className='div';body.appendChild(d); }
    body.appendChild(buildSlotSection(si));
  }
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
      else on=(b.dataset.v!=='custom'&&!b.classList.contains('cc-sem')&&_near(b.dataset.v,hex));
      b.classList.toggle('on',on); if(on)matched=b;
    });
    const rb=container.querySelector('.cc-rainbow'); if(rb)rb.classList.toggle('on',mode==='color'&&!matched);
    tune.forEach(r=>r.classList.toggle('cc-dim',mode!=='color'));
    if(!codeRv.closest('.editing')){
      codeRv.textContent = mode==='color'?hex:(mode==='dark'?'Dark':'Light');
      codeRv.classList.remove('is-ph');
    }
    hidden.value = mode==='color'?hex:mode;
  }
  const commit=()=>{ paint(); onChange?.(hidden.value); };
  [hEl,sEl,vEl].forEach(el=>el.addEventListener('input',()=>{ mode='color'; commit(); }));
  container.querySelectorAll('.cc-swatch').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.v==='dark'||b.dataset.v==='light'){ mode=b.dataset.v; commit(); return; }
    mode='color';
    if(b.dataset.v!=='custom'){ const hv=_hexToHsv(b.dataset.v); if(hv){hEl.value=hv.h;sEl.value=hv.s;vEl.value=hv.v;} }
    commit();
  }));
  initInlineEdit(`${idPrefix}-code-row`,`${idPrefix}-hex`,{placeholder:'#rrggbb or any CSS color',onCommit(val){
    const hv=_hexToHsv(val); if(hv){ mode='color'; hEl.value=hv.h; sEl.value=hv.s; vEl.value=hv.v; } commit();
  }});
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
function _hslToHex(h,s,l){
  s/=100;l/=100;
  const a=s*Math.min(l,1-l);
  const f=n=>{const k=(n+h/30)%12;const c=l-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1)));return Math.round(255*c);};
  const to=v=>v.toString(16).padStart(2,'0');
  return '#'+to(f(0))+to(f(8))+to(f(4));
}
function _hexToHsl(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'');
  if(!m)return null;
  let r=parseInt(m[1],16)/255,g=parseInt(m[2],16)/255,b=parseInt(m[3],16)/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h,s,l=(mx+mn)/2;
  if(mx===mn){h=s=0;}else{const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
    switch(mx){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h/=6;}
  return {h:Math.round(h*360),s:Math.round(s*100),l:Math.round(l*100)};
}
function _cpkSync(){
  const H=document.getElementById('cpk-h'),S=document.getElementById('cpk-s'),L=document.getElementById('cpk-l');
  if(!H)return;
  const hv=+H.value,sv=+S.value,lv=+L.value;
  S.style.background=`linear-gradient(90deg, ${_hslToHex(hv,0,lv)}, ${_hslToHex(hv,100,lv)})`;
  L.style.background=`linear-gradient(90deg, #000, ${_hslToHex(hv,sv,50)}, #fff)`;
}
function setColor(v){
  scol=v;
  /* Only touch icon-background swatches (no data-field = not a badge picker) */
  document.querySelectorAll('.co[data-v]:not([data-field])').forEach(el=>el.classList.toggle('on',el.dataset.v===v));
  const hex=document.getElementById('co-hex');
  if(hex)hex.value=v==='dark'?'':v==='light'?'':v;
  const cc=document.getElementById('co-custom');
  if(cc)cc.style.setProperty('--cc', rc(v));
  updPrev();
}
function wireColor(){
  document.querySelectorAll('.co[data-v]:not([data-field])').forEach(o=>{o.onclick=()=>setColor(o.dataset.v);});
  const hex=document.getElementById('co-hex');
  if(hex)hex.oninput=e=>{
    const v=e.target.value.trim();
    if(!v)return;
    scol=v;
    const cc=document.getElementById('co-custom'); if(cc)cc.style.setProperty('--cc', rc(v));
    const hsl=_hexToHsl(rc(v));
    if(hsl){const H=document.getElementById('cpk-h');if(H){H.value=hsl.h;document.getElementById('cpk-s').value=hsl.s;document.getElementById('cpk-l').value=hsl.l;_cpkSync();}}
    updPrev();
  };
  /* Custom HSL slider picker — range inputs fire reliably (the native <input type=color> did not) */
  const cc=document.getElementById('co-custom'), pk=document.getElementById('co-picker');
  if(cc&&pk){
    cc.onclick=()=>{
      const open=pk.classList.toggle('d-none')===false;
      cc.setAttribute('aria-expanded',String(open));
      if(open){const hsl=_hexToHsl(rc(scol))||{h:220,s:60,l:50};
        document.getElementById('cpk-h').value=hsl.h;document.getElementById('cpk-s').value=hsl.s;document.getElementById('cpk-l').value=hsl.l;_cpkSync();}
    };
    const onSlide=()=>{
      const h=+document.getElementById('cpk-h').value,s=+document.getElementById('cpk-s').value,l=+document.getElementById('cpk-l').value;
      _cpkSync();
      setColor(_hslToHex(h,s,l));
    };
    ['cpk-h','cpk-s','cpk-l'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('input',onSlide);});
  }
  setColor(scol);
}

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
        /* stats — collect final disk field values from DOM */
        const slots=_wslots.slice(0,3).map((s,i)=>{
          const card=document.querySelectorAll('.slot-card')[i];
          const slotColor=s.color||undefined;
          if(s.type==='disk'){
            const pri=card?.querySelector('.slot-disk-primary')?.value?.trim()||s.primary||'/';
            const sec=card?.querySelector('.slot-disk-secondary')?.value?.trim()||s.secondary||'';
            return{type:'disk',primary:pri,secondary:sec||undefined,color:slotColor};
          }
          if(s.type==='temp'){
            const zone=parseInt(card?.querySelector('.slot-temp-zone')?.value||'0',10)||0;
            return{type:'temp',thermalZone:zone,color:slotColor};
          }
          return{type:s.type,color:slotColor};
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
  /* Apply wallpaper bg to outer wrapper and body so it shows behind the panel */
  const _bg=s.background||{};
  const _applyBg=el=>{
    if(!el)return;
    if(_bg.type==='color'&&_bg.color){el.style.background=_bg.color;}
    else if(_bg.type==='url'&&_bg.url){el.style.background=`url(${_bg.url}) center/cover no-repeat fixed`;}
    else{el.style.background='';}
  };
  _applyBg(document.querySelector('.adm-outer'));
  _applyBg(document.body);

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
  if(secEnEl&&secSubEl){
    secEnEl.addEventListener('change',()=>{
      if(secEnEl.checked)openSecSub();
      else secSubEl.classList.remove('open');
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
    const secLogout=document.getElementById('sec-logout');
    if(secLogout&&d.enabled){secLogout.classList.remove('d-none');}
    secLogout?.addEventListener('click',async()=>{
      await ap('/api/auth/logout',{}).catch(()=>{});
      location.reload();
    });
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
  const links=document.querySelectorAll('.nl');
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
    const v=d.current||d.version||'';
    if(v){
      const vEl=document.getElementById('sidebar-version');
      const aEl=document.getElementById('about-version');
      if(vEl)vEl.textContent=v;
      if(aEl)aEl.textContent='Version '+v;
      if(d.updateAvailable){
        const dot=document.getElementById('about-update-dot');
        if(dot)dot.style.display='flex';
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
