import { LOCAL_ICONS, loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=bdd2c9eb';
import { clr as rc, esc } from '/js/utils.js?v=92153ac7';
import { WIDGET_TYPES } from '/js/widget-types.js?v=63bf4388';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=1679b8c5';
import { API, toast, ag, ap, PE_SVG, CHEV_SVG, initInlineEdit, _secretRow } from '/js/admin-shared.js?v=6f21b1b8';
import { renderColorControl } from '/js/admin-color-control.js?v=255efb55';
import { checkAuth, pwStrength, wirePasswordStrength } from '/js/admin-auth.js?v=8cd76ea3';
import { state } from '/js/admin-state.js?v=e7eb56f7';
import { buildWidgetForm } from '/js/admin-widget-form.js?v=21070bc4';
import { buildAppForm, buildFolderForm, parseKV } from '/js/admin-app-form.js?v=c3d495f0';
import { loadSettings, showBgFields } from '/js/admin-settings.js?v=146d5567';

/* Admin UI — Stackyard Dashboard */

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

const collapsedFolders=new Set(); /* tracks which folder ids are collapsed */
let _flt={q:'',type:'all'};

const COLLAPSE_KEY='admin_collapsed';
function loadCollapsed(){try{return JSON.parse(localStorage.getItem(COLLAPSE_KEY)||'{}');}catch{return{};}}
function saveCollapsed(s){localStorage.setItem(COLLAPSE_KEY,JSON.stringify(s));}
function initCards(){}

async function load(){
  await loadLocalIcons();
  const c=await ag('/api/config');
  state.items=c.items||[];
  state._settings=c.settings||{};
  /* Folder-style widgets: registry drives their auto-generated config editor. */
  try{ const wr=await ag('/api/widgets'); state._widgetReg={}; (wr.widgets||[]).forEach(w=>{ state._widgetReg[w.name]=w; }); }catch{ state._widgetReg={}; }
  /* All folders start collapsed — user can expand by clicking */
  state.items.filter(i=>i.type==='folder').forEach(f=>collapsedFolders.add(f.id));
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
    const bg=(state._settings&&state._settings.background)||{};
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
  if(state.saving)return;state.saving=true;
  try{const full=await ag('/api/config');full.items=state.items;await ap('/api/config',full);toast('Saved');}
  catch(e){toast('Save failed: '+e.message,'err');}
  state.saving=false;render();
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
    const f=state.items.find(i=>i.id===folderId);if(!f)return;
    const ch=f.children||[];const j=childIdx+dir;if(j<0||j>=ch.length)return;
    [ch[childIdx],ch[j]]=[ch[j],ch[childIdx]];
  }else{
    const inF=new Set(state.items.filter(i=>i.type==='folder').flatMap(ff=>ff.children||[]));
    const top=state.items.filter(it=>it.type==='folder'||!inF.has(it.id));
    const p=top.indexOf(item);const nb=top[p+dir];if(!nb)return;
    const a=state.items.indexOf(item),b=state.items.indexOf(nb);
    [state.items[a],state.items[b]]=[state.items[b],state.items[a]];
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
    const cf=state.items.find(i=>i.id===folderId);const n=(cf?.children||[]).length;
    canUp=childIdx>0;canDown=childIdx<n-1;
  }else{
    const inF=new Set(state.items.filter(i=>i.type==='folder').flatMap(ff=>ff.children||[]));
    const top=state.items.filter(it=>it.type==='folder'||!inF.has(it.id));
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
    nm.style.cssText='display:flex;align-state.items:center;gap:6px;cursor:pointer;';
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
      srcFolderObj=state.items.find(i=>i.id===sfId);
      srcItem=state.items.find(i=>i.id===sItemId);
      srcFolder=sfId;
    }else if(raw.startsWith('top:')){
      srcItem=state.items.find(i=>i.id===raw.slice(4));
    }
    if(!srcItem)return;

    /* Remove from source location */
    if(srcFolder&&srcFolderObj){
      srcFolderObj.children=(srcFolderObj.children||[]).filter(id=>id!==srcItem.id);
    }else{
      const si=state.items.indexOf(srcItem);
      if(si>=0)state.items.splice(si,1);
    }

    /* Insert at target location */
    if(indent){
      /* Drop on a child row → insert into same folder at this position */
      /* Re-find folder after possible state.items mutation */
      const tf=state.items.find(i=>i.id===folderId);
      if(!tf){state.items.push(srcItem);save();return;}
      /* Remove from this folder if already in it (reorder) */
      tf.children=(tf.children||[]).filter(id=>id!==srcItem.id);
      /* If srcItem is not in state.items yet (was top-level), it's still there */
      if(!state.items.find(i=>i.id===srcItem.id))state.items.push(srcItem);
      /* Insert at childIdx position */
      tf.children.splice(childIdx,0,srcItem.id);
    }else if(item.type==='folder'){
      /* Drop ON a folder row → add to end of that folder */
      if(!state.items.find(i=>i.id===srcItem.id))state.items.push(srcItem);
      const tf=state.items.find(i=>i.id===item.id);
      if(tf){tf.children=(tf.children||[]).filter(id=>id!==srcItem.id);tf.children.push(srcItem.id);}
    }else{
      /* Drop on a top-level row → insert before it, remove from any folder */
      state.items.filter(f=>f.type==='folder').forEach(f=>{
        f.children=(f.children||[]).filter(id=>id!==srcItem.id);
      });
      if(!state.items.find(i=>i.id===srcItem.id))state.items.push(srcItem);
      /* Remove srcItem from its current position */
      const si2=state.items.indexOf(srcItem);
      if(si2>=0)state.items.splice(si2,1);
      /* Insert above or below target based on mouse position */
      const ti2=state.items.indexOf(item);
      const insertAt=dropAbove?ti2:ti2+1;
      state.items.splice(Math.max(0,insertAt),0,srcItem);
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
    if(state.items.length>=6) bar.style.display='';
    else { bar.style.display='none'; if(_flt.q||_flt.type!=='all'){_flt={q:'',type:'all'};_syncFilterUI();} }
  }
  if(grp) grp.style.display=state.items.length?'':'none';
  if(!state.items.length){
    l.innerHTML='<div class="empty"><p class="empty-msg">No apps yet. Click +Add.</p></div>';
    return;
  }
  l.innerHTML='';
  if(_flt.q||_flt.type!=='all'){
    const q=_flt.q.toLowerCase();
    const matches=state.items.filter(it=>{
      if(_flt.type!=='all'&&it.type!==_flt.type)return false;
      if(q){ const hay=((it.label||'')+' '+(it.href||'')+' '+(it.widgetType||'')).toLowerCase(); if(!hay.includes(q))return false; }
      return true;
    });
    if(!matches.length){ l.innerHTML='<div class="empty"><p class="empty-msg">No matches.</p></div>'; return; }
    matches.forEach(item=>l.appendChild(mkRow(item,state.items.indexOf(item))));
    return;
  }
  const inFolder=new Set(state.items.filter(i=>i.type==='folder').flatMap(f=>f.children||[]));
  state.items.forEach((item,idx)=>{
    if(item.type!=='folder'&&inFolder.has(item.id))return;
    l.appendChild(mkRow(item,idx));
    if(item.type==='folder'&&!collapsedFolders.has(item.id)){
      (item.children||[]).forEach((childId,ci)=>{
        const childItem=state.items.find(i=>i.id===childId);
        if(!childItem)return;
        l.appendChild(mkRow(childItem,state.items.indexOf(childItem),{indent:true,childIdx:ci,folderId:item.id}));
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



/* Edit (square-pen) and select (up/down) glyphs traced from the PSD. */


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
    b.className='tile-opt'+(t===state.ctype?' on':'');
    b.dataset.ctype=t;
    b.setAttribute('aria-pressed',String(t===state.ctype));
    b.setAttribute('aria-label','Add '+TYPE_LABELS[t]);
    b.innerHTML=`<span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${TYPE_ICONS[t]}</svg></span><span class="tile-cap">${TYPE_LABELS[t]}</span>`;
    b.onclick=()=>{ if(state.ctype===t)return; state.ctype=t; _renderEditBody(); };
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
  if(state.ctype==='widget') buildWidgetForm(body,state._evItem);
  else if(state.ctype==='folder') buildFolderForm(body,state._evItem);
  else buildAppForm(body,state._evItem);
  if(!state._evIsEdit) body.insertBefore(buildAddNewCard(),body.firstChild);
  setTimeout(()=>{ try{ body.querySelector('input,select,textarea')?.focus(); }catch{} },50);
}

function openModal(idx){
  state.eid=idx??null;
  const item=idx!=null?JSON.parse(JSON.stringify(state.items[idx])):null;
  state.ctype=item?.type||'app';
  state.siurl=item?.iconUrl||'';
  state.scol=item?.color||'dark';
  state._customUrl=item?.url||'';
  state._iframeOpts=item?.iframe?{...item.iframe}:{};
  state.fnums=[];state.spaths=[];
  if(item?.monitoring?.activity?.extract){
    const ex=Array.isArray(item.monitoring.activity.extract)?item.monitoring.activity.extract:[item.monitoring.activity.extract];
    state.spaths=ex.map(e=>typeof e==='string'?e:e.path).filter(Boolean);
  }else if(item?.badge?.extract){
    const ex=Array.isArray(item.badge.extract)?item.badge.extract:[item.badge.extract];
    state.spaths=ex.map(e=>typeof e==='string'?e:e.path).filter(Boolean);
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
  state._evItem=item; state._evIsEdit=isEdit;
  _renderEditBody();

  showEditView();
}

function _evDelete(item,idx){
  if(!item)return;
  if(item.type==='folder'){if(!confirm(`Delete folder "${item.label}"? Apps inside will not be deleted.`))return;}
  else{if(!confirm(`Remove "${item.label||item.id}"?`))return;}
  state.items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==item.id);});
  state.items.splice(idx,1);
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
    state.items=d.items;await save();toast('Imported');}
  catch(e){toast('Import failed: '+e.message,'err');}
  e.target.value='';
};

document.getElementById('btn-add').onclick=()=>openModal(null);
function closeModal(){
  showListView();
  state.eid=null;
  state._wtype='custom';state._wsize='medium';state._wslots=[];state._wnet={enabled:false,url:'',provider:'myspeed'};
  state._wmapCfg={};state._wconnView='map';state._wvpnCfg={};state._customUrl='';state._wlabel='';state._wgithubCfg={};state._wclockCfg={};state._wbackupCfg={};state._wstatsSubType='system-summary';state._wdiskCfg={diskProvider:'scrutiny',scrutinyUrl:'',scrutinyHref:'',truenasUrl:'',truenasKeySet:false,truenasHref:'',bays:[]};state._iframeOpts={};state._wweatherCfg={city:'',lat:'',lon:'',units:'c',href:''};
}



function openFolderPicker(appId,targetFolderId=null){
  const trigger=document.activeElement;
  const folders=state.items.filter(i=>i.type==='folder');
  const currentFolder=folders.find(f=>(f.children||[]).includes(appId));
  const appItem=state.items.find(i=>i.id===appId);
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
    const available=tf?state.items.filter(i=>i.type==='app'&&!i.dock&&!(tf.children||[]).includes(i.id)):[];
    if(!available.length){
      const em=document.createElement('div');em.className='fp-empty';
      em.textContent='All apps are already in this folder.';list.appendChild(em);
    }
    available.forEach(app=>{
      const b=rowBtn('',()=>{
        state.items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==app.id);});
        if(!tf.children)tf.children=[];tf.children.push(app.id);save();close();});
      const ri=document.createElement('span');ri.className='fp-ic';ri.style.background=rc(app.color);
      if(app.iconUrl){const img=document.createElement('img');img.alt='';img.src=resolveIcon(app.iconUrl);ri.appendChild(img);}
      else ri.textContent=(app.label||'?')[0];
      const nm=document.createElement('span');nm.className='fp-nm';nm.textContent=app.label||app.id;
      b.append(ri,nm);list.appendChild(b);
    });
  }else{
    const none=rowBtn(currentFolder?'muted':'cur',()=>{
      state.items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==appId);});
      save();close();});
    const ns=document.createElement('span');ns.textContent='No folder';none.append(ns);list.appendChild(none);

    folders.forEach(f=>{
      const cur=currentFolder?.id===f.id;
      const b=rowBtn(cur?'cur':'',()=>{
        state.items.forEach(ff=>{if(ff.type==='folder')ff.children=(ff.children||[]).filter(id=>id!==appId);});
        if(!f.children)f.children=[];if(!f.children.includes(appId))f.children.push(appId);save();close();});
      const nm=document.createElement('span');nm.textContent='📁 '+f.label;
      const chk=document.createElement('span');chk.className='fp-chk';if(cur)chk.textContent='✓';
      b.append(nm,chk);list.appendChild(b);
    });

    const divider=document.createElement('div');divider.className='div';divider.style.margin='4px 8px';list.appendChild(divider);

    const nr=rowBtn('accent',()=>{
      const name=prompt('Folder name:');if(!name?.trim())return;
      const fid='folder_'+Date.now();
      state.items.push({id:fid,type:'folder',label:name.trim(),children:[appId]});
      state.items.forEach(f=>{if(f.type==='folder'&&f.id!==fid)f.children=(f.children||[]).filter(id=>id!==appId);});
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
    if(state.ctype==='widget'){
      /* Generate clean IDs: only letters, digits and underscores */
      const cleanId=s=>s.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'widget';
      const wlabel=state._wlabel.trim()||(state._wtype==='stats'?(state._wstatsSubType==='disk-health'?'Disk Health':'System Summary'):WIDGET_TYPES[state._wtype]?.label||'Widget');
      if(state._autoForm && state._autoFormType===state._wtype && state._widgetReg[state._wtype] && !state._widgetReg[state._wtype].customEditor){
        const missing=state._autoForm.validate();
        if(missing.length){ toast(missing[0]+' is required','err'); return; }
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:state._wtype,
          label:wlabel,widgetSize:state._wsize,widgetConfig:state._autoForm.getValues()};
      }
      else if(state._wtype==='weather'){
        const city=document.getElementById('wx-city')?.value?.trim()||state._wweatherCfg.city;
        if(state._wweatherCfg.lat===''||state._wweatherCfg.lat==null){ toast('Search and select a city first','err'); return; }
        const wcfg={ city:state._wweatherCfg.city||city, lat:state._wweatherCfg.lat, lon:state._wweatherCfg.lon, units:state._wweatherCfg.units||'c' };
        if(state._wweatherCfg.feelsLike) wcfg.feelsLike=true;
        const href=document.getElementById('wx-href')?.value?.trim();
        if(href) wcfg.href=href;
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'weather',
          label:wlabel,widgetSize:'small',widgetConfig:wcfg};
      }
      else if(state._wtype==='custom'){
        const url=document.getElementById('f-url')?.value?.trim();
        if(!url){toast('URL required','err');return;}
        const ifo={};
        if(state._iframeOpts.referrerPolicy) ifo.referrerPolicy=state._iframeOpts.referrerPolicy;
        if(state._iframeOpts.allow) ifo.allow=state._iframeOpts.allow;
        if(state._iframeOpts.allowFullscreen===false) ifo.allowFullscreen=false;
        if(state._iframeOpts.refreshInterval) ifo.refreshInterval=state._iframeOpts.refreshInterval;
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'custom',
          label:wlabel, widgetSize:state._wsize,url};
        if(Object.keys(ifo).length) item.iframe=ifo;
      }else if(state._wtype==='connections'){
        if(state._wconnView==='vpn'){
          const url=(document.getElementById('vpn-url')?.value||'').trim();
          if(!url){toast('Connection URL is required','err');return;}
          const vpn={ service:state._wvpnCfg.service||'gluetun', url };
          vpn.color=state._wvpnCfg.color||'#30D158';
          const nm=(document.getElementById('vpn-name')?.value||'').trim();
          if(nm) vpn.name=nm; else if(state._wvpnCfg.name) vpn.name=state._wvpnCfg.name;
          const hf=(document.getElementById('vpn-href')?.value||'').trim();
          if(hf) vpn.href=hf; else if(state._wvpnCfg.href) vpn.href=state._wvpnCfg.href;
          if(vpn.service==='gluetun'){
            const k=(document.getElementById('vpn-apikey')?.value||'').trim();
            /* Only send a new key if typed; otherwise flag that one is stored so
               the server preserves it (POST /api/config merge) and the UI shows it. */
            if(k){ vpn.apiKey=k; vpn.apiKeySet=true; }
            else if(state._wvpnCfg.apiKeySet){ vpn.apiKeySet=true; }
          }else{
            const tk=(document.getElementById('vpn-token')?.value||'').trim();
            if(tk){ vpn.token=tk; vpn.tokenSet=true; }
            else if(state._wvpnCfg.tokenSet){ vpn.tokenSet=true; }
            else { toast('NetBird access token is required','err'); return; }
          }
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'connections',
            label:wlabel, widgetSize:state._wsize, widgetConfig:{ view:'vpn', vpn }};
        } else {
          const SVC_PLAIN=['siteId','websiteId','username'], SVC_SECRET=['token','apiKey','password'];
          const services=(state._wmapCfg.services||[]).filter(s=>s && s.type && (s.url||'').trim())
            .map(s=>{const o={id:s.id,type:s.type,name:(s.name||'').trim(),url:s.url.trim(),adminUrl:(s.adminUrl||'').trim(),color:s.color||'',enabled:true};
              SVC_PLAIN.forEach(k=>{ if((s[k]||'').trim()) o[k]=s[k].trim(); });
              SVC_SECRET.forEach(k=>{ if((s[k]||'').trim()) o[k]=s[k].trim(); }); /* blank → server keeps saved */
              return o;});
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'connections',
            label:wlabel, widgetSize:'medium',widgetConfig:{ view:'map', services, showLegend:state._wmapCfg.showLegend!==false }};
        }
      }else if(state._wtype==='backup'){
        /* Flush current DOM values into slot state before state.saving */
        state._wbackupCfg.slots.forEach((slot,si) => {
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
        if(state._wsize!=='small'){
          const propagate=(prov)=>{
            const fi=state._wbackupCfg.slots.findIndex(s=>s.provider===prov);
            if(fi<0) return;
            const def=state._wbackupCfg.slots[fi];
            if(def.useDefault===false) return;   /* default instance opted out → no sharing */
            state._wbackupCfg.slots.forEach((t,j)=>{
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
        for(const [si,slot] of state._wbackupCfg.slots.entries()){
          if(slot.provider==='duplicati'&&!slot.dupUrl){toast(`URL required for ${['First','Second','Third'][si]||''} Duplicati instance`,'err');return;}
          if(slot.provider==='kopia'&&!slot.kopiaUrl){toast(`URL required for ${['First','Second','Third'][si]||''} Kopia instance`,'err');return;}
        }
        /* Strip runtime-only fields before state.saving */
        const savableSlots = state._wbackupCfg.slots.map(s=>({
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
          label:wlabel,widgetSize:state._wsize,widgetConfig:{slots:savableSlots}};

      }else{
        /* stats — slot values are kept live in state._wslots by the row commit handlers */
        const slots=state._wslots.slice(0,3).map((s)=>{
          const slotColor=s.color||undefined;
          if(s.type==='disk') return {type:'disk',primary:s.primary||'/',secondary:s.secondary||undefined,color:slotColor};
          if(s.type==='temp') return {type:'temp',thermalZone:Number.isInteger(s.thermalZone)?s.thermalZone:0,color:slotColor};
          return {type:s.type,color:slotColor};
        });
        state._wnet.url      = document.getElementById('net-url')?.value?.trim()||'';
        state._wnet.provider = state._wnet.provider || 'myspeed';
        const newPass  = document.getElementById('net-pass')?.value||'';
        if (newPass) state._wnet.myspeedPass = newPass;
        /* strip passSet flag from saved config — only real pass is stored */
        const netToSave = {...state._wnet};
        delete netToSave.myspeedPassSet;

        if (state._wstatsSubType === 'disk-health') {
          const prov = (document.getElementById('dh-prov')?.value) || state._wdiskCfg.diskProvider || 'scrutiny';
          const dhUrl  = document.getElementById('dh-url')?.value?.trim()  || '';
          const dhHref = document.getElementById('dh-href')?.value?.trim() || '';
          const wcfg = { widgetSubType:'disk-health', diskProvider:prov, bays:state._wdiskCfg.bays };

          if (prov === 'truenas') {
            const u = dhUrl || state._wdiskCfg.truenasUrl;
            if (!u) { toast('TrueNAS URL is required','err'); return; }
            wcfg.truenasUrl  = u;
            wcfg.truenasHref = dhHref || undefined;
            /* Send the key only if newly entered; otherwise the server re-merges the stored one. */
            const k = document.getElementById('dh-key')?.value?.trim();
            if (k) wcfg.truenasKey = k;
          } else {
            const u = dhUrl || state._wdiskCfg.scrutinyUrl;
            if (!u) { toast('Scrutiny URL is required','err'); return; }
            wcfg.scrutinyUrl  = u;
            wcfg.scrutinyHref = dhHref || undefined;
          }

          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel,widgetSize:state._wsize,widgetConfig:wcfg};
        } else {
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel, widgetSize:state._wsize,widgetConfig:{widgetSubType:state._wstatsSubType,slots,network:netToSave}};
        }
      }
    }else if(state.ctype==='folder'){
      const label=document.getElementById('f-fname')?.value?.trim();
      if(!label){toast('Name required','err');return;}
      const cleanId=s=>s.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'folder';
      /* Prevent adding an app to multiple folders — remove it from any existing folder first */
      const children=[...document.querySelectorAll('#folder-apps-list li[aria-selected="true"]')].map(li=>li.dataset.val);
      if(!orig){
        children.forEach(cid=>{
          state.items.forEach(it=>{
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
      const finalIcon=state.siurl;
      item={
        id:orig?.id||cleanId(label)+'_'+Date.now(),
        type:'app',label,href,
        iconUrl:finalIcon,color:state.scol||'dark',
        dock:document.getElementById('f-dock')?.checked||false,
        skipTlsVerify:skipTlsVerify||undefined,
        monitoring:{
          healthcheck:{enabled:hcEn&&(!!hcCon||!!hcPing),container:hcCon,pingUrl:hcPing},
          activity:{enabled:actEn&&!!actUrl,url:actUrl,
            params:Object.keys(actParams).length?actParams:undefined,
            headers:Object.keys(actHeaders).length?actHeaders:undefined,
            extract:state.spaths.length===1?state.spaths[0]:state.spaths.length>1?state.spaths.map(p=>({path:p})):undefined,
            interval:Math.max(10,actInt),
            custom:customObj},
          staticBadge:staticBadgeObj,
        },
      };
    }
    if(state.eid!==null)state.items[state.eid]=item;else state.items.push(item);
    await save();closeModal();toast(state.eid!==null?'Updated':'Added');
  }catch(e){toast('Error: '+e.message,'err');}
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

/* ══ Logging level toggle ══ */
function initLogLevel(){
  const btn=document.getElementById('log-level-btn');
  const list=document.getElementById('log-level-list');
  const hidden=document.getElementById('log-level');
  if(!btn||!list||!hidden) return;
  const labels={debug:'Debug',info:'Info',error:'Errors'};
  function setVal(val){
    hidden.value=val;
    const textNode=btn.childNodes[0];
    if(textNode&&textNode.nodeType===3) textNode.textContent=labels[val]||val;
    list.querySelectorAll('li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===val)));
    list.hidden=true;
  }
  btn.addEventListener('click',e=>{e.stopPropagation();list.hidden=!list.hidden;});
  list.querySelectorAll('li').forEach(li=>li.addEventListener('click',()=>setVal(li.dataset.val)));
  document.addEventListener('click',()=>{list.hidden=true;});
  setVal(hidden.value||'info');
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
    state.items=d.items;await save();toast('Imported');}
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
initLogLevel();

checkAuth(load).then(ok => {
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
