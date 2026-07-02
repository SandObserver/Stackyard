/* Reusable color control (swatch row + Hue/Saturation/Brightness + Color Code).
   Operates in hex, resolves named CSS colors, calls onChange(hex) on any change.
   Used by the Icon, Fixed Label and Live Activity sections and the Widget slots. */
import { PE_SVG, initInlineEdit } from '/js/admin-shared.js?v=1';

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

export function renderColorControl(container,{value='#0289ff',idPrefix,onChange,semantic=false}={}){
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
