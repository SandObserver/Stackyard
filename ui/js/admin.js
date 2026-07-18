import { loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=bdd2c9eb';
import { clr as rc, sanitizeCssUrl } from '/js/utils.js?v=92153ac7';
import { html, raw, setHtml } from '/js/html.js?v=1';
import { reorderItems } from '/js/admin-logic.js?v=1';
import { cleanId, buildStatsSlots, buildMapServices, finalizeBackupSlots, buildAppItem } from '/js/admin-save-logic.js?v=1';
import { WIDGET_TYPES } from '/js/widget-types.js?v=63bf4388';
import { API, toast, ag, ap, initInlineEdit } from '/js/admin-shared.js?v=6f21b1b8';
import { checkAuth, wirePasswordStrength } from '/js/admin-auth.js?v=8cd76ea3';
import { state } from '/js/admin-state.js?v=e7eb56f7';
import { buildWidgetForm } from '/js/admin-widget-form.js?v=21070bc4';
import { buildAppForm, buildFolderForm, parseKV } from '/js/admin-app-form.js?v=c3d495f0';
import { LANGUAGES, initI18n, translateText, t } from '/js/i18n.js?v=1';
import { loadSettings, showBgFields } from '/js/admin-settings.js?v=146d5567';
import { canJoinFolder, dropTargetKind } from '/js/admin-drag-logic.js?v=1';

/* Admin UI: Stackyard Dashboard */

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

async function load(){
  await loadLocalIcons();
  const c=await ag('/api/config');
  state.items=c.items||[];
  state._settings=c.settings||{};
  await initI18n(c.settings?.language || 'en');
  try{ const wr=await ag('/api/widgets'); state._widgetReg={}; (wr.widgets||[]).forEach(w=>{ state._widgetReg[w.name]=w; }); }catch{ state._widgetReg={}; }
  state.items.filter(i=>i.type==='folder').forEach(f=>collapsedFolders.add(f.id));
  document.body.classList.add('authed');
  render();
  loadSettings(c);
  applyBg();
}

async function applyBg(){
  const root=document.documentElement;
  try{
    const bg=(state._settings&&state._settings.background)||{};
    if(bg.type==='color'&&bg.color){
      root.style.setProperty('--bg-image','none');
      root.style.setProperty('--bg-color',String(bg.color).replace(/[^a-zA-Z0-9#(),.\s%]/g,''));
      root.style.setProperty('--bg-brightness','1');
    }else if(bg.type==='url'&&bg.url){
      root.style.setProperty('--bg-image',`url('${sanitizeCssUrl(bg.url)}')`);
      root.style.setProperty('--bg-color','#0d1117');
      root.style.setProperty('--bg-brightness',String(bg.brightness??0.62));
    }else if(bg.type==='unsplash'){
      const r=await fetch('/api/wallpaper',{cache:'no-store'}); const d=await r.json();
      if(d.url){ const img=new Image(); img.onload=()=>{
        root.style.setProperty('--bg-image',`url('${sanitizeCssUrl(d.url)}')`);
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
function moveRow(item,dir,opts={}){
  if(reorderItems(state.items,item,dir,opts)) save();
}

/* Constant markup only; no user data reaches these. */
const FOLDER_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"></rect><circle cx="9.7" cy="9.7" r="1.25" fill="currentColor"></circle><circle cx="14.3" cy="9.7" r="1.25" fill="currentColor"></circle><circle cx="9.7" cy="14.3" r="1.25" fill="currentColor"></circle><circle cx="14.3" cy="14.3" r="1.25" fill="currentColor"></circle></svg>';
const SIZE_ICONS = {
  small:  '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="9.7" cy="9.7" r="1" fill="currentColor"></circle><line x1="9" y1="13.4" x2="13" y2="13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></line></svg>',
  medium: '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor"></circle><line x1="10.2" y1="11.4" x2="16.5" y2="11.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="7" y1="14.3" x2="16.5" y2="14.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line></svg>',
  large:  '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5.5" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="9" cy="9" r="1.2" fill="currentColor"></circle><line x1="8" y1="12.6" x2="16" y2="12.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="8" y1="14.8" x2="16" y2="14.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line></svg>',
  xlarge: '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="9.7" cy="7" r="1.1" fill="currentColor"></circle><line x1="9" y1="10.5" x2="15" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="9" y1="12.7" x2="15" y2="12.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="9" y1="14.9" x2="15" y2="14.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="9" y1="17.1" x2="13" y2="17.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line></svg>',
};
function svgNode(markup){ const t=document.createElement('template'); setHtml(t, raw(markup)); return t.content.firstElementChild; }

/* Type of the row currently being dragged. dataTransfer is not readable during
   dragover, so we stash it here to decide whether a folder can accept the drop. */
let _dragType=null;

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
  const handle=document.createElement('div');handle.className='rord';handle.textContent='⠿';
  handle.setAttribute('aria-hidden','true');
  if(_filtering)handle.style.visibility='hidden';
  const ico=document.createElement('div');ico.className='rico';ico.style.background=rc(item.color);
  if(item.type==='folder'){
    ico.appendChild(svgNode(FOLDER_ICON));
  }else if(item.type==='widget'){
    ico.appendChild(svgNode(SIZE_ICONS[item.widgetSize]||SIZE_ICONS.medium));
  }else if(item.iconUrl){
    const img=document.createElement('img');img.alt=item.label||'';
    img.style.cssText='width:28px;height:28px;object-fit:contain;';
    const fbs=iconChain(item.iconUrl);
    if(fbs.length){
      let s=0;img.onerror=()=>{s++;if(s<fbs.length)img.src=fbs[s];else{ico.textContent=(item.label||'?')[0].toUpperCase();}};
      img.src=fbs[0];ico.appendChild(img);
    }else{ico.textContent=(item.label||'?')[0].toUpperCase();}
  }else ico.textContent=(item.label||item.id||'?')[0].toUpperCase();
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
    nm.append(chevron,document.createTextNode(item.label));
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
  const pb=document.createElement('div');pb.className='rpills';
  const pills=[];
  if(item.dock)pills.push(html`<span class="pill p-dk">Dock</span>`);
  if(item.type==='widget')pills.push(html`<span class="pill p-wg">Widget</span>`);
  if(item.type==='folder')pills.push(html`<span class="pill p-fl">Folder</span>`);
  if(item.monitoring?.healthcheck?.enabled||item.container)pills.push(html`<span class="pill p-hl">Health</span>`);
  if(item.monitoring?.activity?.enabled||item.badge?.enabled)pills.push(html`<span class="pill p-bg">Badge</span>`);
  if(item.system==='settings')pills.push(html`<span class="pill p-sy">System</span>`);
  if(item.hidden)pills.push(html`<span class="pill p-hd">Hidden</span>`);
  setHtml(pb, html`${pills}`);
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
       "top:itemId"            = top-level item being dragged
       "child:folderId:itemId" = child item being dragged
     Drop targets accept both formats and route accordingly.
  */
  const dragData = indent
    ? 'child:'+folderId+':'+item.id
    : 'top:'+item.id;

  row.addEventListener('dragstart',e=>{
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',dragData);
    _dragType=item.type;
    /* Slight delay so browser can capture drag image before dimming */
    requestAnimationFrame(()=>row.classList.add('dragging'));
  });
  row.addEventListener('dragend',()=>{
    row.classList.remove('dragging');
    _dragType=null;
    clearDragClasses();
  });
  row.addEventListener('dragover',e=>{
    e.preventDefault();e.dataTransfer.dropEffect='move';
    clearDragClasses();
    if(row.dataset.isFolder && canJoinFolder(_dragType)){
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

    if(srcFolder&&srcFolderObj){
      srcFolderObj.children=(srcFolderObj.children||[]).filter(id=>id!==srcItem.id);
    }else{
      const si=state.items.indexOf(srcItem);
      if(si>=0)state.items.splice(si,1);
    }

    /* Only apps may enter a folder; anything else dropped on one goes top level. */
    const kind=dropTargetKind({srcType:srcItem.type,targetIsFolder:item.type==='folder',indent});
    if(kind==='into-folder'&&indent){
      const tf=state.items.find(i=>i.id===folderId);
      if(!tf){state.items.push(srcItem);save();return;}
      tf.children=(tf.children||[]).filter(id=>id!==srcItem.id);
      if(!state.items.find(i=>i.id===srcItem.id))state.items.push(srcItem);
      tf.children.splice(childIdx,0,srcItem.id);
    }else if(kind==='into-folder'){
      if(!state.items.find(i=>i.id===srcItem.id))state.items.push(srcItem);
      const tf=state.items.find(i=>i.id===item.id);
      if(tf){tf.children=(tf.children||[]).filter(id=>id!==srcItem.id);tf.children.push(srcItem.id);}
    }else{
      /* Top-level move: remove from any folder and insert relative to the target
         (or, for a drop inside a folder, relative to that folder). */
      state.items.filter(f=>f.type==='folder').forEach(f=>{
        f.children=(f.children||[]).filter(id=>id!==srcItem.id);
      });
      if(!state.items.find(i=>i.id===srcItem.id))state.items.push(srcItem);
      const si2=state.items.indexOf(srcItem);
      if(si2>=0)state.items.splice(si2,1);
      const anchor=indent?state.items.find(i=>i.id===folderId):item;
      let ti2=state.items.indexOf(anchor);
      if(ti2<0)ti2=state.items.length;
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
    setHtml(l, html`<div class="empty"><p class="empty-msg">${raw(t('list.empty'))}</p></div>`);
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
    if(!matches.length){ setHtml(l, html`<div class="empty"><p class="empty-msg">${raw(t('list.noMatches'))}</p></div>`); return; }
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
      setHtml(addRow, html`<span>+</span> ${raw(t('folder.addAppToFolder'))}`);
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

/* Associate dynamically-built modal fields with their labels and give every
   toggle an accessible name from its row text. Idempotent; safe to re-run. */
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

const TYPE_ICONS={
  app:'<rect x="7" y="7" width="10" height="10" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  widget:'<rect x="3.5" y="6.5" width="17" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7.2" cy="10.2" r="1.5" fill="currentColor"/><line x1="5.6" y1="13.4" x2="17.4" y2="13.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5.6" y1="15.2" x2="17.4" y2="15.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  folder:'<rect x="6" y="6" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9.7" cy="9.7" r="1.25" fill="currentColor"/><circle cx="14.3" cy="9.7" r="1.25" fill="currentColor"/><circle cx="9.7" cy="14.3" r="1.25" fill="currentColor"/><circle cx="14.3" cy="14.3" r="1.25" fill="currentColor"/>'
};
const TYPE_LABELS={app:'App',widget:'Widget',folder:'Folder'};





function buildAddNewCard(){
  const grp=document.createElement('div');
  grp.className='grp';
  const row=document.createElement('div');
  row.className='row tile-row';
  setHtml(row, html`<span class="rl">Add New</span>`);
  const grpTiles=document.createElement('div');
  grpTiles.className='tile-grp';
  ['app','widget','folder'].forEach(t=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='tile-opt'+(t===state.ctype?' on':'');
    b.dataset.ctype=t;
    b.setAttribute('aria-pressed',String(t===state.ctype));
    b.setAttribute('aria-label','Add '+TYPE_LABELS[t]);
    setHtml(b, html`<span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${raw(TYPE_ICONS[t])}</svg></span><span class="tile-cap">${TYPE_LABELS[t]}</span>`);
    b.onclick=()=>{ if(state.ctype===t)return; state.ctype=t; _renderEditBody(); };
    grpTiles.appendChild(b);
  });
  row.appendChild(grpTiles);
  grp.appendChild(row);
  return grp;
}

/* Add New card is prepended after the builder runs, so the builder's reset can't wipe it. */
function _renderEditBody(){
  const body=document.getElementById('ev-body');
  body.innerHTML='';
  if(state.ctype==='widget') buildWidgetForm(body,state._evItem);
  else if(state.ctype==='folder') buildFolderForm(body,state._evItem);
  else buildAppForm(body,state._evItem);
  if(!state._evIsEdit) body.insertBefore(buildAddNewCard(),body.firstChild);
  translateText(body);
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

  const isEdit=idx!=null;
  document.getElementById('ev-title').textContent='General';
  const delBtn=document.getElementById('ev-delete');
  const saveBtn=document.getElementById('ev-save');
  if(delBtn){ delBtn.classList.toggle('d-none',!isEdit); delBtn.onclick=()=>_evDelete(item,idx); }
  if(saveBtn){ saveBtn.onclick=()=>doSave(item); }
  const backBtn=document.getElementById('ev-back');
  if(backBtn) backBtn.onclick=()=>closeModal();

  state._evItem=item; state._evIsEdit=isEdit;
  _renderEditBody();

  showEditView();
}

function _evDelete(item,idx){
  if(!item)return;
  if(item.type==='folder'){if(!confirm(t('confirm.deleteFolder',{name:item.label})))return;}
  else{if(!confirm(t('confirm.remove',{name:item.label||item.id})))return;}
  state.items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==item.id);});
  state.items.splice(idx,1);
  save().catch(()=>{});
  showListView();
}
{
  const s=document.getElementById('al-search');
  if(s)s.addEventListener('input',()=>{_flt.q=s.value.trim();render();});
  document.querySelectorAll('#al-filter .chip').forEach(c=>{
    c.addEventListener('click',()=>{_flt.type=c.dataset.flt;_syncFilterUI();render();});
  });
}



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
      const nm=document.createElement('span');nm.textContent=f.label;
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
      const wlabel=state._wlabel.trim()||(state._wtype==='stats'?(state._wstatsSubType==='disk-health'?'Disk Health':'System Summary'):WIDGET_TYPES[state._wtype]?.label||'Widget');
      if(state._autoForm && state._autoFormType===state._wtype && state._widgetReg[state._wtype] && !state._widgetReg[state._wtype].customEditor){
        const missing=state._autoForm.validate();
        if(missing.length){ toast(missing[0]+' is required','err'); return; }
        item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:state._wtype,
          label:wlabel,widgetSize:state._wsize,widgetConfig:state._autoForm.getValues()};
      }
      else if(state._wtype==='weather'){
        const city=document.getElementById('wx-city')?.value?.trim()||state._wweatherCfg.city;
        if(state._wweatherCfg.lat===''||state._wweatherCfg.lat==null){ toast('Search and select a city first','err'); return; }
        const wcfg={ city:state._wweatherCfg.city||city, lat:state._wweatherCfg.lat, lon:state._wweatherCfg.lon, units:state._wweatherCfg.units||'c' };
        if(state._wweatherCfg.feelsLike) wcfg.feelsLike=true;
        const href=document.getElementById('wx-href')?.value?.trim();
        if(href) wcfg.href=href;
        item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'weather',
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
        item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'custom',
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
            /* Send a key only if typed; otherwise flag it stored so the server keeps it. */
            if(k){ vpn.apiKey=k; vpn.apiKeySet=true; }
            else if(state._wvpnCfg.apiKeySet){ vpn.apiKeySet=true; }
          }else{
            const tk=(document.getElementById('vpn-token')?.value||'').trim();
            if(tk){ vpn.token=tk; vpn.tokenSet=true; }
            else if(state._wvpnCfg.tokenSet){ vpn.tokenSet=true; }
            else { toast('NetBird access token is required','err'); return; }
          }
          item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'connections',
            label:wlabel, widgetSize:state._wsize, widgetConfig:{ view:'vpn', vpn }};
        } else {
          const services=buildMapServices(state._wmapCfg.services);
          item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'connections',
            label:wlabel, widgetSize:'medium',widgetConfig:{ view:'map', services, showLegend:state._wmapCfg.showLegend!==false }};
        }
      }else if(state._wtype==='backup'){
        state._wbackupCfg.slots.forEach((slot,si) => {
          slot.customName = (document.getElementById(`bak-name-${si}`)?.value||'').trim();
          const defEl = document.getElementById(`bak-def-${si}`);
          if (defEl) slot.useDefault = defEl.checked;
          /* Only overwrite jobId from an enabled picker; a disabled (un-fetched)
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
        const _bk = finalizeBackupSlots(state._wbackupCfg.slots, state._wsize);
        if(_bk.error){ toast(_bk.error,'err'); return; }
        item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'backup',
          label:wlabel,widgetSize:state._wsize,widgetConfig:{slots:_bk.savableSlots}};

      }else{
        const slots=buildStatsSlots(state._wslots);
        state._wnet.url      = document.getElementById('net-url')?.value?.trim()||'';
        state._wnet.provider = state._wnet.provider || 'myspeed';
        const newPass  = document.getElementById('net-pass')?.value||'';
        if (newPass) state._wnet.myspeedPass = newPass;
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
            const k = document.getElementById('dh-key')?.value?.trim();
            if (k) wcfg.truenasKey = k;
          } else {
            const u = dhUrl || state._wdiskCfg.scrutinyUrl;
            if (!u) { toast('Scrutiny URL is required','err'); return; }
            wcfg.scrutinyUrl  = u;
            wcfg.scrutinyHref = dhHref || undefined;
          }

          item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel,widgetSize:state._wsize,widgetConfig:wcfg};
        } else {
          item={id:orig?.id||cleanId(wlabel,'widget')+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel, widgetSize:state._wsize,widgetConfig:{widgetSubType:state._wstatsSubType,slots,network:netToSave}};
        }
      }
    }else if(state.ctype==='folder'){
      const label=document.getElementById('f-fname')?.value?.trim();
      if(!label){toast('Name required','err');return;}
      /* Prevent adding an app to multiple folders; remove it from any existing folder first */
      const children=[...document.querySelectorAll('#folder-apps-list li[aria-selected="true"]')].map(li=>li.dataset.val);
      if(!orig){
        children.forEach(cid=>{
          state.items.forEach(it=>{
            if(it.type==='folder'&&it.children?.includes(cid))
              it.children=it.children.filter(x=>x!==cid);
          });
        });
      }
      item={id:orig?.id||cleanId(label,'folder')+'_'+Date.now(),type:'folder',label,children};
    }else{
      const isPing=document.getElementById('hc-type-ping')?.checked;
      const v={
        label: document.getElementById('f-lbl')?.value?.trim(),
        href:  document.getElementById('f-href')?.value?.trim(),
        hcEn:  document.getElementById('hc-en')?.checked,
        hcCon: isPing?'':(document.getElementById('hc-con')?.value?.trim()||''),
        hcPing:isPing?(document.getElementById('hc-ping')?.value?.trim()||''):'',
        skipTlsVerify: document.getElementById('f-skip-tls')?.checked||false,
        actEn:   document.getElementById('act-en')?.checked,
        actUrl:  document.getElementById('f-burl')?.value?.trim()||'',
        actInt:  Math.min(3600,Math.max(10,parseInt(document.getElementById('f-bint')?.value||'30',10))),
        actParams:  parseKV(document.getElementById('f-bpar')?.value||''),
        actHeaders: parseKV(document.getElementById('f-bhdr')?.value||''),
        actColor: document.getElementById('act-col-val')?.value||'#0289ff',
        custUnit: document.getElementById('bcust-unit')?.value?.trim()||'',
        staticEn:    document.getElementById('static-en')?.checked||false,
        staticLabel: document.getElementById('f-static-label')?.value?.trim()||'',
        staticColor: document.getElementById('static-col-val')?.value||'#1e6ef4',
        dock: document.getElementById('f-dock')?.checked||false,
        iconUrl: state.siurl, scol: state.scol, spaths: state.spaths,
      };
      const res=buildAppItem(v,orig);
      if(res.error){toast(res.error,'err');return;}
      item=res.item;
    }
    if(state.eid!==null)state.items[state.eid]=item;else state.items.push(item);
    await save();closeModal();toast(state.eid!==null?'Updated':'Added');
  }catch(e){toast('Error: '+e.message,'err');}
}

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

  const descInp=document.createElement('input');descInp.id='ie-desc-input';document.body.appendChild(descInp);
  initInlineEdit('ie-desc','ie-desc-input',{placeholder:'Stackyard · self-hosted homelab dashboard'});

  initInlineEdit('ie-ip','srv-ip',{placeholder:'192.168.1.100'});
  initInlineEdit('ie-socket','srv-socket',{placeholder:'tcp://socket-proxy:2375'});

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

  const apiInp=document.createElement('input');apiInp.id='bg-apikey-inp';document.body.appendChild(apiInp);
  initInlineEdit('ie-apikey','bg-apikey-inp',{placeholder:'Paste your Unsplash API key'});

  const colInp=document.createElement('input');colInp.id='bg-col-inp';document.body.appendChild(colInp);
  initInlineEdit('ie-bgcol','bg-col-inp',{placeholder:'AGVpqBZnzUE'});

  const urlInp=document.createElement('input');urlInp.id='bg-url-inp';urlInp.type='url';document.body.appendChild(urlInp);
  initInlineEdit('ie-bgurl','bg-url-inp',{placeholder:'https://example.com/photo.jpg'});

  const colorInp=document.createElement('input');colorInp.id='bg-color-inp';document.body.appendChild(colorInp);
  initInlineEdit('ie-bgcolor','bg-color-inp',{placeholder:'#0d1117'});
}

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
          setHtml(aEl, html`Version v${v} &middot; <a href="https://github.com/SandObserver/stackyard/releases/latest" target="_blank" rel="noopener" class="upd-link">Update to v${lv}</a>`);
        }
      }
    }
  }catch{}
}

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

  setVal(hidden.value||'unsplash');
}

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

