/* Admin UI — app and folder forms.
   Builds the app edit form (icon picker, badge picker) and the folder form.
   Reads and writes shared state; exports buildAppForm, buildFolderForm, and
   parseKV (used by the save path). */
import { clr as rc, esc } from '/js/utils.js?v=40';
import { resolveIcon, iconChain } from '/js/icons.js?v=36';
import { state } from '/js/admin-state.js?v=1';
import { toast, ag, ap, PE_SVG, CHEV_SVG, initInlineEdit } from '/js/admin-shared.js?v=2';
import { renderColorControl } from '/js/admin-color-control.js?v=1';

/* Folder form — settings-row system (PSD: add_new_folder).
   Folder Name = inline-edit row; Add Apps = tap-to-toggle checklist dropdown. */
export function buildFolderForm(body,item){
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


export function buildAppForm(body,item){
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

export const parseKV=t=>{const r={};for(const l of t.split('\n')){const i=l.indexOf('=');if(i<1)continue;r[l.slice(0,i).trim()]=l.slice(i+1).trim();}return r;};
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
