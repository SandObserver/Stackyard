import { LOCAL_ICONS, loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=36';
import { clr as rc, esc } from '/js/utils.js?v=40';
import { WIDGET_TYPES } from '/js/widget-types.js?v=39';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=5';
import { API, toast, ag, ap, PE_SVG, CHEV_SVG, initInlineEdit, _secretRow } from '/js/admin-shared.js?v=2';
import { renderColorControl } from '/js/admin-color-control.js?v=1';
import { checkAuth, pwStrength, wirePasswordStrength } from '/js/admin-auth.js?v=1';
import { state } from '/js/admin-state.js?v=1';
import { buildWidgetForm } from '/js/admin-widget-form.js?v=1';

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



/* Folder form — settings-row system (PSD: add_new_folder).
   Folder Name = inline-edit row; Add Apps = tap-to-toggle checklist dropdown. */
function buildFolderForm(body,item){
  const children=item?.children||[];
  const apps=state.items.filter(i=>i.type==='app'&&!i.dock);
  /* In edit mode, surface current children even if they'd otherwise be filtered. */
  children.forEach(cid=>{ if(!apps.some(a=>a.id===cid)){ const a=state.items.find(i=>i.id===cid); if(a) apps.push(a); } });

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


function buildAppForm(body,item){
  const docks=state.items.filter(i=>i.type==='app'&&i.dock&&i.id!==item?.id).length;
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
        <span class="icon-prev" id="ipv" style="background:${rc(state.scol)}">${state.siurl?`<img src="${esc(resolveIcon(state.siurl))}" alt="" id="ipv-img">`:`<span>${(item?.label||'?')[0]?.toUpperCase()||'?'}</span>`}</span>
        <input class="icon-srch" id="ip-in" type="text" autocomplete="off" placeholder="Name or full URL" value="${esc(state.siurl)}">
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
        <div class="row"><span class="rl"></span><span id="bst" class="row-status">${state.spaths.length?'Saved: '+esc(state.spaths.join(' + ')):''}</span><button type="button" class="row-btn" id="bfetch">Fetch</button></div>
        <div id="bprow" class="${state.spaths.length?'':'bprow-hidden'}">
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
  renderColorControl(document.getElementById('icon-color-slot'),{value:state.scol||'dark',idPrefix:'icon-col',semantic:true,onChange(v){state.scol=v;const pv=document.getElementById('ipv');if(pv)pv.style.background=rc(state.scol);}});
  renderColorControl(document.getElementById('static-color-slot'),{value:staticBadge.color||'#0289ff',idPrefix:'static-col'});
  renderColorControl(document.getElementById('act-color-slot'),{value:actCustom.color||'#0289ff',idPrefix:'act-col'});

  /* Icon search/upload */
  wireIcon();
  if(state.siurl)updPrev();

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
  document.getElementById('bsearch')?.addEventListener('input',e=>renderBadgeList(state.fnums,false,e.target.value));
  if(state.spaths.length){['bprow','auth-row-wrap','poll-row'].forEach(id=>document.getElementById(id)?.classList.remove('bprow-hidden'));renderBadgeList([],true);}
}

function wireIcon(){
  const inp=document.getElementById('ip-in'),rs=document.getElementById('iprs');
  if(!inp)return;
  let t;
  inp.oninput=()=>{
    const v=inp.value.trim();
    /* Full URL — use directly */
    if(v.startsWith('http://')||v.startsWith('https://')){state.siurl=v;updPrev();rs.classList.remove('open');return;}
    /* Shorthand like "radarr.svg" or "radarr" — resolve and preview immediately */
    if(v&&!v.includes('/')){
      state.siurl=v;updPrev();
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
        state.siurl=d.filename;
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
    r.onclick=()=>{state.siurl=ic.svgUrl;document.getElementById('ip-in').value=ic.svgUrl;updPrev();rs.classList.remove('open');};
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
    r.onclick=()=>{state.siurl=val;document.getElementById('ip-in').value=val;updPrev();rs.classList.remove('open');};
    rs.appendChild(r);
  }
  if(rs.children.length)rs.classList.add('open');
  else rs.classList.remove('open');
}
function updPrev(){
  const p=document.getElementById('ipv');if(!p)return;
  p.style.background=rc(state.scol);
  if(!state.siurl){const l=document.getElementById('f-lbl')?.value||'?';p.innerHTML=`<span>${l[0]?.toUpperCase()||'?'}</span>`;return;}
  const fallbacks=iconChain(state.siurl);
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
    out.push({path:countPath,value:obj.length,label:`Total count (${obj.length} state.items)`});
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
    state.fnums=r.numbers||[];
    if(st){
      st.style.cssText='margin-top:4px;color:#34c759';
      if(!state.fnums.length) st.textContent='✓ Connected, no numeric values found';
      else st.textContent=`✓ Found ${state.fnums.length} value${state.fnums.length!==1?'s':''}`;
    }
    ['bprow','auth-row-wrap','poll-row'].forEach(id=>document.getElementById(id)?.classList.remove('bprow-hidden'));
    if(state.fnums.length) renderBadgeList(state.fnums,false);
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
    if(state.spaths.length){
      state.spaths.forEach(p=>{
        const it=document.createElement('div');it.className='bi on';
        it.innerHTML=`<div class="bck"></div><div class="binfo"><div class="blabel">${esc(p)}</div><div class="bpath">${esc(p)}</div></div>`;
        it.onclick=()=>{const i=state.spaths.indexOf(p);if(i>=0){state.spaths.splice(i,1);it.classList.remove('on');}else{state.spaths.push(p);it.classList.add('on');}};
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
    const it=document.createElement('div');it.className='bi'+(state.spaths.includes(path)?' on':'');
    const displayLabel=label||path;
    it.innerHTML=`<div class="bck"></div><div class="binfo"><div class="blabel">${esc(displayLabel)}</div><div class="bpath">${esc(path)}</div></div><div class="bval">${value}</div>`;
    it.onclick=()=>{const i=state.spaths.indexOf(path);if(i>=0){state.spaths.splice(i,1);it.classList.remove('on');}else{state.spaths.push(path);it.classList.add('on');}};
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
       so state.saving it before would cause the subsequent config write to overwrite it with nothing */
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
