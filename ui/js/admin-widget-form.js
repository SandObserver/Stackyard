/* Admin UI: widget configuration form.
   Builds the widget edit form and its per-type config sections. Reads and
   writes shared widget state on the state object; exports buildWidgetForm,
   called by the edit shell. */
import { state } from '/js/admin-state.js?v=1';
import { toast, PE_SVG, CHEV_SVG, _secretRow, initInlineEdit } from '/js/admin-shared.js?v=2';
import { renderColorControl } from '/js/admin-color-control.js?v=1';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=5';
import { esc } from '/js/utils.js?v=40';
import { normBackupSlots } from '/js/admin-logic.js?v=1';

/* Widget size glyphs (content-cards of increasing aspect/line-count), traced from the PSD. */
const SIZE_ICONS={
  small:'<rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="9.7" r="1" fill="currentColor"/><line x1="9" y1="13.4" x2="13" y2="13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  medium:'<rect x="4" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor"/><line x1="10.2" y1="11.4" x2="16.5" y2="11.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="7" y1="14.3" x2="16.5" y2="14.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  large:'<rect x="6" y="5.5" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><line x1="8" y1="12.6" x2="16" y2="12.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="14.8" x2="16" y2="14.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  xlarge:'<rect x="7" y="3.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="7" r="1.1" fill="currentColor"/><line x1="9" y1="10.5" x2="15" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="12.7" x2="15" y2="12.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="14.9" x2="15" y2="14.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="17.1" x2="13" y2="17.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

/* Allowed sizes come from the widget registry (folder-driven). 'custom' is the only built-in type. */
const CUSTOM_SIZES = ['small','medium','large','xlarge'];
function widgetSizes(type){ return type==='custom' ? CUSTOM_SIZES : (state._widgetReg[type]?.sizes || ['medium']); }
const SIZE_LABELS = { small:'Small', medium:'Medium', large:'Large', xlarge:'Extra Large' };
const STAT_TYPES  = ['cpu','ram','temp','disk','iowait','procs'];

/* State for current widget config while modal is open */
/* Auto-generated config form (folder-style widgets driven by the registry). */

export function buildWidgetForm(body,item){
  const wt0 = item?.widgetType || 'custom';
  const wt = (wt0==='map') ? 'connections' : wt0;  /* legacy map widgets migrate to connections */
  const ws = item?.widgetSize || 'medium';
  const wc = item?.widgetConfig || {};
  state._wtype = wt; state._wsize = ws;
  state._wlabel = item?.label || '';
  /* Snapshot of stored config for the auto-generated editor (registry widgets). */
  state._wAutoCfg = Object.assign({}, wc);
  /* Restore slots */
  state._wslots = (wc.slots || [{type:'cpu'},{type:'ram'},{type:'disk',primary:'/',secondary:''}]);
  while(state._wslots.length < 3) state._wslots.push({type:'cpu'});
  state._wstatsSubType = wc.widgetSubType || 'system-summary';
  state._wweatherCfg = {
    city:  wc.city  || '',
    lat:   wc.lat   != null ? wc.lat : '',
    lon:   wc.lon   != null ? wc.lon : '',
    units: wc.units === 'f' ? 'f' : 'c',
    feelsLike: wc.feelsLike === true,
    href:  wc.href  || '',
  };
  if (state._wstatsSubType === 'disk-health') {
    state._wdiskCfg = {
      diskProvider: wc.diskProvider || 'scrutiny',
      scrutinyUrl:  wc.scrutinyUrl  || '',
      scrutinyHref: wc.scrutinyHref || '',
      truenasUrl:   wc.truenasUrl   || '',
      truenasKeySet: !!wc.truenasKeySet,
      truenasHref:  wc.truenasHref  || '',
      bays:         Array.isArray(wc.bays) ? [...wc.bays] : [],
    };
  }
  state._wnet = wc.network ? {
    enabled:  wc.network.enabled  || false,
    mode:     wc.network.mode     || 'speed',
    url:      wc.network.url      || '',
    provider: wc.network.provider || 'myspeed',
    myspeedPassSet: wc.network.myspeedPassSet || false,
  } : {enabled:false,mode:'speed',url:'',provider:'myspeed'};
  state._wmapCfg = {
    showLegend: wc.showLegend !== false,
    services: Array.isArray(wc.services) ? wc.services.map(s=>Object.assign({id:_newSvcId(),type:'gluetun',name:'',url:'',adminUrl:'',color:'',token:'',enabled:true}, s)) : (function(){
      const a=[];
      if(wc.conduit && (wc.conduit.url||wc.conduit.enabled)) a.push({id:_newSvcId(),type:'conduit',name:wc.conduit.name||'Conduit',url:wc.conduit.url||'',adminUrl:wc.conduit.adminUrl||'',color:wc.conduit.color||'#AF52DE',token:'',enabled:wc.conduit.enabled!==false});
      if(wc.gluetun && (wc.gluetun.url||wc.gluetun.enabled)) a.push({id:_newSvcId(),type:'gluetun',name:wc.gluetun.name||'Gluetun',url:wc.gluetun.url||'',adminUrl:wc.gluetun.adminUrl||'',color:wc.gluetun.color||'#30D158',token:'',enabled:wc.gluetun.enabled!==false});
      return a;
    })(),
  };
  /* Connections widget: which view, and the VPN-view config (single tunnel). */
  state._wconnView = wc.view || 'map';
  state._wvpnCfg = {
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
  state._wbackupCfg = {
    /* Per-slot useDefault: first instance of a provider is its default; later
       instances use that default unless turned off (then they get their own container). */
    slots: normBackupSlots(wc.slots, state._wsize),
  };
  _renderWidgetForm(body);
}

function _renderWidgetForm(body){
  /* Re-render of the same registry widget (e.g. size change): keep typed values. */
  if(state._autoForm && state._autoFormType===state._wtype){ state._wAutoCfg=Object.assign({}, state._wAutoCfg, state._autoForm.getValues()); }
  state._autoForm=null;
  body.innerHTML='';

  /* ── Shell: Name + Widget Type, then Size tiles (settings-row, PSD) ── */
  const typeList=[...Object.values(state._widgetReg).map(w=>[w.name,w.label]), ['custom','Custom']].sort((a,b)=>a[1].localeCompare(b[1]));
  const typeOpts=typeList.map(([t,label])=>`<option value="${t}"${t===state._wtype?' selected':''}>${esc(label)}</option>`).join('');
  const shell=document.createElement('div'); shell.className='grp';
  shell.innerHTML=`
    <div class="row ie-row" id="ie-wname"><span class="rl">Name</span><span class="rv${state._wlabel?'':' is-ph'}">${state._wlabel?esc(state._wlabel):'My Widget'}</span><input id="f-wlabel" type="text" value="${esc(state._wlabel)}" style="display:none"><button class="pe" type="button" aria-label="Edit name">${PE_SVG}</button></div>
    <div class="row"><span class="rl">Widget Type</span><div class="sel-wrap"><select id="f-wtype" class="row-sel" aria-label="Widget type">${typeOpts}</select>${CHEV_SVG}</div></div>`;
  body.appendChild(shell);
  initInlineEdit('ie-wname','f-wlabel',{placeholder:'My Widget',onCommit(v){state._wlabel=v;}});
  const typeSel=shell.querySelector('#f-wtype');
  typeSel.onchange=()=>{ state._wtype=typeSel.value; state._wsize=widgetSizes(state._wtype)[0]; _renderWidgetForm(body); };

  /* Connections view (Map / VPN) as a radio group */
  if(state._wtype==='connections'){
    const vcard=document.createElement('div'); vcard.className='grp';
    vcard.innerHTML=`<div class="row"><span class="rl">View</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="wconn-view" value="map" ${state._wconnView==='map'?'checked':''}><span class="segr-dot"></span><span>Map</span></label>
      <label class="segr-opt"><input type="radio" name="wconn-view" value="vpn" ${state._wconnView==='vpn'?'checked':''}><span class="segr-dot"></span><span>VPN</span></label>
    </div></div>`;
    body.appendChild(vcard);
    vcard.querySelectorAll('input[name="wconn-view"]').forEach(r=>r.addEventListener('change',()=>{ state._wconnView=r.value; if(r.value==='map')state._wsize='medium'; _renderWidgetForm(body); }));
  }

  /* Size tiles */
  const _ghContrib=(state._wtype==='github'&&(state._wAutoCfg.githubView||'prs')==='contributions');
  let _sizeOpts=widgetSizes(state._wtype).filter(s=>!(_ghContrib&&(s==='large'||s==='xlarge')));
  if(state._wtype==='connections') _sizeOpts = (state._wconnView==='map') ? ['medium'] : ['small','medium'];
  if(!_sizeOpts.includes(state._wsize)) state._wsize=_sizeOpts.includes('medium')?'medium':_sizeOpts[0];
  const sizeHdr=document.createElement('p'); sizeHdr.className='grp-hdr'; sizeHdr.textContent='Size'; body.appendChild(sizeHdr);
  const scard=document.createElement('div'); scard.className='grp';
  scard.innerHTML=`<div class="row tile-row"><div class="tile-grp tile-grp-left">${_sizeOpts.map(s=>`<button type="button" class="tile-opt${s===state._wsize?' on':''}" data-size="${s}"><span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${SIZE_ICONS[s]||SIZE_ICONS.medium}</svg></span><span class="tile-cap">${SIZE_LABELS[s]}</span></button>`).join('')}</div></div>`;
  body.appendChild(scard);
  scard.querySelectorAll('.tile-opt').forEach(b=>b.addEventListener('click',()=>{ state._wsize=b.dataset.size; if(state._wtype==='backup'){state._wbackupCfg.slots=normBackupSlots(state._wbackupCfg.slots,state._wsize);} _renderWidgetForm(body); }));

    const cfgDiv=document.createElement('div');cfgDiv.className='div';body.appendChild(cfgDiv);
  if(state._widgetReg[state._wtype] && !state._widgetReg[state._wtype].customEditor){
    const d=document.createElement('div'); body.appendChild(d);
    const _wid=(state.eid!==null&&state.items[state.eid]&&state.items[state.eid].id)?state.items[state.eid].id:null;
    state._autoForm=renderWidgetConfigForm(d, state._widgetReg[state._wtype].fields||[], state._wAutoCfg, { widgetId:_wid, widgetType:state._wtype, size:state._wsize });
    state._autoFormType=state._wtype;
  }
  else if(state._wtype==='stats')        _renderStatsConfig(body);
  else if(state._wtype==='connections') _renderConnectionsConfig(body);
  else if(state._wtype==='backup'){ const d=document.createElement('div');d.id='bak-cfg-body';body.appendChild(d);_renderBackupConfig(d); }
  else if(state._wtype==='weather')     _renderWeatherConfig(body);
  else                        _renderCustomConfig(body);
}

function _renderWeatherConfig(body){
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  card.innerHTML=`
    <div class="row"><span class="rl">City</span><input id="wx-city" class="icon-srch" type="text" placeholder="e.g. Ottawa" value="${esc(state._wweatherCfg.city||'')}"></div>
    <div class="row" id="wx-match-row" hidden><span class="rl">Match</span><div class="sel-wrap"><select class="row-sel" id="wx-result" aria-label="Match"></select>${CHEV_SVG}</div></div>
    <div class="row"><span class="rl"></span><span class="row-status" id="wx-msg"></span><button type="button" class="row-btn" id="wx-search">Search</button></div>
    <div class="row"><span class="rl">Units</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="wx-units" value="c" ${(state._wweatherCfg.units||'c')==='c'?'checked':''}><span class="segr-dot"></span><span>&deg;C</span></label>
      <label class="segr-opt"><input type="radio" name="wx-units" value="f" ${state._wweatherCfg.units==='f'?'checked':''}><span class="segr-dot"></span><span>&deg;F</span></label>
    </div></div>
    <div class="row"><span class="rl">Temperature</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="wx-feels" value="actual" ${!state._wweatherCfg.feelsLike?'checked':''}><span class="segr-dot"></span><span>Actual</span></label>
      <label class="segr-opt"><input type="radio" name="wx-feels" value="feels" ${state._wweatherCfg.feelsLike?'checked':''}><span class="segr-dot"></span><span>Feels like</span></label>
    </div></div>
    <div class="row ie-row" id="wx-href-row"><span class="rl">Link URL <span class="opt-span">(optional)</span></span><span class="rv${state._wweatherCfg.href?'':' is-ph'}">${state._wweatherCfg.href?esc(state._wweatherCfg.href):'https://...'}</span><input id="wx-href" type="text" value="${esc(state._wweatherCfg.href||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit link URL">${PE_SVG}</button></div>`;
  const msg=card.querySelector('#wx-msg'), matchRow=card.querySelector('#wx-match-row'), resultSel=card.querySelector('#wx-result');
  if(state._wweatherCfg.lat!==''&&state._wweatherCfg.lat!=null){ msg.textContent='Current: '+(state._wweatherCfg.city||(state._wweatherCfg.lat+', '+state._wweatherCfg.lon)); msg.className='row-status ok'; }
  card.querySelectorAll('input[name="wx-units"]').forEach(r=>r.addEventListener('change',()=>{ if(r.checked)state._wweatherCfg.units=r.value; }));
  card.querySelectorAll('input[name="wx-feels"]').forEach(r=>r.addEventListener('change',()=>{ if(r.checked)state._wweatherCfg.feelsLike=(r.value==='feels'); }));
  resultSel.onchange=()=>{ const o=resultSel.selectedOptions[0]; if(!o||!o.value)return; const pp=JSON.parse(o.value); state._wweatherCfg.city=pp.label;state._wweatherCfg.lat=pp.lat;state._wweatherCfg.lon=pp.lon; msg.textContent='Selected: '+pp.label; msg.className='row-status ok'; };
  initInlineEdit('wx-href-row','wx-href',{placeholder:'https://...',onCommit(v){state._wweatherCfg.href=v;}});
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
      const f=JSON.parse(resultSel.value); state._wweatherCfg.city=f.label; state._wweatherCfg.lat=f.lat; state._wweatherCfg.lon=f.lon;
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
    <label class="segr-opt"><input type="radio" name="stats-sub" value="disk-health" ${state._wstatsSubType==='disk-health'?'checked':''}><span class="segr-dot"></span><span>Disk Health</span></label>
    <label class="segr-opt"><input type="radio" name="stats-sub" value="system-summary" ${state._wstatsSubType==='system-summary'?'checked':''}><span class="segr-dot"></span><span>System Summary</span></label>
  </div></div>`;
  body.appendChild(subRow);
  subRow.querySelectorAll('input[name="stats-sub"]').forEach(r=>r.addEventListener('change',()=>{
    if(!r.checked)return;
    state._wstatsSubType=r.value;
    const cfg=body.querySelector('#stats-cfg-body');
    if(cfg){cfg.innerHTML='';_renderStatsBody(cfg);}
  }));

  const cfgBody=document.createElement('div');cfgBody.id='stats-cfg-body';body.appendChild(cfgBody);
  _renderStatsBody(cfgBody);
}

function _renderStatsBody(body){
  if(state._wstatsSubType==='disk-health'){
    const bayCount = state._wsize==='medium' ? 10 : 4;
    while(state._wdiskCfg.bays.length < bayCount) state._wdiskCfg.bays.push(null);
    state._wdiskCfg.bays = state._wdiskCfg.bays.slice(0, bayCount);

    const prov0=state._wdiskCfg.diskProvider||'scrutiny';
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
        const cur=state._wdiskCfg.bays[i]||'';
        let opts='<option value="">Empty</option>';
        _items.forEach(it=>{ const cap=fmtCap(it.capacity); opts+=`<option value="${esc(it.value)}"${it.value===cur?' selected':''}>${esc(it.label)}${cap?' - '+cap:''}</option>`; });
        if(cur && !_items.some(it=>it.value===cur)) opts+=`<option value="${esc(cur)}" selected>${esc(cur)}</option>`;
        const row=document.createElement('div'); row.className='row';
        row.innerHTML=`<span class="rl">Bay ${i+1}</span><div class="sel-wrap"><select class="row-sel" id="dh-bay-${i}" aria-label="Bay ${i+1}">${opts}</select>${CHEV_SVG}</div>`;
        const sel=row.querySelector('select'); sel.value=cur;
        sel.onchange=()=>{ state._wdiskCfg.bays[i]=sel.value||null; };
        bayCard.appendChild(row);
      }
    }

    async function loadScrutiny(btn){
      const url=document.getElementById('dh-url')?.value?.trim();
      if(!url){ if(dhStatus){dhStatus.textContent='Enter a Scrutiny URL first.';dhStatus.className='row-status err';} return; }
      state._wdiskCfg.scrutinyUrl=url;
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
      const key=document.getElementById('dh-key')?.value?.trim()||(state._wdiskCfg.truenasKeySet?'__keep__':'');
      if(!url){ if(dhStatus){dhStatus.textContent='Enter a TrueNAS URL first.';dhStatus.className='row-status err';} return; }
      if(!key){ if(dhStatus){dhStatus.textContent='Enter an API key first.';dhStatus.className='row-status err';} return; }
      state._wdiskCfg.truenasUrl=url;
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
      const prov=state._wdiskCfg.diskProvider; _items=[]; fieldArea.innerHTML='';
      const isTn=prov==='truenas';
      const urlVal=isTn?(state._wdiskCfg.truenasUrl||''):(state._wdiskCfg.scrutinyUrl||'');
      const urlPh=isTn?'truenas:443':'scrutiny:8080';
      const hrefVal=isTn?(state._wdiskCfg.truenasHref||''):(state._wdiskCfg.scrutinyHref||'');
      const hrefPh=isTn?'https://truenas/ui/storage':'https://your-server:8080';
      fieldArea.insertAdjacentHTML('beforeend', `<div class="row ie-row" id="dh-url-row"><span class="rl">${isTn?'TrueNAS':'Scrutiny'} URL</span><span class="rv${urlVal?'':' is-ph'}">${urlVal?esc(urlVal):esc(urlPh)}</span><input id="dh-url" type="text" value="${esc(urlVal)}" style="display:none"><button class="pe" type="button" aria-label="Edit URL">${PE_SVG}</button></div>`);
      if(isTn) _secretRow(fieldArea,{rowId:'dh-key-row',inpId:'dh-key',label:'API Key',isSet:state._wdiskCfg.truenasKeySet});
      const fr=document.createElement('div'); fr.className='row'; fr.innerHTML='<span class="rl"></span>';
      dhStatus=document.createElement('span'); dhStatus.className='row-status'; dhStatus.id='dh-msg'; fr.appendChild(dhStatus);
      const fbtn=document.createElement('button'); fbtn.type='button'; fbtn.className='row-btn'; fbtn.id='dh-load'; fbtn.textContent=isTn?'Fetch Pools':'Fetch Drives'; fr.appendChild(fbtn);
      fieldArea.appendChild(fr);
      fbtn.onclick=()=> isTn?loadTrueNas(fbtn):loadScrutiny(fbtn);
      fieldArea.insertAdjacentHTML('beforeend', `<div class="row ie-row" id="dh-href-row"><span class="rl">Link URL <span class="opt-span">(optional)</span></span><span class="rv${hrefVal?'':' is-ph'}">${hrefVal?esc(hrefVal):esc(hrefPh)}</span><input id="dh-href" type="text" value="${esc(hrefVal)}" style="display:none"><button class="pe" type="button" aria-label="Edit link URL">${PE_SVG}</button></div>`);
      initInlineEdit('dh-url-row','dh-url',{placeholder:urlPh,onCommit(v){ if(state._wdiskCfg.diskProvider==='truenas')state._wdiskCfg.truenasUrl=v; else state._wdiskCfg.scrutinyUrl=v; }});
      initInlineEdit('dh-href-row','dh-href',{placeholder:hrefPh,onCommit(v){ if(state._wdiskCfg.diskProvider==='truenas')state._wdiskCfg.truenasHref=v; else state._wdiskCfg.scrutinyHref=v; }});
      renderBayRows();
    }

    provSel.onchange=()=>{ state._wdiskCfg.diskProvider=provSel.value; renderFields(); };
    renderFields();
    if(state._wdiskCfg.diskProvider!=='truenas' && state._wdiskCfg.scrutinyUrl){ const b=document.getElementById('dh-load'); if(b) b.click(); }
    return;
  }

  /* ── System Summary: 3 stat slots + network slot (settings-row, PSD) ── */
  const RES_LABELS={cpu:'CPU',ram:'RAM',temp:'Temperature',disk:'Disk Mount',iowait:'IO Wait',procs:'Processes'};
  const SLOT_DEFS=['#ff2d55','#30d158','#00c0e8'];

  function fillSlot(card, idx){
    const slot=state._wslots[idx]||{type:'cpu'};
    const resOpts=STAT_TYPES.map(t=>`<option value="${t}"${slot.type===t?' selected':''}>${RES_LABELS[t]}</option>`).join('');
    const res=document.createElement('div'); res.className='row';
    res.innerHTML=`<span class="rl">Resource</span><div class="sel-wrap"><select class="row-sel" aria-label="Resource">${resOpts}</select>${CHEV_SVG}</div>`;
    card.appendChild(res);
    res.querySelector('select').onchange=function(){ const t=this.value; state._wslots[idx]={type:t}; if(t==='disk'){state._wslots[idx].primary='/';state._wslots[idx].secondary='';} if(t==='temp'){state._wslots[idx].thermalZone=0;} card.innerHTML=''; fillSlot(card, idx); };

    if(slot.type==='disk'){
      card.insertAdjacentHTML('beforeend',
        `<div class="row ie-row" id="slot${idx}-pri"><span class="rl">First Mount Path</span><span class="rv${slot.primary?'':' is-ph'}">${esc(slot.primary||'/')}</span><input id="slot${idx}-pri-i" type="text" value="${esc(slot.primary||'/')}" style="display:none"><button class="pe" type="button" aria-label="Edit first mount path">${PE_SVG}</button></div>`
       +`<div class="row ie-row" id="slot${idx}-sec"><span class="rl">Second Mount Path <span class="opt-span">(optional)</span></span><span class="rv${slot.secondary?'':' is-ph'}">${slot.secondary?esc(slot.secondary):'/mnt/data'}</span><input id="slot${idx}-sec-i" type="text" value="${esc(slot.secondary||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit second mount path">${PE_SVG}</button></div>`);
      initInlineEdit(`slot${idx}-pri`,`slot${idx}-pri-i`,{placeholder:'/',onCommit(v){state._wslots[idx].primary=v;}});
      initInlineEdit(`slot${idx}-sec`,`slot${idx}-sec-i`,{placeholder:'/mnt/data',onCommit(v){state._wslots[idx].secondary=v;}});
    } else if(slot.type==='temp'){
      const z=Number.isInteger(slot.thermalZone)?slot.thermalZone:0;
      card.insertAdjacentHTML('beforeend',
        `<div class="row ie-row" id="slot${idx}-tz"><span class="rl">Thermal Zone</span><span class="rv">${z}</span><input id="slot${idx}-tz-i" type="number" min="0" max="20" value="${z}" style="display:none"><button class="pe" type="button" aria-label="Edit thermal zone">${PE_SVG}</button></div>`);
      const tip=document.createElement('p'); tip.className='grp-tip in-card'; tip.textContent='Zone 0 is correct for most systems. Only change it if the temperature shown is wrong.'; card.appendChild(tip);
      initInlineEdit(`slot${idx}-tz`,`slot${idx}-tz-i`,{onCommit(v){state._wslots[idx].thermalZone=parseInt(v,10)||0;}});
    }
    renderColorControl(card,{value:slot.color||SLOT_DEFS[idx]||'#0289ff',idPrefix:`slotcol${idx}`,onChange(v){state._wslots[idx].color=v;}});
  }

  state._wslots.slice(0,3).forEach((_slot,idx)=>{
    const hdr=document.createElement('p'); hdr.className='grp-hdr'; hdr.textContent='Slot '+(idx+1); body.appendChild(hdr);
    const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
    fillSlot(card, idx);
  });

  /* Slot 4: Network (Speed / Throughput / Uptime) */
  const prov=state._wnet.provider||'myspeed';
  const mode=state._wnet.mode||'speed';
  const netCard=document.createElement('div'); netCard.className='grp'; body.appendChild(netCard);
  netCard.innerHTML=`
    <div class="row"><span class="rl">Network</span><label class="tog"><input type="checkbox" id="net-en" ${state._wnet.enabled?'checked':''}><div class="tr"></div></label></div>
    <div id="net-sub" ${state._wnet.enabled?'':'hidden'}>
      <div class="row"><span class="rl">Show</span><div class="segr">
        <label class="segr-opt"><input type="radio" name="net-mode" value="speed" ${mode==='speed'?'checked':''}><span class="segr-dot"></span><span>Speed</span></label>
        <label class="segr-opt"><input type="radio" name="net-mode" value="throughput" ${mode==='throughput'?'checked':''}><span class="segr-dot"></span><span>Throughput</span></label>
        <label class="segr-opt"><input type="radio" name="net-mode" value="uptime" ${mode==='uptime'?'checked':''}><span class="segr-dot"></span><span>Uptime</span></label>
      </div></div>
      <div id="net-speed-fields" ${mode==='speed'?'':'hidden'}>
        <div class="row"><span class="rl">Provider</span><div class="segr">
          <label class="segr-opt"><input type="radio" name="net-prov" value="myspeed" ${prov==='myspeed'?'checked':''}><span class="segr-dot"></span><span>MySpeed</span></label>
          <label class="segr-opt"><input type="radio" name="net-prov" value="speedtest-tracker" ${prov==='speedtest-tracker'?'checked':''}><span class="segr-dot"></span><span>Speedtest Tracker</span></label>
        </div></div>
        <div class="row ie-row" id="net-url-row"><span class="rl">Service URL</span><span class="rv${state._wnet.url?'':' is-ph'}">${state._wnet.url?esc(state._wnet.url):(prov==='myspeed'?'myspeed:5216':'your-server:8850')}</span><input id="net-url" type="text" value="${esc(state._wnet.url||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit service URL">${PE_SVG}</button></div>
      </div>
      <p class="grp-tip in-card" id="net-mode-tip" ${mode==='speed'?'hidden':''}>${mode==='throughput'?'Live interface throughput (RX/TX) from the container\u2019s network interface.':'System uptime.'}</p>
    </div>`;
  const netEn=netCard.querySelector('#net-en'), netSub=netCard.querySelector('#net-sub');
  const netSpeedFields=netCard.querySelector('#net-speed-fields'), netModeTip=netCard.querySelector('#net-mode-tip');
  netEn.onchange=()=>{ state._wnet.enabled=netEn.checked; netSub.hidden=!netEn.checked; };
  netCard.querySelectorAll('input[name="net-mode"]').forEach(r=>r.addEventListener('change',()=>{
    if(!r.checked)return; state._wnet.mode=r.value;
    const isSpeed=r.value==='speed';
    netSpeedFields.hidden=!isSpeed;
    netModeTip.hidden=isSpeed;
    netModeTip.textContent=r.value==='throughput'?'Live interface throughput (RX/TX) from the container\u2019s network interface.':'System uptime.';
  }));
  netCard.querySelectorAll('input[name="net-prov"]').forEach(r=>r.addEventListener('change',()=>{
    if(!r.checked)return; state._wnet.provider=r.value;
    const pr=netCard.querySelector('#net-pass-row'); if(pr)pr.hidden=(r.value!=='myspeed');
    const uv=netCard.querySelector('#net-url-row .rv'); if(uv&&uv.classList.contains('is-ph'))uv.textContent=(r.value==='myspeed'?'myspeed:5216':'your-server:8850');
  }));
  initInlineEdit('net-url-row','net-url',{placeholder:(prov==='myspeed'?'myspeed:5216':'your-server:8850'),onCommit(v){state._wnet.url=v;}});
  _secretRow(netSpeedFields,{rowId:'net-pass-row',inpId:'net-pass',label:'Password',opt:true,isSet:state._wnet.myspeedPassSet,hidden:(prov!=='myspeed')});
}


function _renderConnectionsConfig(body){
  if(state._wconnView==='vpn') return _renderVpnConfig(body);
  return _renderMapConfig(body);
}

/* VPN view config: single tunnel, VPN services only (Gluetun / NetBird). */
function _renderVpnConfig(body){
  const svc=state._wvpnCfg.service||'gluetun';
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  card.innerHTML=`
    <div class="row"><span class="rl">Service</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="vpn-svc" value="gluetun" ${svc==='gluetun'?'checked':''}><span class="segr-dot"></span><span>Gluetun</span></label>
      <label class="segr-opt"><input type="radio" name="vpn-svc" value="netbird" ${svc==='netbird'?'checked':''}><span class="segr-dot"></span><span>NetBird</span></label>
    </div></div>
    <div class="row ie-row" id="vpn-name-row"><span class="rl">Display Name <span class="opt-span">(optional)</span></span><span class="rv${state._wvpnCfg.name?'':' is-ph'}">${state._wvpnCfg.name?esc(state._wvpnCfg.name):(svc==='gluetun'?'VPN':'Mesh')}</span><input id="vpn-name" type="text" value="${esc(state._wvpnCfg.name||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit display name">${PE_SVG}</button></div>`;
  card.querySelectorAll('input[name="vpn-svc"]').forEach(r=>r.addEventListener('change',()=>{ if(r.checked){state._wvpnCfg.service=r.value; _renderWidgetForm(body);} }));
  initInlineEdit('vpn-name-row','vpn-name',{placeholder:(svc==='gluetun'?'VPN':'Mesh'),onCommit(v){state._wvpnCfg.name=v;}});

  const colHdr=document.createElement('p'); colHdr.className='grp-hdr'; colHdr.textContent='Dot Color'; body.appendChild(colHdr);
  const colCard=document.createElement('div'); colCard.className='grp'; body.appendChild(colCard);
  if(!state._wvpnCfg.color)state._wvpnCfg.color='#30d158';
  renderColorControl(colCard,{value:state._wvpnCfg.color,idPrefix:'vpncol',onChange(v){state._wvpnCfg.color=v;}});

  const cCard=document.createElement('div'); cCard.className='grp'; body.appendChild(cCard);
  if(svc==='gluetun'){
    cCard.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="vpn-url-row"><span class="rl">Control Server URL <span class="req">*</span></span><span class="rv${state._wvpnCfg.url?'':' is-ph'}">${state._wvpnCfg.url?esc(state._wvpnCfg.url):'http://gluetun:8000'}</span><input id="vpn-url" type="text" value="${esc(state._wvpnCfg.url||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit URL">${PE_SVG}</button></div>`);
    initInlineEdit('vpn-url-row','vpn-url',{placeholder:'http://gluetun:8000',onCommit(v){state._wvpnCfg.url=v;}});
    _secretRow(cCard,{rowId:'vpn-apikey-row',inpId:'vpn-apikey',label:'API Key',opt:true,isSet:state._wvpnCfg.apiKeySet,onInput(v){state._wvpnCfg.apiKey=v;}});
  } else {
    cCard.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="vpn-url-row"><span class="rl">Management API URL <span class="req">*</span></span><span class="rv${state._wvpnCfg.url?'':' is-ph'}">${state._wvpnCfg.url?esc(state._wvpnCfg.url):'http://netbird:33073'}</span><input id="vpn-url" type="text" value="${esc(state._wvpnCfg.url||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit URL">${PE_SVG}</button></div>`);
    initInlineEdit('vpn-url-row','vpn-url',{placeholder:'http://netbird:33073',onCommit(v){state._wvpnCfg.url=v;}});
    _secretRow(cCard,{rowId:'vpn-token-row',inpId:'vpn-token',label:'Access Token (PAT)',req:true,isSet:state._wvpnCfg.tokenSet,onInput(v){state._wvpnCfg.token=v;}});
  }
  cCard.insertAdjacentHTML('beforeend',`<div class="row ie-row" id="vpn-href-row"><span class="rl">Click URL <span class="opt-span">(optional)</span></span><span class="rv${state._wvpnCfg.href?'':' is-ph'}">${state._wvpnCfg.href?esc(state._wvpnCfg.href):'http://your-server:8000'}</span><input id="vpn-href" type="text" value="${esc(state._wvpnCfg.href||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit click URL">${PE_SVG}</button></div>`);
  initInlineEdit('vpn-href-row','vpn-href',{placeholder:'http://your-server:8000',onCommit(v){state._wvpnCfg.href=v;}});
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
  if(!Array.isArray(state._wmapCfg.services)) state._wmapCfg.services=[];
  state._wmapCfg.services.forEach(sv=>{ if(!sv.id)sv.id=_newSvcId(); });

  const listHost=document.createElement('div'); body.appendChild(listHost);

  function buildCard(svc,i){
    const meta=_MAP_SVC[svc.type]||_MAP_SVC.gluetun;
    const hdr=document.createElement('p'); hdr.className='grp-hdr grp-hdr-row';
    hdr.innerHTML=`<span>${esc(svc.name||meta.label||('Service '+(i+1)))}</span>`;
    const rm=document.createElement('button'); rm.type='button'; rm.className='grp-hdr-rm'; rm.textContent='Remove';
    rm.onclick=()=>{ state._wmapCfg.services.splice(i,1); renderList(); };
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
    state._wmapCfg.services.sort((a,b)=>String(a.name||'').toLowerCase().localeCompare(String(b.name||'').toLowerCase()));
    listHost.innerHTML='';
    if(!state._wmapCfg.services.length){
      const empty=document.createElement('p'); empty.className='grp-tip'; empty.textContent='No services yet. Add one below.'; listHost.appendChild(empty);
    }
    state._wmapCfg.services.forEach((svc,i)=>buildCard(svc,i));
  }
  renderList();

  const addCard=document.createElement('div'); addCard.className='grp'; body.appendChild(addCard);
  const add=document.createElement('button'); add.type='button'; add.className='wcf-add-row';
  add.innerHTML='<span class="rl" style="color:var(--ac2)">+ Add Service</span>';
  add.onclick=()=>{ state._wmapCfg.services.push({id:_newSvcId(),type:'gluetun',name:'',url:'',adminUrl:'',color:'#30d158',token:'',enabled:true}); renderList(); };
  addCard.appendChild(add);

  const legCard=document.createElement('div'); legCard.className='grp'; body.appendChild(legCard);
  legCard.innerHTML=`<div class="row"><span class="rl">Show Legend</span><label class="tog"><input type="checkbox" id="map-legend" ${state._wmapCfg.showLegend!==false?'checked':''}><div class="tr"></div></label></div>`;
  legCard.querySelector('#map-legend').onchange=e=>{ state._wmapCfg.showLegend=e.target.checked; };
  const legTip=document.createElement('p'); legTip.className='grp-tip'; legTip.textContent='Service key along the bottom of the map.'; body.appendChild(legTip);
}

function _renderCustomConfig(body){
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  card.innerHTML=`<div class="row ie-row" id="cust-url-row"><span class="rl">Iframe URL <span class="req">*</span></span><span class="rv${state._customUrl?'':' is-ph'}">${state._customUrl?esc(state._customUrl):'https://app.example.com/widget.html'}</span><input id="f-url" type="url" value="${esc(state._customUrl||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit iframe URL">${PE_SVG}</button></div>`;
  const tip=document.createElement('p'); tip.className='grp-tip'; tip.textContent='The URL will be embedded as an iframe in the dashboard.'; body.appendChild(tip);
  initInlineEdit('cust-url-row','f-url',{placeholder:'https://app.example.com/widget.html',onCommit(v){state._customUrl=v;}});

  const o=state._iframeOpts||{};
  const advHdr=document.createElement('p'); advHdr.className='grp-hdr'; advHdr.textContent='Advanced'; body.appendChild(advHdr);
  const adv=document.createElement('div'); adv.className='grp'; body.appendChild(adv);
  const refOpts=['','no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url'].map(v=>`<option value="${v}" ${(o.referrerPolicy||'')===v?'selected':''}>${v||'Default'}</option>`).join('');
  adv.innerHTML=`
    <div class="row"><span class="rl">Referrer Policy</span><div class="sel-wrap"><select class="row-sel" id="if-referrer" aria-label="Referrer policy">${refOpts}</select>${CHEV_SVG}</div></div>
    <div class="row ie-row" id="if-allow-row"><span class="rl">Allow (feature policy)</span><span class="rv${o.allow?'':' is-ph'}">${o.allow?esc(o.allow):'autoplay; fullscreen'}</span><input id="if-allow" type="text" value="${esc(o.allow||'')}" style="display:none"><button class="pe" type="button" aria-label="Edit allow">${PE_SVG}</button></div>
    <div class="row"><span class="rl">Allow Fullscreen</span><label class="tog"><input type="checkbox" id="if-fs" ${o.allowFullscreen!==false?'checked':''}><div class="tr"></div></label></div>
    <div class="row ie-row" id="if-refresh-row"><span class="rl">Refresh Interval <span class="opt-span">(ms)</span></span><span class="rv${o.refreshInterval?'':' is-ph'}">${o.refreshInterval?o.refreshInterval:'e.g. 2000'}</span><input id="if-refresh" type="number" min="250" step="250" value="${o.refreshInterval||''}" style="display:none"><button class="pe" type="button" aria-label="Edit refresh interval">${PE_SVG}</button></div>`;
  const sync=()=>{ state._iframeOpts.referrerPolicy=adv.querySelector('#if-referrer').value||undefined; state._iframeOpts.allow=adv.querySelector('#if-allow').value.trim()||undefined; state._iframeOpts.allowFullscreen=adv.querySelector('#if-fs').checked; const ri=parseInt(adv.querySelector('#if-refresh').value,10); state._iframeOpts.refreshInterval=(ri&&ri>=250)?ri:undefined; };
  adv.querySelector('#if-referrer').onchange=sync; adv.querySelector('#if-fs').onchange=sync;
  initInlineEdit('if-allow-row','if-allow',{placeholder:'autoplay; fullscreen',onCommit(){sync();}});
  initInlineEdit('if-refresh-row','if-refresh',{placeholder:'e.g. 2000',onCommit(){sync();}});
}


/* Auto-fill connection from first same-provider slot that has a URL */
function _autofillSlot(si, provider) {
  const slots = state._wbackupCfg.slots;
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

/* Custom dropdown: native <select> popups don't open in some embedded webviews,
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
  const slotCount = state._wsize === 'small' ? 1 : 3;
  const SLOT_NAMES = ['First','Second','Third'];
  const slots = state._wbackupCfg.slots;
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
        const url=(document.getElementById(`dup-url-${si}`)?.value||'').trim();
        const pass=(document.getElementById(`dup-pass-${si}`)?.value||'').trim();
        if(!url){toast('Enter a Duplicati URL first','err');return;}
        this.disabled=true; this.textContent='Fetching...';
        try{
          slot.dupUrl=url;
          const b={url}; if(pass) b.password=pass; else if(slot.dupPassSet) b.useStoredPass=true;
          const wid=(state.eid!==null&&state.items[state.eid]?.id)?state.items[state.eid].id:'__preview__';
          const r=await fetch(`/api/duplicati-jobs/${encodeURIComponent(wid)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
          if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||r.status);}
          const data=await r.json();
          slot.dupJobList=Array.isArray(data)?data:(Array.isArray(data?.jobs)?data.jobs:[]);
          slots.forEach((sl,j)=>{ if(j!==si && sl.provider==='duplicati' && (shared && usesDefault(j) || sl.dupUrl===url)){ sl.dupJobList=slot.dupJobList; const w=document.getElementById(`dup-job-wrap-${j}`); if(w) renderJobDrop(j,w); } });
          const jw=document.getElementById(`dup-job-wrap-${si}`); if(jw) renderJobDrop(si, jw);
          toast(slot.dupJobList.length?`Loaded ${slot.dupJobList.length} job${slot.dupJobList.length>1?'s':''}`:'No backup jobs found', slot.dupJobList.length?'ok':'err');
        }catch(e){toast('Fetch failed: '+e.message,'err');}
        finally{this.disabled=false; this.textContent='Fetch Jobs';}
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
        const url=(document.getElementById(`kopia-url-${si}`)?.value||'').trim();
        const user=(document.getElementById(`kopia-user-${si}`)?.value||'').trim();
        const pass=(document.getElementById(`kopia-pass-${si}`)?.value||'').trim();
        if(!url){toast('Enter a Kopia URL first','err');return;}
        this.disabled=true; this.textContent='Fetching...';
        try{
          slot.kopiaUrl=url; slot.kopiaUser=user||slot.kopiaUser;
          const b={url}; if(user)b.username=user; if(pass)b.password=pass; else if(slot.kopiaPassSet)b.useStoredPass=true;
          const wid=(state.eid!==null&&state.items[state.eid]?.id)?state.items[state.eid].id:'__preview__';
          const r=await fetch(`/api/kopia-sources/${encodeURIComponent(wid)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
          if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||r.status);}
          const srcs=await r.json();
          slot.kopiaSrcList=Array.isArray(srcs)?srcs:(Array.isArray(srcs?.sources)?srcs.sources:[]);
          slots.forEach((sl,j)=>{ if(j!==si && sl.provider==='kopia' && (shared && usesDefault(j) || sl.kopiaUrl===url)){ sl.kopiaSrcList=slot.kopiaSrcList; const w=document.getElementById(`kopia-src-wrap-${j}`); if(w) renderSrcDrop(j,w); } });
          const sw=document.getElementById(`kopia-src-wrap-${si}`); if(sw) renderSrcDrop(si, sw);
          toast(slot.kopiaSrcList.length?`Loaded ${slot.kopiaSrcList.length} source${slot.kopiaSrcList.length>1?'s':''}`:'No sources found', slot.kopiaSrcList.length?'ok':'err');
        }catch(e){toast('Fetch failed: '+e.message,'err');}
        finally{this.disabled=false; this.textContent='Fetch Sources';}
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
