import { LOCAL_ICONS, loadLocalIcons, resolveIcon, iconChain } from '/js/icons.js?v=36';
import { WIDGET_TYPES, widgetSrc } from '/js/widget-types.js?v=36';
import { clr as rc } from '/js/utils.js?v=36';

/* Admin UI — Stackyard Dashboard */
const API = '';
let items=[],eid=null,saving=false,_settings={};
const collapsedFolders=new Set(); /* tracks which folder ids are collapsed */
let ctype='app',siurl='',scol='dark',spaths=[],fnums=[];

/* Returns true when dark (#1c1c1e) text gives better contrast than white against hex bg */
function needsDarkText(hex){
  try{
    const h=(hex||'').replace(/^#/,'');
    if(h.length!==6)return false;
    const [r,g,b]=[0,2,4].map(i=>{const v=parseInt(h.slice(i,i+2),16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
    const L=0.2126*r+0.7152*g+0.0722*b;
    return (L+0.05)/0.05 > 1.05/(L+0.05); /* dark contrast > white contrast */
  }catch{return false;}
}
let tt;
const toast=(m,t='ok')=>{const e=document.getElementById('toast');e.textContent=m;
  e.className=`show ${t}`;clearTimeout(tt);tt=setTimeout(()=>e.className='',3000);};

const ag=async p=>{const r=await fetch(API+p,{cache:'no-store'});if(r.status===401){const e=new Error('Unauthorised');e.status=401;throw e;}if(!r.ok)throw new Error('HTTP '+r.status);return r.json();};
const ap=async(p,b)=>{const r=await fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(r.status===401){const e=new Error('Unauthorised');e.status=401;throw e;}if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'HTTP '+r.status);}return r.json();};
const COLLAPSE_KEY='admin_collapsed';
function loadCollapsed(){try{return JSON.parse(localStorage.getItem(COLLAPSE_KEY)||'{}');}catch{return{};}}
function saveCollapsed(s){localStorage.setItem(COLLAPSE_KEY,JSON.stringify(s));}
function initCards(){
  const state=loadCollapsed();
  document.querySelectorAll('.lh').forEach(lh=>{
    const id=lh.id.replace('lh-','');
    const body=document.getElementById('body-'+id);
    if(!body)return;
    /* card-body-server has display:flex in CSS which overrides display:none from .card-body.
       For that card we manage visibility via inline style instead of class toggling. */
    const useInlineDisplay=body.classList.contains('card-body-server');
    const defaultOpen=(id==='apps');
    const isOpen=state[id]!==undefined?state[id]:defaultOpen;
    if(useInlineDisplay){
      body.style.display=isOpen?'flex':'none';
      if(isOpen) lh.classList.add('open');
    } else {
      if(isOpen){lh.classList.add('open');body.classList.add('open');}
    }
    lh.setAttribute('aria-expanded', String(isOpen));
    const toggle=()=>{
      const open=lh.classList.toggle('open');
      if(useInlineDisplay){
        body.style.display=open?'flex':'none';
      } else {
        body.classList.toggle('open',open);
      }
      lh.setAttribute('aria-expanded', String(open));
      const s=loadCollapsed();s[id]=open;saveCollapsed(s);
    };
    lh.addEventListener('click',toggle);
    lh.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } });
  });
}

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
  if (pw.length < 8) return { score:1, label:'Too short — min 8 characters', color:'#ff453a', ok:false };
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

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

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

function clearDragClasses(target){
  const rows=target?[target]:document.querySelectorAll('.row');
  rows.forEach(r=>{r.classList.remove('drag-above','drag-below','drag-into','drag-over');});
}

function mkRow(item,idx,{indent=false,childIdx=null,folderId=null}={}){
  const row=document.createElement('div');row.className='row';
  if(indent)row.style.cssText='padding-left:28px;background:rgba(255,255,255,.02);border-left:2px solid var(--bd);margin-left:8px;border-radius:0 var(--rs) var(--rs) 0;';
  row.draggable=true;
  /* Drag handle */
  const handle=document.createElement('div');handle.className='rord';handle.textContent='⠿';
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
  }else{
    nm.textContent=item.label||item.id;
  }
  const mt=document.createElement('div');mt.className='rmt';
  if(item.type==='widget'){
    const wt=item.widgetType||'custom';
    const wtLabel=wt==='stats'?'Stats':(wt==='connections'||wt==='map')?'Connections':wt==='adguard'?'AdGuard':wt==='github'?'GitHub':wt==='clock'?'Clock':wt==='duplicati'?'Backup':'Custom';
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
  if(item.type!=='folder'){
    const dup=document.createElement('button');dup.className='btn bg sm ic';dup.title='Duplicate';dup.textContent='⊙';
    dup.onclick=()=>{const c=JSON.parse(JSON.stringify(item));c.id=c.id+'_'+Date.now();
      if(folderId){/* insert into same folder */
        const f=items.find(i=>i.id===folderId);
        if(f){f.children=f.children||[];f.children.splice(childIdx+1,0,c.id);items.push(c);}
      }else{items.splice(idx+1,0,c);}save();};
    const fl=document.createElement('button');fl.className='btn bg sm ic';fl.title='Move to folder';fl.textContent='📁';
    fl.onclick=()=>openFolderPicker(item.id);
    const ed=document.createElement('button');ed.className='btn bg sm';ed.textContent='Edit';ed.onclick=()=>openModal(idx);
    ac.append(dup,fl,ed);
  }else{
    const ed=document.createElement('button');ed.className='btn bg sm';ed.textContent='Edit';ed.onclick=()=>openModal(idx);
    ac.append(ed);
  }
  const dl=document.createElement('button');dl.className='btn bd-btn sm ic';dl.title='Delete';dl.textContent='×';
  dl.onclick=()=>{
    if(item.type==='folder'){if(!confirm(`Delete folder "${item.label}"? Apps inside will not be deleted.`))return;}
    else{if(!confirm(`Remove "${item.label||item.id}"?`))return;}
    /* Remove from any folder */
    items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==item.id);});
    items.splice(idx,1);
    const wasLastGithub=item.type==='widget'&&item.widgetType==='github'
      &&items.filter(i=>i.type==='widget'&&i.widgetType==='github').length===0;
    /* Save first, then clear token after save completes so the GET /api/config
       inside save() doesn't re-read and re-write the token over our deletion */
    save().then(()=>{
      if(wasLastGithub){
        fetch('/api/github-token',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({token:''})}).then(()=>{
          _settings.githubTokenSet=false;
          delete _settings.githubToken;
        }).catch(()=>{});
      }
    }).catch(()=>{});
  };
  ac.appendChild(dl);
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
  if(!items.length){
    l.innerHTML='<div class="empty"><p class="empty-msg">No apps yet. Click + Add.</p></div>';
    return;
  }
  l.innerHTML='';
  /* IDs in folders — skip them in the top-level pass */
  const inFolder=new Set(items.filter(i=>i.type==='folder').flatMap(f=>f.children||[]));
  items.forEach((item,idx)=>{
    if(item.type!=='folder'&&inFolder.has(item.id))return; /* rendered under folder */
    l.appendChild(mkRow(item,idx));
    /* If folder, render children underneath (unless collapsed) */
    if(item.type==='folder'){
      if(!collapsedFolders.has(item.id)){
        (item.children||[]).forEach((childId,ci)=>{
          const childItem=items.find(i=>i.id===childId);
          if(!childItem)return;
          const childIdx=items.indexOf(childItem);
          l.appendChild(mkRow(childItem,childIdx,{indent:true,childIdx:ci,folderId:item.id}));
        });
      }
      /* "Add app to folder" button at end of children (only when expanded) */
      if(!collapsedFolders.has(item.id)){
      /* "Add app to folder" button at end of children */
      const addRow=document.createElement('div');
      addRow.style.cssText='padding:6px 12px 6px 36px;display:flex;align-items:center;gap:8px;'+
        'color:var(--ac);font-size:13px;cursor:pointer;border-left:2px solid var(--bd);margin-left:8px;'+
        'border-radius:0 var(--rs) var(--rs) 0;background:rgba(255,255,255,.01);';
      addRow.innerHTML='<span>+</span> Add app to this folder';
      addRow.onclick=()=>openFolderPicker(null,item.id);
      l.appendChild(addRow);
      }
    }
  });
}

