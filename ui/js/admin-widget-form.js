/* Admin UI: widget configuration form.
   Builds the widget edit form and its per-type config sections. Reads and
   writes shared widget state on the state object; exports buildWidgetForm,
   called by the edit shell. */
import { state } from '/js/admin-state.js?v=1';
import { toast, PE_SVG, CHEV_SVG, _secretRow, initInlineEdit } from '/js/admin-shared.js?v=2';
import { renderColorControl } from '/js/admin-color-control.js?v=1';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=5';
import { html, raw, setHtml } from '/js/html.js?v=1';
import { normBackupSlots, sizesForView } from '/js/admin-logic.js?v=1';

const SIZE_ICONS={
  small:'<rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="9.7" r="1" fill="currentColor"/><line x1="9" y1="13.4" x2="13" y2="13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  medium:'<rect x="4" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor"/><line x1="10.2" y1="11.4" x2="16.5" y2="11.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="7" y1="14.3" x2="16.5" y2="14.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  large:'<rect x="6" y="5.5" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><line x1="8" y1="12.6" x2="16" y2="12.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="14.8" x2="16" y2="14.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  xlarge:'<rect x="7" y="3.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="7" r="1.1" fill="currentColor"/><line x1="9" y1="10.5" x2="15" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="12.7" x2="15" y2="12.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="14.9" x2="15" y2="14.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="17.1" x2="13" y2="17.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

const CUSTOM_SIZES = ['small','medium','large','xlarge'];
function widgetSizes(type){ return type==='custom' ? CUSTOM_SIZES : (state._widgetReg[type]?.sizes || ['medium']); }
const SIZE_LABELS = { small:'Small', medium:'Medium', large:'Large', xlarge:'Extra Large' };
const STAT_TYPES  = ['cpu','ram','temp','disk','iowait','procs'];

function appendRow(host, tpl, cls='row'){
  const el=document.createElement('div'); el.className=cls;
  setHtml(el, tpl); host.appendChild(el); return el;
}
function appendIeRow(host,{rowId,label,req,opt,value,ph,inpId,type}){
  const el=document.createElement('div'); el.className='row ie-row'; el.id=rowId;
  setHtml(el, html`<span class="rl">${label}${req?html` <span class="req">*</span>`:''}${opt?html` <span class="opt-span">(optional)</span>`:''}</span><span class="rv${value?'':' is-ph'}">${value?value:ph||''}</span><input id="${inpId}" type="${type||'text'}" value="${value==null?'':value}" style="display:none"><button class="pe" type="button" aria-label="Edit ${label}">${raw(PE_SVG)}</button>`);
  host.appendChild(el); return el;
}


export function buildWidgetForm(body,item){
  const wt = item?.widgetType || 'custom';
  const ws = item?.widgetSize || 'medium';
  const wc = item?.widgetConfig || {};
  state._wtype = wt; state._wsize = ws;
  state._wlabel = item?.label || '';
  state._wAutoCfg = Object.assign({}, wc);
  state._wslots = (wc.slots || [{type:'cpu'},{type:'ram'},{type:'disk',primary:'/',secondary:''}]);
  while(state._wslots.length < 3) state._wslots.push({type:'cpu'});
  state._wstatsSubType = wc.widgetSubType || 'system-summary';
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

  const typeList=[...Object.values(state._widgetReg).map(w=>[w.name,w.label]), ['custom','Custom']].sort((a,b)=>a[1].localeCompare(b[1]));
  const typeOpts=typeList.map(([t,label])=>html`<option value="${t}"${t===state._wtype?' selected':''}>${label}</option>`);
  const shell=document.createElement('div'); shell.className='grp';
  setHtml(shell, html`
    <div class="row ie-row" id="ie-wname"><span class="rl">Name</span><span class="rv${state._wlabel?'':' is-ph'}">${state._wlabel?state._wlabel:'My Widget'}</span><input id="f-wlabel" type="text" value="${state._wlabel}" style="display:none"><button class="pe" type="button" aria-label="Edit name">${raw(PE_SVG)}</button></div>
    <div class="row"><span class="rl">Widget Type</span><div class="sel-wrap"><select id="f-wtype" class="row-sel" aria-label="Widget type">${typeOpts}</select>${raw(CHEV_SVG)}</div></div>`);
  body.appendChild(shell);
  initInlineEdit('ie-wname','f-wlabel',{placeholder:'My Widget',onCommit(v){state._wlabel=v;}});
  const typeSel=shell.querySelector('#f-wtype');
  typeSel.onchange=()=>{ state._wtype=typeSel.value; state._wsize=widgetSizes(state._wtype)[0]; _renderWidgetForm(body); };

  const _sizeOpts=sizesForView(widgetSizes(state._wtype), state._widgetReg[state._wtype], state._wAutoCfg);
  if(!_sizeOpts.includes(state._wsize)) state._wsize=_sizeOpts.includes('medium')?'medium':_sizeOpts[0];
  const sizeHdr=document.createElement('p'); sizeHdr.className='grp-hdr'; sizeHdr.textContent='Size'; body.appendChild(sizeHdr);
  const scard=document.createElement('div'); scard.className='grp';
  setHtml(scard, html`<div class="row tile-row"><div class="tile-grp tile-grp-left">${_sizeOpts.map(s=>html`<button type="button" class="tile-opt${s===state._wsize?' on':''}" data-size="${s}"><span class="tile-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${raw(SIZE_ICONS[s]||SIZE_ICONS.medium)}</svg></span><span class="tile-cap">${SIZE_LABELS[s]}</span></button>`)}</div></div>`);
  body.appendChild(scard);
  scard.querySelectorAll('.tile-opt').forEach(b=>b.addEventListener('click',()=>{ state._wsize=b.dataset.size; if(state._wtype==='backup'){state._wbackupCfg.slots=normBackupSlots(state._wbackupCfg.slots,state._wsize);} _renderWidgetForm(body); }));

    const cfgDiv=document.createElement('div');cfgDiv.className='div';body.appendChild(cfgDiv);
  if(state._widgetReg[state._wtype] && !state._widgetReg[state._wtype].customEditor){
    const d=document.createElement('div'); body.appendChild(d);
    const _wid=(state.eid!==null&&state.items[state.eid]&&state.items[state.eid].id)?state.items[state.eid].id:null;
    const _vf=state._widgetReg[state._wtype].viewField;
    state._autoForm=renderWidgetConfigForm(d, state._widgetReg[state._wtype].fields||[], state._wAutoCfg, {
      widgetId:_wid, widgetType:state._wtype, size:state._wsize,
      /* A view switch can change which sizes are offered, and the tiles are
         drawn above this form, so the whole form is redrawn. */
      onChange(key){ if(_vf&&key===_vf) _renderWidgetForm(body); },
    });
    state._autoFormType=state._wtype;
  }
  else if(state._wtype==='stats')        _renderStatsConfig(body);
  else if(state._wtype==='backup'){ const d=document.createElement('div');d.id='bak-cfg-body';body.appendChild(d);_renderBackupConfig(d); }
  else                        _renderCustomConfig(body);
}

function _renderStatsConfig(body){
  const subRow=document.createElement('div'); subRow.className='grp';
  setHtml(subRow, html`<div class="row"><span class="rl">Type</span><div class="segr">
    <label class="segr-opt"><input type="radio" name="stats-sub" value="disk-health" ${state._wstatsSubType==='disk-health'?'checked':''}><span class="segr-dot"></span><span>Disk Health</span></label>
    <label class="segr-opt"><input type="radio" name="stats-sub" value="system-summary" ${state._wstatsSubType==='system-summary'?'checked':''}><span class="segr-dot"></span><span>System Summary</span></label>
  </div></div>`);
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
    const provRow=appendRow(srcCard, html`<span class="rl">Source</span><div class="sel-wrap"><select class="row-sel" id="dh-prov" aria-label="Source"><option value="scrutiny"${prov0==='scrutiny'?' selected':''}>Scrutiny</option><option value="truenas"${prov0==='truenas'?' selected':''}>TrueNAS</option></select>${raw(CHEV_SVG)}</div>`);
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
        const opts=[html`<option value="">Empty</option>`];
        _items.forEach(it=>{ const cap=fmtCap(it.capacity); opts.push(html`<option value="${it.value}"${it.value===cur?' selected':''}>${it.label}${cap?' - '+cap:''}</option>`); });
        if(cur && !_items.some(it=>it.value===cur)) opts.push(html`<option value="${cur}" selected>${cur}</option>`);
        const row=appendRow(bayCard, html`<span class="rl">Bay ${i+1}</span><div class="sel-wrap"><select class="row-sel" id="dh-bay-${i}" aria-label="Bay ${i+1}">${opts}</select>${raw(CHEV_SVG)}</div>`);
        const sel=row.querySelector('select'); sel.value=cur;
        sel.onchange=()=>{ state._wdiskCfg.bays[i]=sel.value||null; };
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
        const r=await fetch('/api/truenas-proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,key})});
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
      appendIeRow(fieldArea,{rowId:'dh-url-row',label:(isTn?'TrueNAS':'Scrutiny')+' URL',value:urlVal,ph:urlPh,inpId:'dh-url'});
      if(isTn) _secretRow(fieldArea,{rowId:'dh-key-row',inpId:'dh-key',label:'API Key',isSet:state._wdiskCfg.truenasKeySet});
      const fr=appendRow(fieldArea, html`<span class="rl"></span>`);
      dhStatus=document.createElement('span'); dhStatus.className='row-status'; dhStatus.id='dh-msg'; fr.appendChild(dhStatus);
      const fbtn=document.createElement('button'); fbtn.type='button'; fbtn.className='row-btn'; fbtn.id='dh-load'; fbtn.textContent=isTn?'Fetch Pools':'Fetch Drives'; fr.appendChild(fbtn);
      fbtn.onclick=()=> isTn?loadTrueNas(fbtn):loadScrutiny(fbtn);
      appendIeRow(fieldArea,{rowId:'dh-href-row',label:'Link URL',opt:true,value:hrefVal,ph:hrefPh,inpId:'dh-href'});
      initInlineEdit('dh-url-row','dh-url',{placeholder:urlPh,onCommit(v){ if(state._wdiskCfg.diskProvider==='truenas')state._wdiskCfg.truenasUrl=v; else state._wdiskCfg.scrutinyUrl=v; }});
      initInlineEdit('dh-href-row','dh-href',{placeholder:hrefPh,onCommit(v){ if(state._wdiskCfg.diskProvider==='truenas')state._wdiskCfg.truenasHref=v; else state._wdiskCfg.scrutinyHref=v; }});
      renderBayRows();
    }

    provSel.onchange=()=>{ state._wdiskCfg.diskProvider=provSel.value; renderFields(); };
    renderFields();
    if(state._wdiskCfg.diskProvider!=='truenas' && state._wdiskCfg.scrutinyUrl){ const b=document.getElementById('dh-load'); if(b) b.click(); }
    return;
  }

  const RES_LABELS={cpu:'CPU',ram:'RAM',temp:'Temperature',disk:'Disk Mount',iowait:'IO Wait',procs:'Processes'};
  const SLOT_DEFS=['#ff2d55','#30d158','#00c0e8'];

  function fillSlot(card, idx){
    const slot=state._wslots[idx]||{type:'cpu'};
    const resOpts=STAT_TYPES.map(t=>html`<option value="${t}"${slot.type===t?' selected':''}>${RES_LABELS[t]}</option>`);
    const res=appendRow(card, html`<span class="rl">Resource</span><div class="sel-wrap"><select class="row-sel" aria-label="Resource">${resOpts}</select>${raw(CHEV_SVG)}</div>`);
    res.querySelector('select').onchange=function(){ const t=this.value; state._wslots[idx]={type:t}; if(t==='disk'){state._wslots[idx].primary='/';state._wslots[idx].secondary='';} if(t==='temp'){state._wslots[idx].thermalZone=0;} card.innerHTML=''; fillSlot(card, idx); };

    if(slot.type==='disk'){
      appendIeRow(card,{rowId:`slot${idx}-pri`,label:'First Mount Path',value:slot.primary||'/',ph:'/',inpId:`slot${idx}-pri-i`});
      appendIeRow(card,{rowId:`slot${idx}-sec`,label:'Second Mount Path',opt:true,value:slot.secondary||'',ph:'/mnt/data',inpId:`slot${idx}-sec-i`});
      initInlineEdit(`slot${idx}-pri`,`slot${idx}-pri-i`,{placeholder:'/',onCommit(v){state._wslots[idx].primary=v;}});
      initInlineEdit(`slot${idx}-sec`,`slot${idx}-sec-i`,{placeholder:'/mnt/data',onCommit(v){state._wslots[idx].secondary=v;}});
    } else if(slot.type==='temp'){
      const z=Number.isInteger(slot.thermalZone)?slot.thermalZone:0;
      const tz=document.createElement('div'); tz.className='row ie-row'; tz.id=`slot${idx}-tz`;
      setHtml(tz, html`<span class="rl">Thermal Zone</span><span class="rv">${z}</span><input id="slot${idx}-tz-i" type="number" min="0" max="20" value="${z}" style="display:none"><button class="pe" type="button" aria-label="Edit thermal zone">${raw(PE_SVG)}</button>`);
      card.appendChild(tz);
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

  const prov=state._wnet.provider||'myspeed';
  const mode=state._wnet.mode||'speed';
  const netCard=document.createElement('div'); netCard.className='grp'; body.appendChild(netCard);
  setHtml(netCard, html`
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
        <div class="row ie-row" id="net-url-row"><span class="rl">Service URL</span><span class="rv${state._wnet.url?'':' is-ph'}">${state._wnet.url?state._wnet.url:(prov==='myspeed'?'myspeed:5216':'your-server:8850')}</span><input id="net-url" type="text" value="${state._wnet.url||''}" style="display:none"><button class="pe" type="button" aria-label="Edit service URL">${raw(PE_SVG)}</button></div>
      </div>
      <p class="grp-tip in-card" id="net-mode-tip" ${mode==='speed'?'hidden':''}>${mode==='throughput'?'Live interface throughput (RX/TX) from the container\u2019s network interface.':'System uptime.'}</p>
    </div>`);
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


function _renderCustomConfig(body){
  const card=document.createElement('div'); card.className='grp'; body.appendChild(card);
  setHtml(card, html`<div class="row ie-row" id="cust-url-row"><span class="rl">Iframe URL <span class="req">*</span></span><span class="rv${state._customUrl?'':' is-ph'}">${state._customUrl?state._customUrl:'https://app.example.com/widget.html'}</span><input id="f-url" type="url" value="${state._customUrl||''}" style="display:none"><button class="pe" type="button" aria-label="Edit iframe URL">${raw(PE_SVG)}</button></div>`);
  const tip=document.createElement('p'); tip.className='grp-tip'; tip.textContent='The URL will be embedded as an iframe in the dashboard.'; body.appendChild(tip);
  initInlineEdit('cust-url-row','f-url',{placeholder:'https://app.example.com/widget.html',onCommit(v){state._customUrl=v;}});

  const o=state._iframeOpts||{};
  const advHdr=document.createElement('p'); advHdr.className='grp-hdr'; advHdr.textContent='Advanced'; body.appendChild(advHdr);
  const adv=document.createElement('div'); adv.className='grp'; body.appendChild(adv);
  const refOpts=['','no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url'].map(v=>html`<option value="${v}" ${(o.referrerPolicy||'')===v?'selected':''}>${v||'Default'}</option>`);
  setHtml(adv, html`
    <div class="row"><span class="rl">Referrer Policy</span><div class="sel-wrap"><select class="row-sel" id="if-referrer" aria-label="Referrer policy">${refOpts}</select>${raw(CHEV_SVG)}</div></div>
    <div class="row ie-row" id="if-allow-row"><span class="rl">Allow (feature policy)</span><span class="rv${o.allow?'':' is-ph'}">${o.allow?o.allow:'autoplay; fullscreen'}</span><input id="if-allow" type="text" value="${o.allow||''}" style="display:none"><button class="pe" type="button" aria-label="Edit allow">${raw(PE_SVG)}</button></div>
    <div class="row"><span class="rl">Allow Fullscreen</span><label class="tog"><input type="checkbox" id="if-fs" ${o.allowFullscreen!==false?'checked':''}><div class="tr"></div></label></div>
    <div class="row ie-row" id="if-refresh-row"><span class="rl">Refresh Interval <span class="opt-span">(ms)</span></span><span class="rv${o.refreshInterval?'':' is-ph'}">${o.refreshInterval?o.refreshInterval:'e.g. 2000'}</span><input id="if-refresh" type="number" min="250" step="250" value="${o.refreshInterval||''}" style="display:none"><button class="pe" type="button" aria-label="Edit refresh interval">${raw(PE_SVG)}</button></div>`);
  const sync=()=>{ state._iframeOpts.referrerPolicy=adv.querySelector('#if-referrer').value||undefined; state._iframeOpts.allow=adv.querySelector('#if-allow').value.trim()||undefined; state._iframeOpts.allowFullscreen=adv.querySelector('#if-fs').checked; const ri=parseInt(adv.querySelector('#if-refresh').value,10); state._iframeOpts.refreshInterval=(ri&&ri>=250)?ri:undefined; };
  adv.querySelector('#if-referrer').onchange=sync; adv.querySelector('#if-fs').onchange=sync;
  initInlineEdit('if-allow-row','if-allow',{placeholder:'autoplay; fullscreen',onCommit(){sync();}});
  initInlineEdit('if-refresh-row','if-refresh',{placeholder:'e.g. 2000',onCommit(){sync();}});
}


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
    appendIeRow(host,{rowId:rid,label,req,opt,value,ph,inpId:id,type});
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
    appendRow(host, html`<span class="rl">${label}</span><label class="tog"><input type="checkbox" id="bak-def-${si}" ${slot.useDefault!==false?'checked':''} aria-label="${label}"><div class="tr"></div></label>`);
    const tip=document.createElement('p'); tip.className='grp-tip in-card'; tip.textContent=desc; host.appendChild(tip);
    host.querySelector(`#bak-def-${si}`).onchange=e=>{ slot.useDefault=e.target.checked; rerender(); };
  }
  function fetchRow(host,{id,label}){
    const fr=appendRow(host, html`<span class="rl"></span>`);
    const btn=document.createElement('button'); btn.type='button'; btn.className='row-btn'; btn.id=id; btn.textContent=label;
    fr.appendChild(btn); return btn;
  }

  function renderJobDrop(si, container){
    const slot=slots[si]; container.innerHTML='';
    if(!slot.dupJobList.length){
      const saved=slot.jobId?(slot.customName||slot.jobId):'';
      appendRow(container, html`<span class="rl">Job</span><div class="sel-wrap"><select class="row-sel" id="dup-job-${si}" aria-label="Job" disabled><option>${saved?saved+', fetch to change':'Fetch jobs first'}</option></select>${raw(CHEV_SVG)}</div>`);
      return;
    }
    const opts=[html`<option value="">None</option>`, ...slot.dupJobList.map(j=>html`<option value="${String(j.id)}"${String(j.id)===String(slot.jobId||'')?' selected':''}>${j.name}</option>`)];
    const row=appendRow(container, html`<span class="rl">Job</span><div class="sel-wrap"><select class="row-sel" id="dup-job-${si}" aria-label="Job">${opts}</select>${raw(CHEV_SVG)}</div>`);
    const sel=row.querySelector('select'); sel.onchange=()=>{ slot.jobId=sel.value||null; };
  }
  function renderSrcDrop(si, container){
    const slot=slots[si]; container.innerHTML='';
    if(!slot.kopiaSrcList.length){
      const saved=slot.jobId?(slot.customName||slot.jobId):'';
      appendRow(container, html`<span class="rl">Source</span><div class="sel-wrap"><select class="row-sel" id="kopia-src-${si}" aria-label="Source" disabled><option>${saved?saved+', fetch to change':'Fetch sources first'}</option></select>${raw(CHEV_SVG)}</div>`);
      return;
    }
    const opts=[html`<option value="">None</option>`, ...slot.kopiaSrcList.map(src=>html`<option value="${src.id}"${String(src.id)===String(slot.jobId||'')?' selected':''}>${src.name}</option>`)];
    const row=appendRow(container, html`<span class="rl">Source</span><div class="sel-wrap"><select class="row-sel" id="kopia-src-${si}" aria-label="Source">${opts}</select>${raw(CHEV_SVG)}</div>`);
    const sel=row.querySelector('select'); sel.onchange=()=>{ slot.jobId=sel.value||null; };
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
    appendRow(card, html`<span class="rl">Provider</span><div class="segr">
      <label class="segr-opt"><input type="radio" name="bak-prov-${si}" value="" ${!prov?'checked':''}><span class="segr-dot"></span><span>None</span></label>
      <label class="segr-opt"><input type="radio" name="bak-prov-${si}" value="duplicati" ${prov==='duplicati'?'checked':''}><span class="segr-dot"></span><span>Duplicati</span></label>
      <label class="segr-opt"><input type="radio" name="bak-prov-${si}" value="kopia" ${prov==='kopia'?'checked':''}><span class="segr-dot"></span><span>Kopia</span></label>
    </div>`);
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
