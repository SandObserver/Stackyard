import { poll, fetchData, openUrl, html, setHtml, colorOrFallback, rgbOf, loadStrings, wt, errorState, theme, formatNumber, formatList, cssZoom, linkTo, whileOnScreen, reducedMotion, errorLine, errorGlyph } from '/js/widget-toolbox.js?v=039ea657';
import * as M from './world-map.js';
await loadStrings();
document.getElementById('c').setAttribute('aria-label', wt('ui.worldMap', 'World map of connections'));
(function(){

  const D=M.WORLD;
  const params=new URLSearchParams(location.search);
  const id=params.get('id')||'';
  let reduce=reducedMotion(v=>{reduce=v;kick();});
  const cv=document.getElementById('c'), ctx=cv.getContext('2d');
  const keyEl=document.getElementById('key'), srEl=document.getElementById('sr');
  const TAU=6.28318530718;
  const PITCH=3.4, TOP=13.6;
  const DEFAULT_DOT='#DB34F2';

  const colourOf=c=>rgbOf(c)||rgbOf(DEFAULT_DOT);
  const rgbCss=a=>'rgb('+a.join(',')+')';
  const lang=()=>document.documentElement.lang||'en';
  const fmtName=cc=>{try{return new Intl.DisplayNames([lang(),'en'],{type:'region'}).of(cc)||cc;}catch(e){return cc;}};
  const byName=(a,b)=>String(a.name).localeCompare(String(b.name),lang(),{numeric:true,sensitivity:'base'});

  let lit=new Map(), points=[], legend=[], showLegend=true, emphasis=null;
  /* One frame pending at most. Each poll and resize asks for a frame; queuing
     a new one each time stacks endless animation loops. */
  let raf=0;
  const PULSE_MS=66;
  let repaint=false, lastDraw=-Infinity;
  function kick(){repaint=true;if(!raf)raf=requestAnimationFrame(frame);}
  function frame(now){
    raf=0;
    if(repaint||now-lastDraw>=PULSE_MS){repaint=false;lastDraw=now;draw(now);}
    if(!reduce&&points.length&&onScreen&&!raf)raf=requestAnimationFrame(frame);
  }
  let onScreen=false;
  whileOnScreen(cv,v=>{onScreen=v;if(v)kick();});

  function computeLayers(data){
    lit=new Map();points=[];legend=[];
    showLegend=(data.meta||{}).showLegend!==false;
    const services=(Array.isArray(data.services)?data.services:[]).filter(Boolean).map((svc,idx)=>({
      svc, role:svc.id||(svc.type+'-'+idx), name:String(svc.name||svc.type||wt('ui.service','Service')),
    })).sort(byName);
    /* Points first. Region dots placed later never sit under a VPN marker. */
    const taken=new Set();
    for(const s of services){
      const svc=s.svc, col=colourOf(svc.color);
      s.chip={name:s.name,color:rgbCss(col),role:s.role,adminUrl:svc.adminUrl||'',error:svc.error?String(svc.error):'',errorKind:svc.errorKind||'internal',kind:'',spoken:''};
      legend.push(s.chip);
      if(svc.error){
        s.chip.kind=errorLine({kind:s.chip.errorKind});
        s.chip.spoken=s.chip.kind+'. '+s.chip.error.replace(/\.$/,'');
        continue;
      }
      if(svc.kind==='point'&&Number.isFinite(svc.lat)&&Number.isFinite(svc.lng)){
        const cell=M.pointCell(svc.lat,svc.lng);
        if(!cell)continue;
        taken.add(M.key(cell));
        points.push({cell,col,role:s.role,info:{role:s.role,serviceName:s.name,color:rgbCss(col),city:svc.city||'',country:svc.country||''}});
        s.chip.spoken=formatList([svc.city,svc.country].filter(Boolean),'plain');
      }
    }
    for(const s of services){
      const svc=s.svc;
      if(svc.error||svc.kind!=='regions'||!svc.regions)continue;
      const col=colourOf(svc.color), shares=M.allocate(svc.regions);
      for(const a of shares){
        const info={role:s.role,serviceName:s.name,color:rgbCss(col),cc:a.cc,users:a.users};
        for(const cell of M.place(a.cc,a.n,taken))lit.set(M.key(cell),{col,over:a.over,role:s.role,info});
      }
      const top=shares.toSorted((x,y)=>y.users-x.users);
      const said=top.slice(0,10).map(a=>fmtName(a.cc)+' '+formatNumber(a.users));
      if(top.length>10)said.push(wt('ui.more','+{n} more',{n:formatNumber(top.length-10)}));
      s.chip.spoken=formatList(said,'plain');
    }
    srEl.textContent=legend.map(l=>l.spoken?l.name+': '+l.spoken:l.name).join('. ');
    renderLegend();
  }

  function setEmphasis(role){
    emphasis=role;
    keyEl.querySelectorAll('.k').forEach(el=>el.classList.toggle('dim',!!role&&el.dataset.role!==role));
    kick();
  }

  /* Validate the dot colour. Assign it through named CSSOM properties, never a style string. */
  function dotFor(l){
    const dot=document.createElement('span');
    dot.className='dot';
    const c=colorOrFallback(l.color,DEFAULT_DOT);
    dot.style.backgroundColor=l.error?'transparent':c;
    if(l.error)dot.style.boxShadow='inset 0 0 0 1.5px '+c;
    return dot;
  }
  function glyphFor(l){
    const g=errorGlyph({kind:l.errorKind});
    g.classList.add('why');
    return g;
  }
  const pageDir=()=>document.documentElement.getAttribute('dir')==='rtl'?'rtl':'ltr';

  /* Keep the popover right after its item. Tab and screen readers reach it from there. */
  const pop=document.createElement('div');
  pop.id='why';
  pop.className='pop';
  pop.setAttribute('popover','auto');
  const descs=document.createElement('div');
  descs.hidden=true;
  document.body.append(descs,pop);
  const rowsOf=new Map();
  let openFor=null, refocus=null, pressedOpen=false;
  pop.addEventListener('beforetoggle',e=>{
    if(e.newState!=='closed'||!openFor)return;
    openFor.setAttribute('aria-expanded','false');
    refocus=pop.contains(document.activeElement)?openFor:null;
    openFor=null;
  });
  window.addEventListener('blur',()=>{if(openFor)pop.hidePopover();});
  pop.addEventListener('toggle',()=>{
    if(pop.matches(':popover-open'))return;
    document.body.append(pop);
    if(refocus&&refocus.isConnected&&document.activeElement!==refocus)refocus.focus({preventScroll:true});
    refocus=null;
  });

  function popRow(l){
    const row=document.createElement('div');
    row.className='pop-row';
    const head=document.createElement('div');
    head.className='pop-h';
    const name=document.createElement('bdi');
    name.textContent=l.name;
    head.append(dotFor(l),name);
    row.append(head);
    if(!l.error)return row;
    const kind=document.createElement('div');
    kind.className='pop-kind';
    kind.textContent=l.kind;
    /* Upstream text. Assigned, never interpolated. */
    const msg=document.createElement('p');
    msg.className='pop-msg';
    msg.lang='en';
    msg.dir='ltr';
    msg.textContent=l.error;
    row.append(kind,msg);
    if(l.adminUrl){
      const act=document.createElement('button');
      act.type='button';
      act.className='pop-act';
      act.textContent=wt('ui.openAdmin','open admin');
      act.addEventListener('click',()=>openUrl(l.adminUrl));
      row.append(act);
    }
    return row;
  }

  function placePop(btn){
    const z=cssZoom(), r=btn.getBoundingClientRect(), d=(btn.querySelector('.dot,.ring')||btn).getBoundingClientRect();
    const ww=window.innerWidth/z, wh=window.innerHeight/z, gap=6, pad=8;
    /* Never over its item. A second press on the item must reach it to close. */
    const above=r.top/z-gap-pad, below=wh-pad-r.bottom/z-gap;
    const inner=pop.firstElementChild, scrolled=inner?inner.scrollTop:0;
    pop.style.maxWidth=Math.max(0,Math.min(236,Math.floor(ww-2*pad)))+'px';
    pop.style.maxHeight='none';
    const up=pop.offsetHeight<=above||above>=below;
    pop.style.maxHeight=Math.max(0,Math.floor(up?above:below))+'px';
    const top=up?r.top/z-gap-pop.offsetHeight:r.bottom/z+gap;
    const left=Math.min(Math.max(pad,d.left/z-11),ww-pop.offsetWidth-pad);
    pop.style.top=Math.round(top)+'px';
    pop.style.left=Math.round(left)+'px';
    if(!inner)return;
    inner.scrollTop=scrolled;
    const scrolls=inner.scrollHeight>inner.clientHeight+4;
    if(scrolls){
      inner.tabIndex=0;
      inner.setAttribute('role','group');
      inner.setAttribute('aria-label',btn.getAttribute('aria-label')||'');
    } else {
      inner.removeAttribute('tabindex');
      inner.removeAttribute('role');
      inner.removeAttribute('aria-label');
    }
    fadeEdge();
  }
  function fadeEdge(){
    const inner=pop.firstElementChild;
    if(inner)inner.classList.toggle('fade',inner.scrollTop+inner.clientHeight<inner.scrollHeight-4);
  }
  function growPop(btn){
    if(typeof pop.animate!=='function')return;
    const b=(btn.querySelector('.dot,.ring')||btn).getBoundingClientRect(), r=pop.getBoundingClientRect();
    const x=Math.round(b.left+b.width/2-r.left), y=Math.round(b.top+b.height/2-r.top);
    pop.style.transformOrigin=String(x)+'px '+String(y)+'px';
    pop.animate(reduce?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'scale(.96)'},{opacity:1,transform:'none'}],
      {duration:reduce?120:180,easing:'cubic-bezier(.32,.72,0,1)'});
  }
  function openPop(btn,animate){
    if(openFor)pop.hidePopover();
    const inner=document.createElement('div');
    inner.className='pop-in';
    inner.append(...rowsOf.get(btn)());
    inner.addEventListener('scroll',fadeEdge,{passive:true});
    pop.replaceChildren(inner);
    pop.dir=pageDir();
    btn.after(pop);
    pop.showPopover();
    openFor=btn;
    btn.setAttribute('aria-expanded','true');
    placePop(btn);
    if(animate)growPop(btn);
  }
  function popButton(btn,rows){
    rowsOf.set(btn,rows);
    btn.setAttribute('aria-expanded','false');
    btn.setAttribute('aria-controls','why');
    /* A press on the open item closes it by light dismiss before its click. */
    btn.addEventListener('pointerdown',()=>{pressedOpen=openFor===btn;});
    btn.addEventListener('click',e=>{
      const wasOpen=openFor===btn||(pressedOpen&&e.detail>0);
      pressedOpen=false;
      if(!wasOpen)openPop(btn,true);
      else if(openFor===btn)pop.hidePopover();
    });
  }

  function renderLegend(){
    const keep=openFor?openFor.dataset.key:'';
    const keepTop=keep&&pop.firstElementChild?pop.firstElementChild.scrollTop:0;
    /* Only a frame that holds focus gets it back. Focusing in another one takes it from the page. */
    const act=document.hasFocus()?document.activeElement:null;
    let focusKey=act&&keyEl.contains(act)?act.dataset.key||'':'';
    const focusIn=act&&pop.contains(act)?[...pop.querySelectorAll('button,[tabindex]')].indexOf(act):-1;
    if(focusIn>=0)focusKey=keep;
    if(openFor)pop.hidePopover();
    refocus=null;
    rowsOf.clear();
    descs.replaceChildren();
    keyEl.replaceChildren();
    keyEl.hidden=!showLegend||!legend.length;
    if(keyEl.hidden)return;
    const shown=legend.length>3?legend.slice(0,2):legend;
    shown.forEach((l,i)=>{
      const failed=!!l.error, clickable=failed||!!l.adminUrl;
      const it=document.createElement(clickable?'button':'span');
      it.className=failed?'k has-why':'k';
      it.dataset.role=l.role;
      it.dataset.key='s:'+l.role;
      const name=document.createElement('bdi');
      name.textContent=l.name;
      if(failed){
        const col=document.createElement('span');
        col.className='col';
        const sub=document.createElement('span');
        sub.className='sub';
        const kind=document.createElement('span');
        kind.dir='auto';
        kind.textContent=l.kind;
        sub.append(glyphFor(l),kind);
        col.append(name,sub);
        it.append(dotFor(l),col);
      } else it.append(dotFor(l),name);
      if(clickable){
        it.type='button';
        if(failed){
          it.setAttribute('aria-label',formatList([l.name,l.kind],'plain'));
          const desc=document.createElement('span');
          desc.id='why-'+i;
          desc.lang='en';
          desc.textContent=l.error;
          descs.append(desc);
          it.setAttribute('aria-describedby',desc.id);
          popButton(it,()=>[popRow(l)]);
        } else {
          it.setAttribute('aria-label',formatList([l.name,wt('ui.openAdmin','open admin')],'plain'));
          it.addEventListener('click',()=>openUrl(l.adminUrl));
        }
        it.addEventListener('focus',()=>setEmphasis(l.role));
        it.addEventListener('blur',()=>setEmphasis(null));
      }
      it.addEventListener('pointerenter',()=>setEmphasis(l.role));
      it.addEventListener('pointerleave',()=>setEmphasis(null));
      keyEl.append(it);
    });
    if(legend.length>3){
      const rest=legend.slice(2), count=wt('ui.more','+{n} more',{n:formatNumber(rest.length)});
      const more=document.createElement('button');
      more.type='button';
      more.dataset.key='more';
      more.className='k more';
      if(rest.some(l=>l.error)){
        more.classList.add('has-ring');
        const ring=document.createElement('span');
        ring.className='ring';
        more.append(ring);
      }
      const text=document.createElement('bdi');
      text.textContent=count;
      more.append(text);
      more.setAttribute('aria-label',formatList([count,...rest.map(l=>l.error?l.name+' '+l.kind:l.name)],'plain'));
      popButton(more,()=>rest.map(popRow));
      keyEl.append(more);
    }
    keyEl.querySelectorAll('.k bdi').forEach(b=>{if(b.scrollWidth>b.clientWidth)b.title=b.textContent;});
    const byKey=k=>[...keyEl.querySelectorAll('button.k')].find(b=>b.dataset.key===k);
    const again=keep&&byKey(keep);
    if(again&&rowsOf.has(again)){
      openPop(again,false);
      const inner=pop.firstElementChild;
      if(inner&&keepTop){inner.scrollTop=keepTop;fadeEdge();}
      const f=focusIn>=0&&pop.querySelectorAll('button,[tabindex]')[focusIn];
      if(f){f.focus({preventScroll:true});focusKey='';}
    }
    const b=focusKey&&byKey(focusKey);
    if(b)b.focus({preventScroll:true});
  }

  function frameScale(){
    try{
      const f=window.frameElement, w=f&&f.getBoundingClientRect().width, r=document.documentElement.getBoundingClientRect().width;
      if(w>0&&r>0)return w/r;
    }catch(e){}
    return 1;
  }
  let L=null;
  function relayout(){
    const cw=cv.clientWidth||360,ch=cv.clientHeight||170, box=cv.getBoundingClientRect(), g=(window.devicePixelRatio||1)*frameScale();
    const W=Math.max(1,Math.round((box.width||cw)*g)),H=Math.max(1,Math.round((box.height||ch)*g));
    const u=Math.min(cw/360,ch/170)*W/cw;
    cv.width=W;cv.height=H;
    const p=Math.max(2,Math.round(PITCH*u));
    L={W,H,p,x0:Math.round((W-D.cols*p)/2),y0:Math.round(TOP*u),off:Math.round(p/3)};
  }
  const cx=c=>L.x0+c*L.p+L.off, cy=r=>L.y0+r*L.p+L.off;
  function disc(x,y,r){ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();}

  const shown=v=>!emphasis||v.role===emphasis;
  const base=document.createElement('canvas'), bctx=base.getContext('2d');
  let baseKey=null;
  function drawBase(light){
    const {W,H,p}=L;
    base.width=W;base.height=H;
    bctx.clearRect(0,0,W,H);
    bctx.fillStyle=light?'rgba(60,60,67,0.26)':'rgba(228,228,236,0.26)';
    const dot=(x,y,r)=>{bctx.beginPath();bctx.arc(x,y,r,0,TAU);bctx.fill();};
    /* A circle this small antialiases into a smear in WebKit. Square it on 1x. */
    for(const d of M.all){
      const v=lit.get(M.key(d));
      if(v&&shown(v))continue;
      if(p<=3)bctx.fillRect(L.x0+d[0]*p,L.y0+d[1]*p,p-1,p-1);
      else dot(cx(d[0]),cy(d[1]),p/3);
    }
    for(const [k,v] of lit){
      if(!shown(v))continue;
      const c=k.split(',');
      bctx.fillStyle=rgbCss(v.col);
      dot(cx(+c[0]),cy(+c[1]),v.over?p*0.75:p/2);
    }
    bctx.fillStyle=light?'#FFFFFF':'#1C1C1E';
    for(const pt of points)if(shown(pt))dot(cx(pt.cell[0]),cy(pt.cell[1]),p);
  }

  let t0=performance.now();
  function draw(now){
    if(!L)relayout();
    const {W,H,p}=L, light=theme()==='light';
    if(!baseKey||baseKey.L!==L||baseKey.lit!==lit||baseKey.emphasis!==emphasis||baseKey.light!==light){
      drawBase(light);
      baseKey={L,lit,emphasis,light};
    }
    ctx.clearRect(0,0,W,H);
    ctx.drawImage(base,0,0);
    const pulse=reduce?1:(0.82+0.18*Math.sin((now-t0)/1500));
    for(const pt of points){
      if(!shown(pt))continue;
      ctx.fillStyle=rgbCss(pt.col);
      disc(cx(pt.cell[0]),cy(pt.cell[1]),p*2/3*pulse);
    }
  }
  function redraw(){relayout();kick();if(openFor)placePop(openFor);}

  async function mapFetch(){
    if(!id) throw new Error('no id');
    return fetchData('map');
  }
  // tooltip
  const tt=document.createElement('div');tt.id='tt';
  tt.style.cssText='position:absolute;pointer-events:none;z-index:6;opacity:0;transition:opacity .12s ease;'+
    'min-width:118px;max-width:210px;padding:9px 11px;border-radius:13px;'+
    'background:rgba(30,30,34,.84);'+
    'box-shadow:0 8px 26px rgba(0,0,0,.5);border:.5px solid rgba(255,255,255,.1);'+
    'font-family:-apple-system, BlinkMacSystemFont, system-ui, sans-serif;color:#fff;';
  document.body.appendChild(tt);
  function showTip(info,x0,y0){
    /* info.users comes straight from the upstream response. html`` escapes
       every interpolation. */
    const body=info.cc!=null
      ? html`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px"><span style="font-weight:700;font-size:14px;line-height:1.15;letter-spacing:-.01em">${fmtName(info.cc)}</span><span style="font-weight:600;font-size:11px;color:#30D158;display:inline-flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:#30D158"></span>${wt('ui.online','Online')}</span></div><div style="display:flex;justify-content:space-between;gap:16px;font-weight:500;font-size:12px;line-height:1.2;color:rgba(235,235,245,.62)"><span>${wt('ui.users','Users')}</span><span style="color:#fff;font-weight:600;font-variant-numeric:tabular-nums">${typeof info.users==='number'?formatNumber(info.users):info.users}</span></div>`
      : html`<div style="font-weight:600;font-size:14px;line-height:1.15;letter-spacing:-.01em">${(info.city?info.city+', ':'')+info.country}</div>`;
    setHtml(tt, html`<div style="font-weight:700;font-size:11px;line-height:1.2;display:flex;align-items:center;gap:6px;margin-bottom:5px;color:rgba(235,235,245,.82)"><span data-dot></span>${info.serviceName||''}</div>${body}`);
    /* Colour is set after the markup, through named CSSOM properties. */
    const tdot=tt.querySelector('[data-dot]');
    if(tdot){
      const c=colorOrFallback(info.color,DEFAULT_DOT);
      tdot.style.width='7px';tdot.style.height='7px';tdot.style.borderRadius='50%';
      tdot.style.display='inline-block';
      tdot.style.backgroundColor=c;
      tdot.style.boxShadow='0 0 5px '+c;
    }
    tt.style.opacity='1';
    const z=cssZoom(), pad=8, ww=window.innerWidth/z, wh=window.innerHeight/z, tw=tt.offsetWidth, th=tt.offsetHeight;
    x0/=z;y0/=z;
    let x=x0+13,y=y0+13;
    if(x+tw>ww-pad)x=x0-tw-13;if(x<pad)x=pad;
    if(y+th>wh-pad)y=y0-th-13;if(y<pad)y=pad;
    tt.style.left=x+'px';tt.style.top=y+'px';
  }
  function hideTip(){tt.style.opacity='0';}
  function hitTest(clientX,clientY){
    if(!L)return null;
    const rect=cv.getBoundingClientRect();
    const bx=(clientX-rect.left)*L.W/rect.width, by=(clientY-rect.top)*L.H/rect.height;
    const thr=L.p*1.7;
    let best=null,bd=thr*thr;
    const test=(cell,info)=>{const dx=cx(cell[0])-bx,dy=cy(cell[1])-by,d=dx*dx+dy*dy;if(d<bd){bd=d;best=info;}};
    for(const [k,v] of lit){const c=k.split(',');test([+c[0],+c[1]],v.info);}
    for(const pt of points)test(pt.cell,pt.info);
    return best;
  }
  cv.addEventListener('pointermove',e=>{const i=hitTest(e.clientX,e.clientY);if(i){showTip(i,e.clientX,e.clientY);cv.style.cursor='pointer';}else{hideTip();cv.style.cursor=mapHref?'pointer':'default';}});
  cv.addEventListener('pointerleave',hideTip);
  cv.addEventListener('pointerdown',e=>{const i=hitTest(e.clientX,e.clientY);if(i)showTip(i,e.clientX,e.clientY);else hideTip();});
  let mapHref='';
  const linkEl=document.getElementById('map-link');
  linkEl.setAttribute('aria-label', wt('ui.worldMap','World map of connections'));
  cv.addEventListener('click',e=>{ if(mapHref&&!hitTest(e.clientX,e.clientY)) openUrl(mapHref); });

  new ResizeObserver(redraw).observe(cv);
  /* The frame scale changes with the dashboard window. This page gets no resize. */
  try{
    const host=window.parent!==window?window.parent:null;
    if(host){
      host.addEventListener('resize',redraw);
      window.addEventListener('pagehide',()=>host.removeEventListener('resize',redraw));
    }
  }catch(e){}
  redraw();
  const state = errorState({ root:document.body, content:cv, place:'center' });

  poll({ fetch:mapFetch, interval:60000,
    render:d=>{ state.ok(); mapHref=(d.meta&&d.meta.href)||''; cv.style.cursor=linkTo(linkEl,mapHref)?'pointer':'default'; computeLayers(d); redraw(); },
    isEmpty:d=>!d||!Array.isArray(d.services)||d.services.length===0,
    onEmpty:()=>{ computeLayers({services:[]}); redraw(); state.empty(wt('ui.noData','No data')); },
    onError:({error,everOk,stale,since})=>{ if(!everOk||stale) state.fail(error,{since,inert:everOk}); } });

})();