document.getElementById('btn-exp').onclick=()=>{location.href=API+'/api/config/export';};
document.getElementById('imp').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const d=JSON.parse(await f.text());if(!d.items)throw new Error('Invalid');
    items=d.items;await save();toast('Imported');}
  catch(e){toast('Import failed: '+e.message,'err');}
  e.target.value='';
};

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
function openModal(idx){
  eid=idx??null;
  const item=idx!=null?JSON.parse(JSON.stringify(items[idx])):null;
  document.getElementById('mt').textContent=idx!=null?'Edit':'Add';
  ctype=item?.type||'app';
  siurl=item?.iconUrl||'';
  scol=item?.color||'dark';
  _customUrl=item?.url||'';  /* preserve existing custom widget URL */
  _iframeOpts=item?.iframe?{...item.iframe}:{};
  fnums=[];spaths=[];
  if(item?.monitoring?.activity?.extract){
    const ex=Array.isArray(item.monitoring.activity.extract)?item.monitoring.activity.extract:[item.monitoring.activity.extract];
    spaths=ex.map(e=>typeof e==='string'?e:e.path).filter(Boolean);
  }else if(item?.badge?.extract){
    const ex=Array.isArray(item.badge.extract)?item.badge.extract:[item.badge.extract];
    spaths=ex.map(e=>typeof e==='string'?e:e.path).filter(Boolean);
  }
  buildTypeSwitch(item);
  buildFormBody(item);
  const ov=document.getElementById('ov');
  _modalPrevFocus=document.activeElement;
  ov.classList.add('open');
  ov.setAttribute('aria-hidden','false');
  _ensureFieldObserver();
  _a11yFields(ov.querySelector('.modal'));
  document.addEventListener('keydown',_modalKeydown,true);
  /* Focus the first usable control inside the modal */
  const first=ov.querySelector('input:not([type=hidden]),select,textarea,button:not(.mx)');
  if(first) setTimeout(()=>{ try{ first.focus(); }catch{} },0);
  document.getElementById('msave').onclick=()=>doSave(item);
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
document.getElementById('mcls').onclick=closeModal;
document.getElementById('mcan').onclick=closeModal;
/* Use pointerdown/pointerup instead of click to prevent iOS Safari ghost taps
   from dismissing the modal when tapping non-interactive content inside it.
   Only close if the gesture both started and ended on the backdrop itself. */
let _ovDownTarget=null;
document.getElementById('ov').addEventListener('pointerdown',e=>{_ovDownTarget=e.target;});
document.getElementById('ov').addEventListener('pointerup',e=>{const ov=document.getElementById('ov');if(_ovDownTarget===ov&&e.target===ov)closeModal();_ovDownTarget=null;});
function closeModal(){
  const ov=document.getElementById('ov');
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden','true');
  document.removeEventListener('keydown',_modalKeydown,true);
  if(_modalPrevFocus&&_modalPrevFocus.focus){ try{ _modalPrevFocus.focus(); }catch{} _modalPrevFocus=null; }
  eid=null;
  /* Reset widget state so stale values don't bleed into the next modal open */
  _wtype='custom';_wsize='medium';_wslots=[];_wnet={enabled:false,url:'',provider:'myspeed'};
  _wmapCfg={};_wconnView='map';_wvpnCfg={};_customUrl='';_wlabel='';_wadguardCfg={};_wgithubCfg={};_wclockCfg={};_wduplicatiCfg={};_wstatsSubType='system-summary';_wdiskCfg={scrutinyUrl:'',scrutinyHref:'',bays:[]};_iframeOpts={};
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

/* Derive allowed sizes from WIDGET_TYPES — automatically stays in sync when types are added */
const WIDGET_SIZES = Object.fromEntries(
  Object.entries(WIDGET_TYPES).map(([k,v]) => [k, v.sizes])
);
const SIZE_LABELS = { small:'Small', medium:'Medium', large:'Large', xlarge:'Extra Large' };
const STAT_TYPES  = ['cpu','ram','temp','disk'];
const STAT_LABELS = { cpu:'CPU', ram:'RAM', temp:'Temp', disk:'Disk' };

/* State for current widget config while modal is open */
let _wtype='custom', _wsize='medium', _wslots=[], _wnet={enabled:false,url:'',provider:'myspeed'}, _wmapCfg={}, _wconnView='map', _wvpnCfg={}, _customUrl='', _wlabel='', _wadguardCfg={}, _wgithubCfg={}, _wclockCfg={}, _wduplicatiCfg={}, _wstatsSubType='system-summary', _wdiskCfg={scrutinyUrl:'',scrutinyHref:'',bays:[]}, _iframeOpts={};

function buildWidgetForm(body,item){
  const wt0 = item?.widgetType || 'custom';
  const wt = (wt0==='map') ? 'connections' : wt0;  /* legacy map widgets migrate to connections */
  const ws = item?.widgetSize || 'medium';
  const wc = item?.widgetConfig || {};
  _wtype = wt; _wsize = ws;
  _wlabel = item?.label || '';
  /* Restore slots */
  _wslots = (wc.slots || [{type:'cpu'},{type:'ram'},{type:'disk',primary:'/',secondary:''}]);
  while(_wslots.length < 3) _wslots.push({type:'cpu'});
  _wstatsSubType = wc.widgetSubType || 'system-summary';
  if (_wstatsSubType === 'disk-health') {
    _wdiskCfg = {
      scrutinyUrl:  wc.scrutinyUrl  || '',
      scrutinyHref: wc.scrutinyHref || '',
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
  _wadguardCfg = {
    url:     wc.adguardUrl     || '',
    user:    wc.adguardUser    || '',
    passSet: wc.adguardPassSet || false,
    href:    wc.adguardHref    || '',
    /* adguardPass is never sent to the browser — passSet tells us one is stored */
  };
  _wgithubCfg = {
    user:      wc.githubUser       || '',
    prFilter:  wc.githubPrFilter   || 'created',
    prFilters: wc.githubPrFilters  || [wc.githubPrFilter||'created'],
    view:      wc.githubView       || 'prs',
    href:      wc.githubHref       || '',
    tokenSet:  !!(_settings.githubTokenSet || _settings.githubToken),
  };
  _wclockCfg = {
    style:    wc.clockStyle    || 'digital',
    mode:     wc.clockMode     || 'dark',
    timezone: wc.clockTimezone || '',
    showDate: wc.clockShowDate !== false,
  };
  _wduplicatiCfg = {
    /* Per-slot useDefault: first instance of a provider is its default; later
       instances use that default unless turned off (then they get their own container). */
    slots: _normBackupSlots(wc.slots, _wsize),
  };
  _renderWidgetForm(body);
}

function _renderWidgetForm(body){
  body.innerHTML='';

    const nameDiv=document.createElement('div');nameDiv.className='fr';
  const nameLbl=document.createElement('label');nameLbl.textContent='Name';
  const nameInp=document.createElement('input');
  nameInp.className='fc';nameInp.id='f-wlabel';nameInp.type='text';
  nameInp.placeholder='My Widget';nameInp.value=_wlabel;
  nameInp.oninput=e=>{_wlabel=e.target.value;};
  const nameHint=document.createElement('div');nameHint.className='hint';
  nameHint.textContent='Shown as the item label in the dashboard list.';
  nameDiv.append(nameLbl,nameInp,nameHint);
  body.appendChild(nameDiv);

  const typeDiv=document.createElement('div');typeDiv.className='fr';
  typeDiv.innerHTML='<label>Widget Type</label>';
  const typeSel=document.createElement('select');typeSel.className='fc';typeSel.id='f-wtype';
  Object.entries(WIDGET_TYPES).filter(([,def])=>!def.legacy).sort(([,a],[,b])=>a.label.localeCompare(b.label)).forEach(([t,def])=>{
    const o=document.createElement('option');o.value=t;o.textContent=def.label;
    if(t===_wtype) o.selected=true;
    typeSel.appendChild(o);
  });
  typeSel.onchange=()=>{ _wtype=typeSel.value; _wsize=WIDGET_SIZES[_wtype][0]; _renderWidgetForm(body); };
  typeDiv.appendChild(typeSel);
  body.appendChild(typeDiv);

  /* GitHub sub-type chips — shown between Widget Type and Size, only for github */
  if(_wtype==='github'){
    const curView=_wgithubCfg.view||'prs';
    const ghViewDiv=document.createElement('div');ghViewDiv.className='fr';
    ghViewDiv.innerHTML='<label>View</label>';
    const ghViewRow=document.createElement('div');ghViewRow.className='wtype-row';
    [['prs','Pull Requests'],['contributions','Contribution Graph']].forEach(([v,l])=>{
      const b=document.createElement('button');b.type='button';
      b.className='wchip'+(v===curView?' on':'');
      b.textContent=l;
      b.onclick=()=>{
        _wgithubCfg.view=v;
        if(v==='contributions'&&(_wsize==='large'||_wsize==='xlarge')) _wsize='medium';
        _renderWidgetForm(body);
      };
      ghViewRow.appendChild(b);
    });
    ghViewDiv.appendChild(ghViewRow);
    body.appendChild(ghViewDiv);
  }

  /* Clock style chips — shown between Widget Type and Size, only for clock */
  if(_wtype==='clock'){
    const curStyle=_wclockCfg.style||'digital';
    const clkStyleDiv=document.createElement('div');clkStyleDiv.className='fr';
    clkStyleDiv.innerHTML='<label>Style</label>';
    const clkStyleRow=document.createElement('div');clkStyleRow.className='wtype-row';
    clkStyleRow.setAttribute('role','group');clkStyleRow.setAttribute('aria-label','Clock style');
    [['digital','Digital'],['analog','Analog']].forEach(([v,l])=>{
      const b=document.createElement('button');b.type='button';
      b.className='wchip'+(v===curStyle?' on':'');
      b.setAttribute('aria-pressed',String(v===curStyle));
      b.textContent=l;
      b.onclick=()=>{ _wclockCfg.style=v; _renderWidgetForm(body); };
      clkStyleRow.appendChild(b);
    });
    clkStyleDiv.appendChild(clkStyleRow);
    body.appendChild(clkStyleDiv);
  }

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
  const _ghContrib=(_wtype==='github'&&(_wgithubCfg.view||'prs')==='contributions');
  let _sizeOpts=(WIDGET_SIZES[_wtype]||['medium']).filter(s=>!(_ghContrib&&(s==='large'||s==='xlarge')));
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
      if(_wtype==='duplicati'){
        _wduplicatiCfg.slots=_normBackupSlots(_wduplicatiCfg.slots, s);
        const cfgBody=body.querySelector('#bak-cfg-body');
        if(cfgBody){ cfgBody.innerHTML=''; _renderDuplicatiConfig(cfgBody); }
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
  if(_wtype==='stats')        _renderStatsConfig(body);
  else if(_wtype==='connections') _renderConnectionsConfig(body);
  else if(_wtype==='adguard') _renderAdguardConfig(body);
  else if(_wtype==='github')  _renderGithubConfig(body);
  else if(_wtype==='clock')   _renderClockConfig(body);
  else if(_wtype==='duplicati'){ const d=document.createElement('div');d.id='bak-cfg-body';body.appendChild(d);_renderDuplicatiConfig(d); }
  else                        _renderCustomConfig(body);
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

    /* Scrutiny URL + inline fetch button */
    const urlRow=document.createElement('div');urlRow.className='fr';
    urlRow.innerHTML=`<label for="dh-url">Scrutiny URL</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="fc" id="dh-url" type="text" placeholder="scrutiny:8080"
          value="${esc(_wdiskCfg.scrutinyUrl||'')}" style="flex:1;margin:0">
        <button type="button" id="dh-load" class="btn bg sm" style="flex-shrink:0;white-space:nowrap">Fetch Drives</button>
      </div>`;
    body.appendChild(urlRow);

    /* Status message — sits right under URL row */
    const dhMsg=document.createElement('div');dhMsg.id='dh-msg';dhMsg.className='hint';
    dhMsg.style.marginTop='-4px';body.appendChild(dhMsg);

    /* Scrutiny link-out href */
    const hrefRow=document.createElement('div');hrefRow.className='fr';
    hrefRow.innerHTML=`<label for="dh-href">Link URL <span style="opacity:.45;font-weight:400">(optional)</span></label>
      <input class="fc" id="dh-href" type="text" placeholder="https://your-server:8080"
        value="${esc(_wdiskCfg.scrutinyHref||'')}">`;
    body.appendChild(hrefRow);

    /* Bay assignment section */
    const bayHd=document.createElement('div');bayHd.className='stl';
    bayHd.style.cssText='margin-top:14px;margin-bottom:8px';
    bayHd.textContent=`Bays (${bayCount})`;body.appendChild(bayHd);

    /* Bay rows container */
    const bayRows=document.createElement('div');bayRows.id='dh-bay-rows';body.appendChild(bayRows);

    /* Available devices cache */
    let _devices=[];

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
        sel.id='dh-bay-'+i; lbl.setAttribute('for', sel.id); sel.setAttribute('aria-label','Bay '+(i+1)+' drive');

        const emptyOpt=document.createElement('option');
        emptyOpt.value='';emptyOpt.textContent='— Empty —';
        sel.appendChild(emptyOpt);

        _devices.forEach(dev=>{
          const opt=document.createElement('option');
          opt.value=dev.device_id;
          const cap=dev.capacity
            ?(dev.capacity>=1e12?(dev.capacity/1e12).toFixed(1)+' TB':(dev.capacity/1e9).toFixed(0)+' GB')
            :'';
          opt.textContent=(dev.model_name||dev.device_name)+(cap?' — '+cap:'');
          sel.appendChild(opt);
        });

        sel.value=_wdiskCfg.bays[i]||'';
        sel.onchange=()=>{ _wdiskCfg.bays[i]=sel.value||null; };

        row.append(lbl,sel);bayRows.appendChild(row);
      }
    }

    const loadBtn=document.getElementById('dh-load');
    loadBtn.onclick=async()=>{
      const url=document.getElementById('dh-url')?.value?.trim();
      if(!url){dhMsg.textContent='Enter a Scrutiny URL first.';dhMsg.style.color='#e9152d';return;}
      _wdiskCfg.scrutinyUrl=url;
      loadBtn.disabled=true;loadBtn.textContent='Fetching…';dhMsg.textContent='';
      try{
        const r=await fetch(`/api/scrutiny-proxy?url=${encodeURIComponent(url)}`);
        if(!r.ok) throw new Error('HTTP '+r.status);
        const d=await r.json();
        _devices=d.devices||[];
        if(!_devices.length){dhMsg.textContent='No SMART-enabled drives found.';dhMsg.style.color='#ffcc00';}
        else{dhMsg.textContent=_devices.length+' drive(s) found.';dhMsg.style.color='#008932';}
        renderBayRows();
      }catch(e){
        dhMsg.textContent='Failed to reach Scrutiny: '+e.message;dhMsg.style.color='#e9152d';
      }finally{
        loadBtn.disabled=false;loadBtn.textContent='Fetch Drives';
      }
    };

    /* Render empty bay rows immediately */
    renderBayRows();
    /* Auto-fetch if URL already configured */
    if(_wdiskCfg.scrutinyUrl) loadBtn.click();
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

  /* ── Slot 4 — Network Speed ── */
  const netCard=document.createElement('div');netCard.className='slot-card';
  const netHdr=document.createElement('div');netHdr.className='slot-hd';
  const netLbl=document.createElement('div');netLbl.className='slot-lbl';netLbl.textContent='Slot 4 — Network Speed';
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
      placeholder="${_wnet.myspeedPassSet?'••••••••  (saved — leave blank to keep)':'Leave blank if no password set'}"
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
    <div class="hint">Zone 0 is correct for most systems. Only change this if the temperature shown is wrong — check <code>/sys/class/thermal/</code> on your host to find the right zone number.</div></div>`;
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
  intro.textContent='Add a card per service. Multiple of the same type are fine.';
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
      empty.textContent='No services yet — add one below.';
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

function _renderClockConfig(body){
  /* ── Mode ── */
  const modeDiv=document.createElement('div');modeDiv.className='fr';
  modeDiv.innerHTML='<label>Mode</label>';
  const modeRow=document.createElement('div');modeRow.className='wtype-row';
  modeRow.setAttribute('role','group');modeRow.setAttribute('aria-label','Clock mode');
  [['dark','Dark'],['light','Light']].forEach(([v,l])=>{
    const b=document.createElement('button');b.type='button';
    b.className='wchip'+(_wclockCfg.mode===v?' on':'');b.textContent=l;
    b.setAttribute('aria-pressed',String(_wclockCfg.mode===v));
    b.onclick=()=>{_wclockCfg.mode=v;modeRow.querySelectorAll('.wchip').forEach(c=>{const on=c===b;c.classList.toggle('on',on);c.setAttribute('aria-pressed',String(on));});};
    modeRow.appendChild(b);
  });
  modeDiv.appendChild(modeRow);body.appendChild(modeDiv);

  const div1=document.createElement('div');div1.className='div';body.appendChild(div1);

  /* ── Show date ── */
  const dateRow=document.createElement('div');dateRow.className='trow trow-noborder';
  dateRow.innerHTML=`<div><div class="tlbl">Show date</div><div class="tdsc">Display day and date below the time</div></div>
    <label class="tog"><input type="checkbox" id="clk-date" ${_wclockCfg.showDate?'checked':''}><div class="tr"></div></label>`;
  body.appendChild(dateRow);
  dateRow.querySelector('#clk-date').onchange=e=>{_wclockCfg.showDate=e.target.checked;};

  const div2=document.createElement('div');div2.className='div';body.appendChild(div2);

  /* ── Timezone ── */
  const tzHd=document.createElement('div');tzHd.className='stl';tzHd.textContent='Timezone';body.appendChild(tzHd);
  const tzRow=document.createElement('div');tzRow.className='trow trow-noborder';
  tzRow.innerHTML=`<div><div class="tlbl">Custom timezone</div><div class="tdsc">Override browser local time</div></div>
    <label class="tog"><input type="checkbox" id="clk-tz-en" ${_wclockCfg.timezone?'checked':''}><div class="tr"></div></label>`;
  body.appendChild(tzRow);
  const tzSub=document.createElement('div');tzSub.className='sub'+(_wclockCfg.timezone?' open':'');

  /* Common IANA timezone list */
  const TZ_LIST=[
    'Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi',
    'America/Anchorage','America/Chicago','America/Denver','America/Halifax',
    'America/Los_Angeles','America/Mexico_City','America/New_York',
    'America/Phoenix','America/Sao_Paulo','America/St_Johns','America/Toronto',
    'America/Vancouver','Asia/Bangkok','Asia/Colombo','Asia/Dubai',
    'Asia/Hong_Kong','Asia/Jakarta','Asia/Karachi','Asia/Kolkata',
    'Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Taipei',
    'Asia/Tehran','Asia/Tokyo','Atlantic/Azores','Australia/Adelaide',
    'Australia/Brisbane','Australia/Perth','Australia/Sydney',
    'Europe/Amsterdam','Europe/Athens','Europe/Berlin','Europe/Brussels',
    'Europe/Bucharest','Europe/Budapest','Europe/Dublin','Europe/Helsinki',
    'Europe/Istanbul','Europe/Kiev','Europe/Lisbon','Europe/London',
    'Europe/Madrid','Europe/Moscow','Europe/Oslo','Europe/Paris',
    'Europe/Prague','Europe/Rome','Europe/Stockholm','Europe/Vienna',
    'Europe/Warsaw','Europe/Zurich','Pacific/Auckland','Pacific/Fiji',
    'Pacific/Honolulu','Pacific/Midway','UTC',
  ];
  const sel=document.createElement('select');sel.className='fc';sel.id='clk-tz-val';
  TZ_LIST.forEach(tz=>{
    const o=document.createElement('option');o.value=tz;o.textContent=tz.replace('_',' ');
    if(tz===_wclockCfg.timezone)o.selected=true;
    sel.appendChild(o);
  });
  const tzFr=document.createElement('div');tzFr.className='fr fr-mb0';
  const tzLbl=document.createElement('label');tzLbl.textContent='Select timezone';tzLbl.htmlFor='clk-tz-val';
  const tzHint=document.createElement('div');tzHint.className='hint';
  tzHint.textContent='IANA timezone name. The widget will show time in this zone regardless of your browser.';
  tzFr.append(tzLbl,sel,tzHint);
  tzSub.appendChild(tzFr);
  body.appendChild(tzSub);

  tzRow.querySelector('#clk-tz-en').onchange=e=>{
    const open=e.target.checked;
    tzSub.classList.toggle('open',open);
    if(!open)_wclockCfg.timezone='';
    else _wclockCfg.timezone=sel.value;
  };
  sel.onchange=()=>{_wclockCfg.timezone=sel.value;};
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
      <div class="hint">What address info the embedded page is told you came from. Leave Default unless the page needs it.</div>
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
      <div class="hint">Reload the widget every N milliseconds (1000 = 1s). Leave empty to never auto-reload.</div>
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
  const slots = _wduplicatiCfg.slots;
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
    btn.textContent = opt.disabled ? (opt.placeholder||'—') : (t!=null?t:(opt.placeholder||'— none —'));
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

function _renderDuplicatiConfig(body){
  const esc2 = s => String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const slotCount = _wsize === 'small' ? 1 : 3;
  const SLOT_NAMES = ['First','Second','Third'];
  const slots = _wduplicatiCfg.slots;
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
  const rerender = () => { flushDom(); body.innerHTML=''; _renderDuplicatiConfig(body); };

  function addNameField(div, si){
    const slot=slots[si];
    const w=document.createElement('div'); w.className='fr';
    w.innerHTML=`<label for="bak-name-${si}">Display name <span class="opt-span">(optional)</span></label>
      <input class="fc" id="bak-name-${si}" type="text" placeholder="Shown on the card"
        value="${esc2(slot.customName||'')}">
      <div class="hint">Overrides the backup name on the widget — handy for Kopia's long path names.</div>`;
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
                          : `Reuse the default ${PLABEL(prov)} container — turn off to set its own.`;
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
            value="${esc2(slot.dupUrl)}" style="flex:1;min-width:0">
          <button type="button" class="btn bg sm" id="dup-fetch-${si}" style="flex-shrink:0;white-space:nowrap">Fetch Jobs</button>
        </div>`;
      div.appendChild(urlWrap);

      const passWrap=document.createElement('div');passWrap.className='fr';
      passWrap.innerHTML=`<label for="dup-pass-${si}">Password <span class="opt-span">(${(slot.dupPassSet||slot.dupPass)?'saved':'optional'})</span></label>
        <input class="fc" id="dup-pass-${si}" type="password" autocomplete="new-password"
          placeholder="${(slot.dupPassSet||slot.dupPass)?'\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf  (saved — leave blank to keep)':'Enter if required'}">`;
      div.appendChild(passWrap);

      const hrefWrap=document.createElement('div');hrefWrap.className='fr';
      hrefWrap.innerHTML=`<label for="dup-href-${si}">Click URL <span class="opt-span">(optional)</span></label>
        <input class="fc" id="dup-href-${si}" type="text" placeholder="http://duplicati:8200"
          value="${esc2(slot.dupHref)}">`;
      div.appendChild(hrefWrap);

      const pollWrap=document.createElement('div');pollWrap.className='fr';
      pollWrap.innerHTML=`<label for="dup-poll-${si}">Poll interval <span class="opt-span">(sec)</span></label>
        <input class="fc" id="dup-poll-${si}" type="number" min="10" max="3600"
          value="${esc2(slot.dupPollSec)}" style="width:90px">`;
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
            value="${esc2(slot.kopiaUrl)}" style="flex:1;min-width:0">
          <button type="button" class="btn bg sm" id="kopia-fetch-${si}" style="flex-shrink:0;white-space:nowrap">Fetch Sources</button>
        </div>`;
      div.appendChild(urlWrap);

      const userWrap=document.createElement('div');userWrap.className='fr';
      userWrap.innerHTML=`<label for="kopia-user-${si}">Username <span class="opt-span">(optional)</span></label>
        <input class="fc" id="kopia-user-${si}" type="text" placeholder="admin"
          value="${esc2(slot.kopiaUser)}">`;
      div.appendChild(userWrap);

      const passWrap=document.createElement('div');passWrap.className='fr';
      passWrap.innerHTML=`<label for="kopia-pass-${si}">Password <span class="opt-span">(${(slot.kopiaPassSet||slot.kopiaPass)?'saved':'optional'})</span></label>
        <input class="fc" id="kopia-pass-${si}" type="password" autocomplete="new-password"
          placeholder="${(slot.kopiaPassSet||slot.kopiaPass)?'\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf  (saved — leave blank to keep)':'Enter if required'}">`;
      div.appendChild(passWrap);

      const hrefWrap=document.createElement('div');hrefWrap.className='fr';
      hrefWrap.innerHTML=`<label for="kopia-href-${si}">Click URL <span class="opt-span">(optional)</span></label>
        <input class="fc" id="kopia-href-${si}" type="text" placeholder="http://kopia:51515"
          value="${esc2(slot.kopiaHref)}">`;
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
        placeholder: saved ? `${saved} — fetch to change` : '— fetch jobs first —', disabled:true});
      return;
    }
    const items=[{value:'',label:'— none —'}].concat(slot.dupJobList.map(j=>({value:String(j.id),label:j.name})));
    _customDrop(container,{idBase:`dup-job-${si}`,label:'Job',items,value:slot.jobId||'',placeholder:'— none —',
      onChange:v=>{ slot.jobId=v||null; }});
  }

  function renderSrcDrop(si, container) {
    const slot=slots[si];
    if(!slot.kopiaSrcList.length){
      const saved = slot.jobId ? (slot.customName || slot.jobId) : '';
      _customDrop(container,{idBase:`kopia-src-${si}`,label:'Source',items:[],value:'',
        placeholder: saved ? `${saved} — fetch to change` : '— fetch sources first —', disabled:true});
      return;
    }
    const items=[{value:'',label:'— none —'}].concat(slot.kopiaSrcList.map(src=>({value:src.id,label:src.name})));
    _customDrop(container,{idBase:`kopia-src-${si}`,label:'Source',items,value:slot.jobId||'',placeholder:'— none —',
      onChange:v=>{ slot.jobId=v||null; }});
  }

  /* ── Render all slots ── */
  for (let si=0; si<slotCount; si++) {
    if (si > 0) { const d=document.createElement('div');d.className='div';body.appendChild(d); }
    body.appendChild(buildSlotSection(si));
  }
}