function initLanguage(){
  const btn=document.getElementById('lang-btn');
  const list=document.getElementById('lang-list');
  const hidden=document.getElementById('lang-sel');
  if(!btn||!list||!hidden) return;
  const names=Object.fromEntries(LANGUAGES.map(l=>[l.code,l.name]));
  setHtml(list, html`${LANGUAGES.map(l=>html`<li role="option" data-val="${l.code}" aria-selected="false">${l.name}</li>`)}`);
  function setVal(val){
    hidden.value=val;
    const tn=btn.childNodes[0]; if(tn&&tn.nodeType===3) tn.textContent=names[val]||val;
    list.querySelectorAll('li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===val)));
    list.hidden=true;
  }
  btn.addEventListener('click',e=>{e.stopPropagation();list.hidden=!list.hidden;});
  list.querySelectorAll('li').forEach(li=>li.addEventListener('click',()=>setVal(li.dataset.val)));
  document.addEventListener('click',()=>{list.hidden=true;});
  setVal(hidden.value||'en');
}

const dashSaveEl=document.getElementById('dash-save');
if(dashSaveEl)dashSaveEl.onclick=()=>save();

document.getElementById('btn-exp').onclick=async()=>{
  try{
    const a=document.createElement('a');
    a.href=API+'/api/config/export';
    a.download='stackyard-config.json';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
  }catch(e){toast(t('toast.exportFailed',{err:e.message}),'err');}
};
document.getElementById('imp').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const d=JSON.parse(await f.text());
    if(!d||!Array.isArray(d.items))throw new Error('Invalid');
    const cur=new Map(state.items.map(i=>[i.id,i]));
    const inc=new Map(d.items.map(i=>[i.id,i]));
    let added=0,updated=0,deleted=0;
    for(const [id,it] of inc){ if(!cur.has(id)) added++; else if(JSON.stringify(cur.get(id))!==JSON.stringify(it)) updated++; }
    for(const id of cur.keys()){ if(!inc.has(id)) deleted++; }
    if(added+updated+deleted===0){ toast(t('toast.importNoChange')); e.target.value=''; return; }
    if(!confirm(t('import.confirm',{n:d.items.length,added,updated,deleted}))){ e.target.value=''; return; }
    state.items=d.items;await save();toast(t('toast.imported'));
  }
  catch(e){toast(t('toast.importFailed',{err:e.message}),'err');}
  e.target.value='';
};

document.getElementById('btn-add').onclick=()=>openModal(null);

initNav();
initAllInlineEdits();
initVersion();
initSecToggle();
initDockerToggle();
initBgType();
initLogLevel();
initLanguage();

checkAuth(load).then(ok => {
  if (!ok) return;
  load().catch(e=>{
    toast('Could not load config. Is the API container running? ('+e.message+')','err');
    const al=document.getElementById('al');
    if(al){
      setHtml(al, html`<div style="padding:32px;text-align:center;color:rgba(255,255,255,.4);font-size:14px">Failed to load dashboard config.<br><br><button onclick="location.reload()" style="padding:8px 20px;border-radius:16px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:#fff;cursor:pointer;font-size:14px;font-family:inherit;">Retry</button></div>`);
    }
  });
});
