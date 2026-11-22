import { readableInk, rgbOf, poll, fetchData, linkTo, esc, raw, setHtml, loadStrings, wt, wtCount, formatNumber, errorLine, placeholder, whileOnScreen } from '/js/widget-toolbox.js?v=039ea657';
import { cellsOf, toGrid } from './world-map.js';
await loadStrings();
document.getElementById('wrap').setAttribute('aria-label', wt('ui.vpnStatus', 'VPN status'));
(function(){
  const TAU=6.28318530718;
  const params=new URLSearchParams(location.search);
  const id=params.get('id')||'';
  const size=params.get('size')==='small'?'small':'medium';
  document.body.classList.add('size-'+size);
  const wrap=document.getElementById('wrap');
  let raf=0;
  const GLOW_CYCLE_MS=4084;

  const rgba=(c,a)=>'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';
  const trimOrg=o=>o?String(o).replace(/^AS\d+\s+/i,'').trim():'';

  const I_GLOBE='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.4 2.3 2.4 14.5 0 16.8M12 3.6c-2.4 2.3-2.4 14.5 0 16.8"/></svg>';
  const I_LAYERS='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3.5l8.5 4.3-8.5 4.3L3.5 7.8 12 3.5z"/><path d="M3.7 12.3l8.3 4.2 8.3-4.2"/></svg>';
  const I_PEERS='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.6 19a5.4 5.4 0 0 1 10.8 0"/><path d="M16 6.6a3 3 0 0 1 0 5.8M21 19a5 5 0 0 0-4-4.9"/></svg>';

  function metricRow(icon,label,value,cls){
    return '<div class="metric'+(cls?' '+cls:'')+'"><span class="ic">'+icon+'</span>'+(label?'<span class="lbl">'+esc(label)+'</span>':'')+'<span class="val">'+esc(value)+'</span></div>';
  }

  let cv=null, geoState=null, shown=false;
  whileOnScreen(wrap,v=>{shown=v;document.getElementById('glow')?.classList.toggle('off',!v);if(v&&geoState)paintSoon();});
  addEventListener('resize',()=>{if(geoState)paintSoon();});
  const base=document.createElement('canvas');
  let baseFor=null, geo=null;
  function drawBase(W,H){
    const {list,color,connected}=geoState;
    base.width=W;base.height=H;
    const bctx=base.getContext('2d');
    bctx.clearRect(0,0,W,H);
    let minC=1e9,maxC=-1e9,minR=1e9,maxR=-1e9;
    list.forEach(d=>{if(d[0]<minC)minC=d[0];if(d[0]>maxC)maxC=d[0];if(d[1]<minR)minR=d[1];if(d[1]>maxR)maxR=d[1];});
    const gw=(maxC-minC)+1, gh=(maxR-minR)+1, pad=W*0.05;
    const cell=Math.min((W-2*pad)/gw,(H-2*pad)/gh);
    const drawW=gw*cell, drawH=gh*cell;
    const ox=(W-drawW)/2-minC*cell, oy=(H-drawH)/2-minR*cell;
    const r=Math.max(1.6,cell*0.42);
    for(let i=0;i<list.length;i++){
      const d=list[i], x=ox+(d[0]+0.5)*cell, y=oy+(d[1]+0.5)*cell;
      const seed=(d[0]*73856093 ^ d[1]*19349663)>>>0;
      const rv=r*(0.84+((seed>>16&255)/255)*0.34);
      bctx.beginPath();bctx.arc(x,y,rv,0,TAU);
      bctx.fillStyle=connected?rgba(color,0.58+((seed>>4&15)/15)*0.22):'rgba(150,150,158,'+(0.5+((seed>>4&15)/15)*0.2)+')';
      bctx.fill();
    }
    geo={ox,oy,cell,r};
  }
  function paintGeo(){
    raf=0;
    if(!cv||!geoState) return;
    const ctx=cv.getContext('2d');
    const cw=cv.clientWidth||120, ch=cv.clientHeight||120, RES=3;
    if(cv.width!==cw*RES){cv.width=cw*RES;cv.height=ch*RES;}
    const W=cv.width,H=cv.height;
    ctx.clearRect(0,0,W,H);
    const {list,color,connected,city}=geoState;
    if(!list||!list.length) return;
    if(baseFor!==geoState||base.width!==W||base.height!==H){drawBase(W,H);baseFor=geoState;}
    ctx.drawImage(base,0,0);
    const glow=document.getElementById('glow'), pin=document.getElementById('pin');
    pin.width=W;pin.height=H;
    glow.hidden=!(connected&&city);
    if(connected&&city){
      const {ox,oy,cell,r}=geo;
      const [col,row]=toGrid(city[1],city[0]);
      const x=ox+(col+0.5)*cell, y=oy+(row+0.5)*cell;
      const size=2*r*5/RES;
      Object.assign(glow.style,{left:x/RES-size/2+'px',top:y/RES-size/2+'px',width:size+'px',height:size+'px',
        background:'radial-gradient(closest-side,'+rgba(color,0.65)+','+rgba(color,0)+')',
        animationDelay:-(performance.now()%GLOW_CYCLE_MS)+'ms'});
      glow.classList.toggle('off',!shown);
      const pctx=pin.getContext('2d');
      pctx.beginPath();pctx.arc(x,y,r*1.5,0,TAU);pctx.fillStyle='#fff';pctx.fill();
      pctx.beginPath();pctx.arc(x,y,r*1.5,0,TAU);pctx.strokeStyle=rgba(color,0.9);pctx.lineWidth=r*0.5;pctx.stroke();
    }
  }
  function paintSoon(){if(!raf)raf=requestAnimationFrame(paintGeo);}

  function render(d){
    if(raf)cancelAnimationFrame(raf),raf=0;
    const isErr=!!d.error&&!d.connected, on=!!d.connected, svc=d.service||'gluetun';
    const color=rgbOf(d.color)||rgbOf(on?'#30D158':'#8E8E93');
    document.documentElement.style.setProperty('--accent', rgba(color,1));
    document.documentElement.style.setProperty('--accentink', readableInk('#'+color.map(v=>v.toString(16).padStart(2,'0')).join('')));
    document.documentElement.style.setProperty('--accentglow', rgba(color,.8));

    /* Never draw d.error. It names hosts and status codes. */
    const errLine=isErr?errorLine({ kind:d.errorKind }):'';

    let stateCls,stateTxt;
    if(isErr){stateCls='err';stateTxt=wt('ui.unavailable','Unavailable');}
    else if(on){stateCls='on';stateTxt=svc==='netbird'?wt('ui.connected','Connected'):wt('ui.secured','Secured');}
    else{stateCls='off';stateTxt=svc==='netbird'?wt('ui.disconnected','Disconnected'):wt('ui.notSecured','Not secured');}

    const name=(d.name&&d.name.trim())||(svc==='netbird'?wt('ui.mesh','Mesh'):'VPN');
    const cc=(d.countryCode||'').toUpperCase();
    let place;
    if(svc==='netbird'){
      place=isErr?errLine:d.peersConnected!=null?(d.peersTotal
        ?wtCount('ui.peerRatio',d.peersTotal,{one:'{connected} / {count} peer',other:'{connected} / {count} peers'},{connected:formatNumber(d.peersConnected)})
        :wtCount('ui.peerCount',d.peersConnected,{one:'{count} peer',other:'{count} peers'})):(d.hostname||wt('ui.mesh','Mesh'));
    }else{
      const city=d.city||'',country=d.country||'';
      place=isErr?errLine:(city&&country?city+', '+country:(city||country||(on?wt('ui.connected','Connected'):'\u2014')));
    }

    let metrics='';
    if(isErr){}
    else if(svc==='netbird'){
      metrics+=metricRow(I_PEERS,wt('ui.peersLabel','Peers'),(d.peersConnected!=null?wtCount('ui.peersOnline',d.peersConnected,{one:'{count} online',other:'{count} online'}):'\u2014'));
      if(d.hostname) metrics+=metricRow(I_LAYERS,'',d.hostname);
    }else{
      if(d.ip) metrics+=metricRow(I_GLOBE,'IP',d.ip);
      const org=trimOrg(d.org);
      if(org) metrics+=metricRow(I_LAYERS,'',org);
    }

    setHtml(wrap,raw(
      '<div class="pad"><div class="info">'+
        '<div class="eyebrow"><span class="vpn-tag">'+esc(name).toUpperCase()+'</span>'+
          '<span class="state '+stateCls+'"><span class="dot"></span>'+esc(stateTxt)+'</span></div>'+
        '<div class="hero"><span class="place">'+esc(place)+'</span></div>'+
        (metrics?'<div class="metrics">'+metrics+'</div>':'')+
      '</div><div class="geo"><canvas id="map"></canvas><div class="glow" id="glow" hidden></div><canvas id="pin"></canvas></div></div>'));

    cv=document.getElementById('map');
    const list=cellsOf(cc);
    const city=(on&&isFinite(d.lat)&&isFinite(d.lng))?[d.lat,d.lng]:null;
    geoState=list.length?{list,color,connected:on,city}:null;
    if(geoState) paintSoon();

    const aria=(name+': '+stateTxt+(on&&place&&place!=='\u2014'?(', '+place):'')+(d.ip?(', IP '+d.ip):''));
    wrap.setAttribute('aria-label',aria);
  }

  function renderPlaceholder(){
    const small=size==='small';
    const pad=document.createElement('div'); pad.className='pad';
    const info=document.createElement('div'); info.className='info';
    const eyebrow=document.createElement('div'); eyebrow.className='eyebrow';
    eyebrow.append(placeholder(30,9),placeholder(48,9));
    const hero=document.createElement('div'); hero.className='hero';
    hero.append(placeholder(small?96:130,small?12:18));
    info.append(eyebrow,hero);
    if(!small){
      const metrics=document.createElement('div'); metrics.className='metrics';
      metrics.append(placeholder(104,10),placeholder(78,10));
      info.append(metrics);
    }
    const geo=document.createElement('div'); geo.className='geo';
    geo.style.display='flex'; geo.style.alignItems='center'; geo.style.justifyContent='center';
    geo.append(placeholder(small?64:96,small?44:64,12));
    pad.append(info,geo);
    wrap.replaceChildren(pad);
  }
  renderPlaceholder();

  async function vfetch(){
    if(!id) throw new Error('fetch failed');
    return fetchData('vpn');
  }
  poll({ fetch:vfetch, interval:30000,
    render:d=>{ render(d); linkTo(wrap,d.href||''); },
    onError:({error,everOk,stale})=>{
      if(!everOk||stale) render({error:true,errorKind:error&&error.kind,connected:false});
    } });
})();