function _renderAdguardConfig(body){
  /* ── Connection ── */
  const hd=document.createElement('div');hd.className='stl';hd.textContent='Connection';body.appendChild(hd);

  const urlDiv=document.createElement('div');urlDiv.className='fr';
  urlDiv.innerHTML=`<label>AdGuard Home URL <span class="req">*</span></label>
    <input class="fc" id="ag-url" type="text" placeholder="adguard-home:8080"
      value="${esc(_wadguardCfg.url||'')}">
    <div class="hint">Container name and port, or a full URL.</div>`;
  body.appendChild(urlDiv);

  const hrefDiv=document.createElement('div');hrefDiv.className='fr';
  hrefDiv.innerHTML=`<label>Click URL <span class="opt-span">(optional)</span></label>
    <input class="fc" id="ag-href" type="text" placeholder="https://adguard.yourdomain.com"
      value="${esc(_wadguardCfg.href||'')}">
    <div class="hint">Where clicking the widget opens. Leave blank to disable clicking.</div>`;
  body.appendChild(hrefDiv);

  const div1=document.createElement('div');div1.className='div';body.appendChild(div1);

  /* ── Auth ── */
  const authHd=document.createElement('div');authHd.className='stl';authHd.textContent='Authentication';body.appendChild(authHd);

  const authHint=document.createElement('div');authHint.className='hint';authHint.style.marginBottom='12px';
  authHint.textContent='Leave blank if your AdGuard Home instance has no login configured.';
  body.appendChild(authHint);

  const userDiv=document.createElement('div');userDiv.className='fr';
  userDiv.innerHTML=`<label>Username <span class="opt-span">(optional)</span></label>
    <input class="fc" id="ag-user" type="text" autocomplete="off"
      placeholder="admin" value="${esc(_wadguardCfg.user||'')}">`;
  body.appendChild(userDiv);

  const passDiv=document.createElement('div');passDiv.className='fr';
  const passHint=_wadguardCfg.passSet
    ?'A password is saved. Enter a new one to replace it, or leave blank to keep it.'
    :'Leave blank if no password is required.';
  passDiv.innerHTML=`<label>Password <span class="opt-span">(optional)</span></label>
    <div style="position:relative">
      <input class="fc" id="ag-pass" type="password" autocomplete="new-password"
        placeholder="${_wadguardCfg.passSet?'••••••••  (saved — leave blank to keep)':'Enter password if required'}">
    </div>
    <div class="hint">${esc(passHint)}</div>`;
  body.appendChild(passDiv);
}

