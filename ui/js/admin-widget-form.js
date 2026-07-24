/* Admin UI: widget configuration form.
   Builds the widget edit form and its per-type config sections. Reads and
   writes shared widget state on the state object; exports buildWidgetForm,
   called by the edit shell. */
import { state } from '/js/admin-state.js?v=1';
import { PE_SVG, CHEV_SVG, initInlineEdit } from '/js/admin-shared.js?v=2';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=5';
import { html, raw, setHtml } from '/js/html.js?v=1';
import { sizesForView } from '/js/admin-logic.js?v=1';

const SIZE_ICONS={
  small:'<rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="9.7" r="1" fill="currentColor"/><line x1="9" y1="13.4" x2="13" y2="13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  medium:'<rect x="4" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor"/><line x1="10.2" y1="11.4" x2="16.5" y2="11.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="7" y1="14.3" x2="16.5" y2="14.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  large:'<rect x="6" y="5.5" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><line x1="8" y1="12.6" x2="16" y2="12.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="14.8" x2="16" y2="14.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  xlarge:'<rect x="7" y="3.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.7" cy="7" r="1.1" fill="currentColor"/><line x1="9" y1="10.5" x2="15" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="12.7" x2="15" y2="12.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="14.9" x2="15" y2="14.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="17.1" x2="13" y2="17.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

const CUSTOM_SIZES = ['small','medium','large','xlarge'];
function widgetSizes(type){ return type==='custom' ? CUSTOM_SIZES : (state._widgetReg[type]?.sizes || ['medium']); }
const SIZE_LABELS = { small:'Small', medium:'Medium', large:'Large', xlarge:'Extra Large' };

export function buildWidgetForm(body,item){
  const wt = item?.widgetType || 'custom';
  const ws = item?.widgetSize || 'medium';
  const wc = item?.widgetConfig || {};
  state._wtype = wt; state._wsize = ws;
  state._wlabel = item?.label || '';
  state._wAutoCfg = Object.assign({}, wc);
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
  scard.querySelectorAll('.tile-opt').forEach(b=>b.addEventListener('click',()=>{ state._wsize=b.dataset.size; _renderWidgetForm(body); }));

    const cfgDiv=document.createElement('div');cfgDiv.className='div';body.appendChild(cfgDiv);
  if(state._widgetReg[state._wtype]){
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
  else _renderCustomConfig(body);
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