function _renderGithubConfig(body){
  const curView = _wgithubCfg.view || 'prs';

  /* ── Token ── */
  const tokHd=document.createElement('div');tokHd.className='stl';tokHd.textContent='GitHub Token';body.appendChild(tokHd);
  const tokDiv=document.createElement('div');tokDiv.className='fr';
  tokDiv.innerHTML=`<label>Personal Access Token <span class="opt-span">(${_wgithubCfg.tokenSet?'saved':'required'})</span></label>
    <input class="fc" id="gh-token" type="password" autocomplete="new-password"
      placeholder="${_wgithubCfg.tokenSet?'••••••••  (saved — leave blank to keep)':'ghp_xxxxxxxxxxxxxxxx'}">
    <div class="hint">Scopes needed: <code>read:user</code> + <code>repo</code>. Shared across all GitHub widgets.</div>`;
  body.appendChild(tokDiv);

  const div1=document.createElement('div');div1.className='div';body.appendChild(div1);

  /* ── 3. Account ── */
  const accHd=document.createElement('div');accHd.className='stl';accHd.textContent='Account';body.appendChild(accHd);
  const userDiv=document.createElement('div');userDiv.className='fr';
  userDiv.innerHTML=`<label>GitHub Username <span class="req">*</span></label>
    <input class="fc" id="gh-user" type="text" autocomplete="off"
      placeholder="your-github-username" value="${esc(_wgithubCfg.user||'')}">`;
  body.appendChild(userDiv);

  const hrefDiv=document.createElement('div');hrefDiv.className='fr';
  hrefDiv.innerHTML=`<label>Click URL <span class="opt-span">(optional)</span></label>
    <input class="fc" id="gh-href" type="text" placeholder="https://github.com"
      value="${esc(_wgithubCfg.href||'')}">
    <div class="hint">Where clicking the widget opens. Leave blank to disable.</div>`;
  body.appendChild(hrefDiv);

  /* ── 4. PR-specific section ── */
  if(curView==='prs'){
    const div2=document.createElement('div');div2.className='div';body.appendChild(div2);
    const prHd=document.createElement('div');prHd.className='stl';prHd.textContent='Pull Requests';body.appendChild(prHd);

    const activeFilters=_wgithubCfg.prFilters||[_wgithubCfg.prFilter||'created'];
    const filterWrap=document.createElement('div');filterWrap.className='fr';
    filterWrap.innerHTML='<label>Show pull requests</label>';
    /* Checkboxes — one per filter, all visible, no dropdown */
    const cbWrap=document.createElement('div');cbWrap.style.cssText='display:flex;flex-direction:column;gap:8px;margin-top:4px';
    [['created','Created by me'],['assigned','Assigned to me'],
     ['mentioned','Mentioning me'],['review-requested','Review requested']].forEach(([v,l])=>{
      const row=document.createElement('label');
      row.style.cssText='display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;color:var(--tx)';
      const cb=document.createElement('input');cb.type='checkbox';cb.value=v;cb.id=`gh-filter-${v}`;
      cb.style.cssText='width:16px;height:16px;cursor:pointer;accent-color:var(--ac)';
      cb.checked=activeFilters.includes(v);
      const lbl=document.createElement('span');lbl.textContent=l;
      row.append(cb,lbl);
      cbWrap.appendChild(row);
    });
    filterWrap.appendChild(cbWrap);
    body.appendChild(filterWrap);
  }
}

function buildFolderForm(body,item){
  const nonDockApps=items.filter(i=>i.type==='app'&&!i.dock);
  const children=item?.children||[];
  body.innerHTML=`
    <div class="fr"><label>Folder name <span class="req">*</span></label>
      <input class="fc" id="f-fname" placeholder="My Folder" value="${esc(item?.label||'')}"></div>
    <div class="fr fr-mb0">
      <label>Apps in this folder</label>
      <select class="fc" id="folder-app-select" multiple size="${Math.min(Math.max(nonDockApps.length,3),8)}" style="height:auto;padding:4px 0">
        ${nonDockApps.map(a=>`<option value="${esc(a.id)}" ${children.includes(a.id)?'selected':''}
          style="padding:7px 12px;cursor:pointer">${esc(a.label||a.id)}</option>`).join('')}
      </select>
      <div class="hint">Hold <kbd style="font-size:10px;padding:1px 4px;border:1px solid var(--bd);border-radius:3px">⌘</kbd> / <kbd style="font-size:10px;padding:1px 4px;border:1px solid var(--bd);border-radius:3px">Ctrl</kbd> to select multiple apps.</div>
    </div>`;
}

function buildAppForm(body,item){
  const docks=items.filter(i=>i.type==='app'&&i.dock&&i.id!==item?.id).length;
  const dockFull=docks>=4;
  const mon=item?.monitoring||{};
  const hc=mon.healthcheck||{enabled:!!(item?.container||item?.ping),container:item?.container||'',pingUrl:item?.ping||''};
  const act=mon.activity||{enabled:!!(item?.badge?.enabled),url:item?.badge?.url||'',interval:item?.badge?.interval||30};
  const skipTls=!!(item?.skipTlsVerify);

  const secBasic=document.createElement('div');secBasic.className='sec';
  secBasic.innerHTML=`<div class="stl">App</div>
    <div class="fr"><label>Name <span class="req">*</span></label>
      <input class="fc" id="f-lbl" placeholder="My App" value="${esc(item?.label||'')}"></div>
    <div class="fr"><label>URL <span class="req">*</span></label>
      <input class="fc" id="f-href" type="url" placeholder="https://app.example.com" value="${esc(item?.href||'')}"></div>
    <div class="div"></div>
    <div class="stl" style="margin-top:4px">Icon</div>
    <div class="fr">
      <div class="ipw" id="ipw">
        <div class="ipsw">
          <div class="ipv" id="ipv" style="background:${rc(scol)}">
            ${siurl?`<img src="${esc(resolveIcon(siurl))}" alt="" id="ipv-img">`
                   :`<span>${(item?.label||'?')[0]?.toUpperCase()||'?'}</span>`}
          </div>
          <input class="fc" id="ip-in" type="text" placeholder="Name (e.g. radarr) or full URL"
            autocomplete="off" value="${esc(siurl)}" class="icon-url-input">
          <label class="btn bg sm upload-label" id="ip-upload-lbl" title="Upload icon from your computer">
            ↑ Upload<input type="file" id="ip-upload" accept=".svg,.png,.ico,image/svg+xml,image/png,image/x-icon" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none">
          </label>
        </div>
        <div class="iprs" id="iprs"></div>
        <div class="hint">Type a name to search, paste a full URL, or upload your own .svg / .png.</div>
      </div>
    </div>
    <div class="div"></div>
    <div class="stl" style="margin-top:4px">Background color</div>
    <div class="fr">
      <div class="cols">
        <div class="co co-dark ${scol==='dark'?'on':''}" data-v="dark" title="Dark"></div>
        <div class="co co-light ${scol==='light'?'on':''}" data-v="light" title="Light"></div>
        <button type="button" class="co co-custom" id="co-custom" title="Custom colour" aria-label="Custom colour" aria-expanded="false"></button>
      </div>
      <div class="cols" style="margin-top:8px">
        ${['#FF3B30','#FFCC00','#34C759','#007AFF','#8E8E93']
          .map(h=>`<div class="co ${String(scol).toLowerCase()===h.toLowerCase()?'on':''}" data-v="${h}" style="background:${h}" title="${h}"></div>`).join('')}
      </div>
      <div class="co-picker d-none" id="co-picker">
        <div class="cpk-row"><span class="cpk-lbl">Hue</span><input type="range" id="cpk-h" min="0" max="360" value="220" class="cpk-slider cpk-hue" aria-label="Hue"></div>
        <div class="cpk-row"><span class="cpk-lbl">Sat</span><input type="range" id="cpk-s" min="0" max="100" value="60" class="cpk-slider" aria-label="Saturation"></div>
        <div class="cpk-row"><span class="cpk-lbl">Light</span><input type="range" id="cpk-l" min="0" max="100" value="50" class="cpk-slider" aria-label="Lightness"></div>
      </div>
      <input class="fc" id="co-hex" type="text" placeholder="#rrggbb or any CSS color"
        value="${scol!=='dark'&&scol!=='light'?esc(scol):''}">
    </div>
    <div class="div"></div>
    <div class="stl" style="margin-top:4px">Dock</div>
    <div class="trow trow-noborder">
      <div><div class="tlbl">Show in dock bar</div>
        <div class="tdsc">${dockFull&&!item?.dock?'Dock full (4/4) — remove an app first':'Max 4 apps'}</div></div>
      <label class="tog${dockFull&&!item?.dock?' tog-disabled':''}">
        <input type="checkbox" id="f-dock" ${item?.dock?'checked':''} ${dockFull&&!item?.dock?'disabled':''}>
        <div class="tr"></div></label>
    </div>`;
  body.appendChild(secBasic);

  const divider4=document.createElement('div');divider4.className='div';body.appendChild(divider4);

  /* ── Health & Activity section ── */
  const secMon=document.createElement('div');secMon.className='sec';
  const actCustom=item?.monitoring?.activity?.custom||{};
  const staticBadge=item?.monitoring?.staticBadge||{};
  const hasActCustom=!!(actCustom.color||actCustom.unit);
  const hasStatic=!!(staticBadge.enabled);
  /* Badge colors shared by admin pickers and dashboard rendering */
  const BADGE_COLORS={blue:'#1e6ef4',green:'#008932',yellow:'#ffcc00',red:'#e9152d',gray:'#636366'};
  /* Build named .co swatches + hex field — same pattern as icon background color UI */
  function colorPickerHtml(field,saved){
    const isHex=saved&&!BADGE_COLORS[saved];
    const swatches=Object.keys(BADGE_COLORS).map(name=>{
      const on=saved===name||(!saved&&name==='blue');
      return '<div class="co co-badge-'+name+(on?' on':'')+'" data-field="'+field+'" data-v="'+name+'" title="'+name[0].toUpperCase()+name.slice(1)+'"></div>';
    }).join('');
    return '<div class="cols cols-badge" data-field="'+field+'">'+swatches+'</div>'
      +'<input class="fc" id="'+field+'-hex" type="text" placeholder="#rrggbb or any CSS color" value="'+(isHex?esc(saved):'')+'">';
  }
  secMon.innerHTML=`<div class="stl">Health &amp; Activity</div>
    <div class="trow">
      <div><div class="tlbl">Health check</div>
        <div class="tdsc">Red badge when down</div></div>
      <label class="tog"><input type="checkbox" id="hc-en" ${hc.enabled?'checked':''}><div class="tr"></div></label>
    </div>
    <div class="sub ${hc.enabled?'open':''}" id="hc-sub">
      <div class="hc-type-row">
        <label class="hc-type-label">
          <input type="radio" name="hc-type" id="hc-type-con" ${!hc.pingUrl?'checked':''}> Container
        </label>
        <label class="hc-type-label">
          <input type="radio" name="hc-type" id="hc-type-ping" ${hc.pingUrl?'checked':''}> Ping URL
        </label>
      </div>
      <div id="hc-con-row" class="hc-con-row${hc.pingUrl?' hidden':''}">
        <input class="fc" id="hc-con" placeholder="container-name" value="${esc(hc.container||'')}">
      </div>
      <div id="hc-ping-row" class="hc-ping-row${hc.pingUrl?' active':''}">
        <div class="fr-inline">
          <input class="fc" id="hc-ping" type="url" placeholder="http://your-server-ip:port" value="${esc(hc.pingUrl||'')}">
          <button type="button" class="btn bg sm" id="hc-ping-test">Test →</button>
        </div>
        <div id="hc-ping-status" class="hint hc-ping-status"></div>
      </div>
    </div>
    <div class="trow" style="margin-top:2px">
      <div><div class="tlbl">Fixed label badge</div>
        <div class="tdsc">Always-on static text badge</div></div>
      <label class="tog"><input type="checkbox" id="static-en" ${hasStatic?'checked':''}><div class="tr"></div></label>
    </div>
    <div class="sub ${hasStatic?'open':''}" id="static-sub">
      <div class="fr">
        <label>Label text <span class="req">*</span></label>
        <input class="fc" id="f-static-label" type="text" maxlength="10" placeholder="e.g. Backup"
          value="${esc(staticBadge.label||'')}">
        <div class="hint">Max 8 characters. Shown as a permanent badge, independent of any API.</div>
      </div>
      <div class="fr fr-mb0">
        <label>Badge color</label>
        ${colorPickerHtml('static-col',staticBadge.color||'blue')}
      </div>
    </div>
    <div class="trow act-trow">
      <div><div class="tlbl">Activity badge</div>
        <div class="tdsc">Live number from an API</div></div>
      <label class="tog"><input type="checkbox" id="act-en" ${act.enabled?'checked':''}><div class="tr"></div></label>
    </div>
    <div class="sub ${act.enabled?'open':''}" id="act-sub">
      <div class="fr">
        <label>API URL <span class="req">*</span></label>
        <div class="fr-inline">
          <input class="fc" id="f-burl" type="url" placeholder="http://container-name:8181/api/v2"
            value="${esc(act.url||'')}">
          <button type="button" class="btn bg sm badge-fetch-btn" id="bfetch">Fetch</button>
        </div>
        <div class="hint badge-hint" id="bst">${spaths.length?'Saved: '+spaths.join(' + ')+' · Click Fetch to refresh':''}</div>
      </div>
      <div class="fr${spaths.length?'':' bprow-hidden'}" id="bprow">
        <label>Select value</label>
        <div class="badge-path-wrap">
          <svg class="badge-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/>
            <line x1="10.1" y1="10.1" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <input class="fc badge-path-input" id="bsearch" type="text" placeholder="Filter…" autocomplete="off">
        </div>
        <div class="blist" id="blist"></div>
      </div>
      <div class="${spaths.length?'':'bprow-hidden'}" id="auth-row-wrap">
        <div class="trow" style="padding-top:10px;border-top:1px solid var(--bd)">
          <div><div class="tlbl">Authentication</div>
            <div class="tdsc">API key or token required</div></div>
          <label class="tog"><input type="checkbox" id="auth-en" ${(act.params||act.headers)?'checked':''}><div class="tr"></div></label>
        </div>
        <div class="sub ${(act.params||act.headers)?'open':''}" id="auth-sub">
          <div class="fr">
            <label>Add to URL <span class="opt-span">(query params)</span></label>
            <textarea class="fc" id="f-bpar" rows="2"
              placeholder="apikey=abc123&#10;cmd=get_activity">${act.params?Object.entries(act.params).map(([k,v])=>`${k}=${v}`).join('\n'):''}</textarea>
            <div class="hint">One key=value per line. Added to the URL as <code>?key=value</code>.</div>
          </div>
          <div class="fr fr-mb0">
            <label>Add to header</label>
            <textarea class="fc" id="f-bhdr" rows="2"
              placeholder="X-Api-Key=your-key">${act.headers?Object.entries(act.headers).map(([k,v])=>`${k}=${v}`).join('\n'):''}</textarea>
            <div class="hint">One key=value per line. Sent as an HTTP request header.</div>
          </div>
        </div>
      </div>
      <div class="trow${spaths.length?'':' bprow-hidden'}" id="poll-row" style="padding-top:8px;border-top:1px solid var(--bd)">
        <div><div class="tlbl">Poll every</div></div>
        <div class="irow">
          <input class="fc" id="f-bint" type="number" min="10" max="3600" value="${act.interval||30}">
          <span>seconds</span>
        </div>
      </div>
      <div class="bmore-toggle${hasActCustom?' open':''}" id="bmore-toggle" style="margin-top:12px">
        <button type="button" class="btn bg sm bmore-btn" id="bmore-btn">
          ${hasActCustom?'▾ More options':'▸ More options'}
        </button>
      </div>
      <div class="sub${hasActCustom?' open':''}" id="bmore-sub" style="margin-top:8px">
        <div class="fr">
          <label>Badge color</label>
          ${colorPickerHtml('act-col',actCustom.color||'blue')}
        </div>
        <div class="fr fr-mb0">
          <label>Unit <span class="opt-span">(appended after number)</span></label>
          <input class="fc" id="bcust-unit" type="text" maxlength="8" placeholder="e.g. GB" value="${esc(actCustom.unit||'')}">
        </div>
      </div>
    </div>`;
  body.appendChild(secMon);


  /* Issue #4: TLS in its own section */
  const dividerTls=document.createElement('div');dividerTls.className='div';body.appendChild(dividerTls);
  const secTls=document.createElement('div');secTls.className='sec';
  secTls.innerHTML=`<div class="stl">Security</div>
    <div class="trow trow-noborder">
      <div><div class="tlbl">Allow self-signed certificate</div>
        <div class="tdsc">Skip TLS verification for this app's URLs</div></div>
      <label class="tog"><input type="checkbox" id="f-skip-tls" ${skipTls?'checked':''}><div class="tr"></div></label>
    </div>
    <div class="hint" style="margin-top:6px">Only enable this if the app uses a self-signed or internal certificate and you trust the connection. Skipping verification means the connection cannot be validated — do not enable this for apps exposed to untrusted networks.</div>`;
  body.appendChild(secTls);

  /* Wire events */
  wireIcon();wireColor();
  /* Trigger full fallback-aware preview immediately after form is in DOM */
  if(siurl)updPrev();
  /* Apply global health-check enabled state to this modal */
  const _globalHealthOn=!!(document.getElementById('srv-docker-en')?.checked);
  const hcEnEl=document.getElementById('hc-en');
  if(hcEnEl){
    hcEnEl.disabled=!_globalHealthOn;
    const hcTrow=hcEnEl.closest('.trow');
    if(hcTrow){
      hcTrow.style.opacity=_globalHealthOn?'':'0.45';
      if(!_globalHealthOn){
        const hcDesc=hcTrow.querySelector('.tdsc');
        if(hcDesc&&!hcDesc.dataset.origText){hcDesc.dataset.origText=hcDesc.textContent;hcDesc.textContent='Enable Docker health checks in Server settings';}
      }
    }
    /* Issue #2: also dim+block the sub-panel (container name / ping URL fields) */
    const hcSub=document.getElementById('hc-sub');
    if(hcSub&&!_globalHealthOn){
      hcSub.style.opacity='0.45';
      hcSub.style.pointerEvents='none';
    }
  }
  document.getElementById('hc-en').onchange=e=>{
    if(!_globalHealthOn)return;
    document.getElementById('hc-sub').classList.toggle('open',e.target.checked);
  };
  document.querySelectorAll('input[name="hc-type"]').forEach(r=>r.onchange=()=>{
    const p=document.getElementById('hc-type-ping')?.checked;
    document.getElementById('hc-con-row').classList.toggle('hidden', p);
    document.getElementById('hc-ping-row').classList.toggle('active', p);
  });
  document.getElementById('hc-ping-test').onclick=testPing;
  document.getElementById('act-en').onchange=e=>document.getElementById('act-sub').classList.toggle('open',e.target.checked);
  document.getElementById('bfetch').onclick=fetchBadge;
  document.getElementById('auth-en').onchange=e=>document.getElementById('auth-sub').classList.toggle('open',e.target.checked);
  document.getElementById('act-sub').addEventListener('input', e=>{
    if(e.target.id==='bsearch') renderBadgeList(fnums, false, e.target.value);
  });
  /* Issue #8: on load show saved paths in blist only, no duplicate in #bst */
  if(spaths.length){
    ['bprow','auth-row-wrap','poll-row'].forEach(id=>document.getElementById(id)?.classList.remove('bprow-hidden'));
    renderBadgeList([],true); /* show saved path chips without the repeated hint text */
  }
  /* Static badge toggle */
  document.getElementById('static-en')?.addEventListener('change',e=>{
    document.getElementById('static-sub')?.classList.toggle('open',e.target.checked);
  });
  /* More options toggle */
  document.getElementById('bmore-btn')?.addEventListener('click',()=>{
    const sub=document.getElementById('bmore-sub');
    const btn=document.getElementById('bmore-btn');
    const open=sub?.classList.toggle('open');
    if(btn)btn.textContent=open?'▾ More options':'▸ More options';
  });
  /* Badge color pickers — same .co + hex-field wiring as icon background color */
  function wireBadgeColorPicker(field){
    const hexEl=document.getElementById(field+'-hex');
    document.querySelectorAll('.co[data-field="'+field+'"]').forEach(sw=>{
      sw.addEventListener('click',()=>{
        document.querySelectorAll('.co[data-field="'+field+'"]').forEach(s=>s.classList.remove('on'));
        sw.classList.add('on');
        if(hexEl)hexEl.value='';
      });
    });
    if(hexEl)hexEl.addEventListener('input',()=>{
      document.querySelectorAll('.co[data-field="'+field+'"]').forEach(s=>s.classList.remove('on'));
    });
  }
  wireBadgeColorPicker('act-col');
  wireBadgeColorPicker('static-col');
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
  if(upInput){
    upInput.onchange=async()=>{
      const file=upInput.files[0];if(!file)return;
      const lbl=document.getElementById('ip-upload-lbl');
      const origText=lbl?lbl.childNodes[0]?.textContent:'';
      if(lbl)lbl.childNodes[0].textContent='↑ Uploading…';
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
      finally{if(lbl&&lbl.childNodes[0])lbl.childNodes[0].textContent=origText;upInput.value='';}
    };
  }

  document.addEventListener('click',e=>{if(!document.getElementById('ipw')?.contains(e.target))rs?.classList.remove('open');});
}
function showIPRes(list, rawInput){
  const rs=document.getElementById('iprs');if(!rs)return;rs.innerHTML='';
  /* Show CDN matches */
  list.forEach(ic=>{
    const r=document.createElement('div');r.className='ipr';
    const img=document.createElement('img');img.src=ic.svgUrl;img.onerror=()=>{img.src=ic.pngUrl;};
    const sp=document.createElement('span');sp.textContent=ic.name;r.append(img,sp);
    r.onclick=()=>{siurl=ic.svgUrl;document.getElementById('ip-in').value=ic.svgUrl;updPrev();rs.classList.remove('open');};
    rs.appendChild(r);
  });
  /* If no CDN matches but input looks like a filename, offer to use it as local/CDN icon */
  if(!list.length&&rawInput&&!rawInput.includes('/')){
    const val=rawInput.trim();
    const srcs=iconChain(val);
    if(!srcs.length){rs.classList.remove('open');return;}
    const r=document.createElement('div');r.className='ipr';
    const img=document.createElement('img');
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
      if(!fnums.length) st.textContent='✓ Connected — no numeric values found';
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
        st.textContent="Can't reach this address from Docker. Try using the container name — e.g. http://container-name:8181/api/v2";
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
  const folders=items.filter(i=>i.type==='folder');
  /* Find current folder */
  const currentFolder=folders.find(f=>(f.children||[]).includes(appId));
  const appItem=items.find(i=>i.id===appId);
  const appName=appItem?.label||appId;

  /* Build a small modal-like popover */
  const existing=document.getElementById('folder-picker-ov');
  if(existing)existing.remove();

  const ov=document.createElement('div');ov.id='folder-picker-ov';
  ov.style.cssText='position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.55);'+
    'backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px;';

  const box=document.createElement('div');
  box.style.cssText='background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);'+
    'width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;';

  const hdr=document.createElement('div');
  hdr.style.cssText='padding:16px 20px;border-bottom:1px solid var(--bd);font-weight:600;font-size:15px;';
  hdr.textContent=appId?`Move "${appName}" to folder`:`Add app to folder`;

  const list=document.createElement('div');list.style.cssText='padding:8px;';

  /* "No folder" option */
  const none=document.createElement('div');
  none.style.cssText='padding:10px 12px;border-radius:var(--rs);cursor:pointer;font-size:14px;'+
    'color:var(--dm);display:flex;align-items:center;justify-content:space-between;'+
    'transition:background var(--t);';
  none.textContent='No folder';
  if(!currentFolder){none.style.fontWeight='600';none.style.color='var(--tx)';}
  none.onmouseover=()=>none.style.background='var(--sf2)';
  none.onmouseout=()=>none.style.background='';
  none.onclick=()=>{
    /* Remove from all folders */
    items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==appId);});
    save();ov.remove();
  };
  list.appendChild(none);

  /* Existing folders */
  folders.forEach(f=>{
    const row=document.createElement('div');
    row.style.cssText='padding:10px 12px;border-radius:var(--rs);cursor:pointer;font-size:14px;'+
      'display:flex;align-items:center;justify-content:space-between;transition:background var(--t);';
    row.onmouseover=()=>row.style.background='var(--sf2)';
    row.onmouseout=()=>row.style.background='';
    const nm=document.createElement('span');nm.textContent='📁 '+f.label;
    const check=document.createElement('span');
    check.style.cssText='color:var(--ac);font-size:14px;';
    if(currentFolder?.id===f.id)check.textContent='✓';
    row.append(nm,check);
    row.onclick=()=>{
      /* Remove from all folders first */
      items.forEach(ff=>{if(ff.type==='folder')ff.children=(ff.children||[]).filter(id=>id!==appId);});
      /* Add to selected folder */
      if(!f.children)f.children=[];
      if(!f.children.includes(appId))f.children.push(appId);
      save();ov.remove();
    };
    list.appendChild(row);
  });

  /* Create new folder */
  const divider=document.createElement('div');divider.className='div';divider.style.margin='4px 8px';
  list.appendChild(divider);
  const newRow=document.createElement('div');
  newRow.style.cssText='padding:10px 12px;border-radius:var(--rs);cursor:pointer;font-size:14px;'+
    'color:var(--ac);transition:background var(--t);';
  newRow.textContent='+ Create new folder';
  newRow.onmouseover=()=>newRow.style.background='var(--sf2)';
  newRow.onmouseout=()=>newRow.style.background='';
  newRow.onclick=()=>{
    const name=prompt('Folder name:');
    if(!name?.trim())return;
    const folderId='folder_'+Date.now();
    items.push({id:folderId,type:'folder',label:name.trim(),children:[appId]});
    /* Remove from any existing folder */
    items.forEach(f=>{if(f.type==='folder'&&f.id!==folderId)f.children=(f.children||[]).filter(id=>id!==appId);});
    save();ov.remove();
  };
  list.appendChild(newRow);

  const footer=document.createElement('div');
  footer.style.cssText='padding:12px 20px;border-top:1px solid var(--bd);display:flex;justify-content:flex-end;';
  const cancel=document.createElement('button');cancel.className='btn bg sm';cancel.textContent='Cancel';
  cancel.onclick=()=>ov.remove();
  footer.appendChild(cancel);

  /* If called with a target folder, auto-highlight it */
  if(targetFolderId){
    const tf=folders.find(f=>f.id===targetFolderId);
    if(tf){
      /* Show app picker instead: list all non-folder, non-dock apps not already in this folder */
      list.innerHTML='';
      const available=items.filter(i=>i.type==='app'&&!i.dock&&!(tf.children||[]).includes(i.id));
      if(!available.length){
        const em=document.createElement('div');em.style.cssText='padding:14px;color:var(--dm);font-size:13px;';
        em.textContent='All apps are already in this folder.';list.appendChild(em);
      }
      available.forEach(app=>{
        const row=document.createElement('div');
        row.style.cssText='padding:10px 12px;border-radius:var(--rs);cursor:pointer;font-size:14px;'+
          'display:flex;align-items:center;gap:10px;transition:background var(--t);';
        row.onmouseover=()=>row.style.background='var(--sf2)';
        row.onmouseout=()=>row.style.background='';
        const ri=document.createElement('div');ri.style.cssText='width:32px;height:32px;border-radius:8px;'+
          'background:'+rc(app.color)+';display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        if(app.iconUrl){const img=document.createElement('img');img.src=resolveIcon(app.iconUrl);
          img.style.cssText='width:20px;height:20px;object-fit:contain;';ri.appendChild(img);}
        else ri.textContent=(app.label||'?')[0];
        const nm2=document.createElement('span');nm2.textContent=app.label||app.id;
        row.append(ri,nm2);
        row.onclick=()=>{
          items.forEach(f=>{if(f.type==='folder')f.children=(f.children||[]).filter(id=>id!==app.id);});
          if(!tf.children)tf.children=[];tf.children.push(app.id);
          save();ov.remove();
        };
        list.appendChild(row);
      });
    }
  }
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  box.append(hdr,list,footer);ov.appendChild(box);document.body.appendChild(ov);
}

async function doSave(orig){
  try{
    let item;
    if(ctype==='widget'){
      /* Generate clean IDs: only letters, digits and underscores */
      const cleanId=s=>s.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'')||'widget';
      const wlabel=_wlabel.trim()||(_wtype==='stats'?(_wstatsSubType==='disk-health'?'Disk Health':'System Summary'):_wtype==='connections'?'Connections':_wtype==='adguard'?'AdGuard':_wtype==='github'?'GitHub':_wtype==='clock'?'Clock':_wtype==='duplicati'?'Backup':'Widget');
      if(_wtype==='clock'){
        const tz=document.getElementById('clk-tz-en')?.checked?(document.getElementById('clk-tz-val')?.value||''):'';
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'clock',
          label:wlabel,widgetSize:'small',widgetConfig:{
            clockStyle:_wclockCfg.style||'digital',
            clockMode:_wclockCfg.mode||'dark',
            clockTimezone:tz,
            clockShowDate:_wclockCfg.showDate!==false,
          }};
      }else if(_wtype==='custom'){
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
      }else if(_wtype==='adguard'){
        const agUrl=document.getElementById('ag-url')?.value?.trim();
        if(!agUrl){toast('AdGuard URL is required','err');return;}
        const agUser=document.getElementById('ag-user')?.value?.trim()||'';
        const agPass=document.getElementById('ag-pass')?.value?.trim()||'';
        const agHref=document.getElementById('ag-href')?.value?.trim()||'';
        const wc={adguardUrl:agUrl};
        if(agUser) wc.adguardUser=agUser;
        else if(_wadguardCfg.user) wc.adguardUser=_wadguardCfg.user;
        /* Only include adguardPass if the user typed a new one.
           If blank, the server preserves the existing password automatically
           (POST /api/config merges missing adguardPass from existing config). */
        if(agPass) wc.adguardPass=agPass;
        if(agHref) wc.adguardHref=agHref;
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'adguard',
          label:wlabel,widgetSize:_wsize,widgetConfig:wc};
      }else if(_wtype==='duplicati'){
        /* Flush current DOM values into slot state before saving */
        _wduplicatiCfg.slots.forEach((slot,si) => {
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
            const fi=_wduplicatiCfg.slots.findIndex(s=>s.provider===prov);
            if(fi<0) return;
            const def=_wduplicatiCfg.slots[fi];
            if(def.useDefault===false) return;   /* default instance opted out → no sharing */
            _wduplicatiCfg.slots.forEach((t,j)=>{
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
        for(const [si,slot] of _wduplicatiCfg.slots.entries()){
          if(slot.provider==='duplicati'&&!slot.dupUrl){toast(`URL required for ${['First','Second','Third'][si]||''} Duplicati instance`,'err');return;}
          if(slot.provider==='kopia'&&!slot.kopiaUrl){toast(`URL required for ${['First','Second','Third'][si]||''} Kopia instance`,'err');return;}
        }
        /* Strip runtime-only fields before saving */
        const savableSlots = _wduplicatiCfg.slots.map(s=>({
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
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'duplicati',
          label:wlabel,widgetSize:_wsize,widgetConfig:{slots:savableSlots}};

      }else if(_wtype==='github'){
        const ghUser=document.getElementById('gh-user')?.value?.trim()||'';
        if(!ghUser){toast('GitHub username is required','err');return;}
        const ghToken=document.getElementById('gh-token')?.value?.trim()||'';
        const ghHref=document.getElementById('gh-href')?.value?.trim()||'';
        const ghView=_wgithubCfg.view||'prs';
        const wc={githubUser:ghUser,githubView:ghView};
        if(ghHref) wc.githubHref=ghHref;
        if(ghView==='prs'){
          /* Read from checkboxes */
          const filters=['created','assigned','mentioned','review-requested']
            .filter(v=>document.getElementById(`gh-filter-${v}`)?.checked);
          wc.githubPrFilters=filters.length?filters:['created'];
        }
        if(ghToken){
          fetch('/api/github-token',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({token:ghToken})}).catch(()=>{});
        }
        item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',
          widgetType:'github',label:wlabel,widgetSize:_wsize,widgetConfig:wc};
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
          /* Read final URL/href from DOM in case user didn't click Load */
          _wdiskCfg.scrutinyUrl  = document.getElementById('dh-url')?.value?.trim()  || _wdiskCfg.scrutinyUrl;
          _wdiskCfg.scrutinyHref = document.getElementById('dh-href')?.value?.trim() || _wdiskCfg.scrutinyHref;
          if (!_wdiskCfg.scrutinyUrl) { toast('Scrutiny URL is required','err'); return; }
          item={id:orig?.id||cleanId(wlabel)+'_'+Date.now(),type:'widget',widgetType:'stats',
            label:wlabel,widgetSize:_wsize,widgetConfig:{
              widgetSubType:'disk-health',
              scrutinyUrl:  _wdiskCfg.scrutinyUrl,
              scrutinyHref: _wdiskCfg.scrutinyHref||undefined,
              bays:         _wdiskCfg.bays,
            }};
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
      const children=[...document.querySelectorAll('#folder-app-select option:checked')].map(o=>o.value);
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
      /* Activity badge custom display */
      const actHexInput=document.getElementById('act-col-hex')?.value?.trim()||'';
      const actSwatchOn=document.querySelector('.co[data-field="act-col"].on');
      const actNamedCol=actSwatchOn?.dataset.v||'blue';
      /* Hex field takes priority over named swatch */
      const actColor=actHexInput||actNamedCol;
      const custUnit=document.getElementById('bcust-unit')?.value?.trim()||'';
      /* Always write customObj when color is non-default or unit is set; use undefined to omit from JSON */
      const customObj=(actColor&&actColor!=='blue')||custUnit?{
        color:actColor&&actColor!=='blue'?actColor:undefined,
        unit:custUnit||undefined,
      }:undefined;
      /* Static (fixed label) badge */
      const staticEn=document.getElementById('static-en')?.checked||false;
      const staticLabel=document.getElementById('f-static-label')?.value?.trim()||'';
      const staticHexInput=document.getElementById('static-col-hex')?.value?.trim()||'';
      const staticSwatchOn=document.querySelector('.co[data-field="static-col"].on');
      const staticNamedCol=staticSwatchOn?.dataset.v||'blue';
      const staticColor=staticHexInput||staticNamedCol;
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
  if(typeEl){typeEl.value=bg.type||'unsplash';showBgFields(bg.type||'unsplash');
    typeEl.addEventListener('change',()=>showBgFields(typeEl.value));}
  /* Unsplash API key — fetch whether one is configured via dedicated endpoint
     (the key itself is never included in /api/config to avoid exposure) */
  const apiEl=document.getElementById('bg-apikey');
  if(apiEl){
    apiEl.placeholder='●●●●●●●●●● (configured)';
    ag('/api/settings/unsplash-key').then(d=>{
      if(!d.configured)apiEl.placeholder='Paste your Unsplash API key';
    }).catch(()=>{});
  }
  const colEl=document.getElementById('bg-col');if(colEl)colEl.value=bg.collection||'';
  const urlEl=document.getElementById('bg-url');if(urlEl)urlEl.value=bg.url||'';
  const colorEl=document.getElementById('bg-color');if(colorEl)colorEl.value=bg.color||'';
  const brEl=document.getElementById('bg-br');
  const brVal=document.getElementById('bg-br-val');
  if(brEl){brEl.value=bg.brightness??0.62;if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);
    brEl.addEventListener('input',()=>{if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);});}
  document.getElementById('bg-save').addEventListener('click',saveWallpaper);
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
    if(dockerSubEl)dockerSubEl.classList.toggle('open',dockerEnEl.checked);
    if(hideHealthyRowEl)hideHealthyRowEl.style.display=dockerEnEl.checked?'':'none';
    dockerEnEl.addEventListener('change',()=>{
      if(dockerSubEl)dockerSubEl.classList.toggle('open',dockerEnEl.checked);
      if(hideHealthyRowEl)hideHealthyRowEl.style.display=dockerEnEl.checked?'':'none';
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
      if(d.enabled&&secSubEl)openSecSub();
    }
    const secPw=document.getElementById('sec-pw');
    if(secPw)secPw.placeholder=d.passwordSet?'●●●●●●●●●● (configured)':'New password (min 8 characters)';
    const secLogout=document.getElementById('sec-logout');
    if(secLogout&&d.enabled)secLogout.style.display='';
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
      bg.collection=document.getElementById('bg-col')?.value?.trim()||'';
    }
    else if(type==='url'){bg.url=document.getElementById('bg-url')?.value?.trim()||'';}
    else if(type==='color'){bg.color=document.getElementById('bg-color')?.value?.trim()||'';}
    /* Save main config first */
    const c=await ag('/api/config');c.settings=c.settings||{};c.settings.background=bg;
    await ap('/api/config',c);
    /* Save Unsplash key separately AFTER main config — the GET /api/config strips the key,
       so saving it before would cause the subsequent config write to overwrite it with nothing */
    if(type==='unsplash'){
      const keyVal=document.getElementById('bg-apikey')?.value?.trim()||'';
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
    const secLogout=document.getElementById('sec-logout');
    if(secLogout)secLogout.style.display=enabled?'':'none';

    toast('Saved');
  }catch(e){toast('Save failed: '+e.message,'err');}
}

document.getElementById('btn-add').onclick=()=>openModal(null);
initCards();
checkAuth().then(ok => {
  if (!ok) return;
  load().catch(e=>{
    toast('Could not load config — is the API container running? ('+e.message+')','err');
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
