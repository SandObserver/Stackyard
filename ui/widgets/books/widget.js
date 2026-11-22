  import { poll, getConfig, linkTo, loadStrings, wt, formatNumber, errorState, placeholder, toneForColor } from '/js/widget-toolbox.js?v=039ea657';
  await loadStrings();
  document.getElementById('card').setAttribute('aria-label', wt('widget.label', 'Books'));
  const params=new URLSearchParams(location.search);
  const SIZES={small:{shelves:1,show:8},medium:{shelves:1,show:16},large:{shelves:3,show:16}};
  const size=Object.hasOwn(SIZES,params.get('size'))?params.get('size'):'small';
  const {shelves:SHELVES,show:SHOW}=SIZES[size];
  const POLL_MS=300000;
  const PALETTE=['#E7E0D2','#3D5A80','#A8483E','#C9BBA0','#5C6B57','#8D99A6','#2E3340','#B58B52','#7B5E57','#4E6E6A'];
  const SRC={recently:['ui.srcRecently','Recently Added'],unread:['ui.srcUnread','On Deck'],list:['ui.reading','Reading']};
  /* The reader's own name for the shelf, then the service's, then the generic
     word for what the shelf holds. */
  function shelfName(sh){
    if(sh&&sh.name) return sh.name;
    const src=sh&&sh.source;
    const [key,en]=Object.hasOwn(SRC,src)?SRC[src]:SRC.list;
    return wt(key,en);
  }

  const card=document.getElementById('card'), lbl=document.getElementById('lbl');
  const host=document.getElementById('shelves');
  const tpl=host.firstElementChild;
  card.classList.add('size-'+size);
  const bays=[];
  for(let i=0;i<SHELVES;i++){
    const w=i===0?tpl:tpl.cloneNode(true);
    if(i>0){ w.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id')); host.appendChild(w); }
    bays.push({ shelf:w.querySelector('.shelf'), list:w.querySelector('.books'), lbl:w.querySelector('.shelf-lbl') });
  }
  const fT=document.getElementById('f-t'), fA=document.getElementById('f-a'), fBar=document.getElementById('f-bar'),
    fFill=document.getElementById('f-fill'), fP=document.getElementById('f-p'), sr=document.getElementById('sr');
  let href='';
  let resting=null, reading=null;

  function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function spineInk(color){ return toneForColor(color)==='dark'?'#000':'#fff'; }
  function inProgress(b){ return !b.finished && b.progress!=null && b.progress>0 && b.progress<1; }
  function progressText(b){
    if(b.finished) return [wt('ui.finished','Finished'),'done'];
    if(b.progress!=null) return [wt('ui.percentRead','{pct}% read',{pct:formatNumber(Math.round(b.progress*100))}),'reading'];
    return [wt('ui.unread','Unread'),'none'];
  }
  function describe(b){
    const [ptxt]=progressText(b);
    const title=b.title||wt('ui.untitled','Untitled');
    return b.author
      ?wt('ui.describeAuthor','{title} by {author}, {progress}',{title,author:b.author,progress:ptxt})
      :wt('ui.describe','{title}, {progress}',{title,progress:ptxt});
  }
  function paintFoot(b){
    fT.textContent=b?(b.title||wt('ui.untitled','Untitled')):'';
    fA.textContent=b?(b.author||''):'';
    const [txt,cls]=b?progressText(b):['',''];
    fP.textContent=txt; fP.className='p'+(cls==='done'?' done':'');
    fBar.hidden=!(b&&inProgress(b));
    if(b&&inProgress(b)) fFill.style.width=Math.round(b.progress*100)+'%';
  }

  function render(books,list,shelf){
    list.replaceChildren();
    list.removeAttribute('aria-hidden');
    list.classList.remove('sparse','pointing');
    shelf.querySelectorAll('.empty').forEach(n=>n.remove());
    /* Removing the bullets drops the list semantics in one engine, so the role
       is declared even on a real list. It is set only while there are rows: an
       empty list that declares the role reports as missing its children. */
    list.removeAttribute('role');
    if(!books.length){ const e=document.createElement('div'); e.className='empty'; e.textContent=wt('ui.noBooks','No books'); shelf.appendChild(e); return; }
    list.setAttribute('role','list');
    /* A hidden frame measures zero. Show every book rather than one. */
    const cw=list.clientWidth, room=cw>0?cw-4:Infinity;
    const shown=[]; let used=0;
    for(const b of books){
      const w=b._w+(shown.length?2:0);
      if(shown.length&&used+w>room) break;
      used+=w; shown.push(b);
    }
    const sparse=shown.length>1&&used<room*2/3;
    list.classList.toggle('sparse',sparse);
    shown.forEach((b,i)=>{
      const el=document.createElement('li');
      el.className='bk'+(b===reading?' current':'')+(b.finished?' done':'')+(sparse&&i===shown.length-1?' lean':'');
      el.style.width=b._w+'px'; el.style.height=b._h+'%'; el.style.backgroundColor=b._color;
      el.style.color=spineInk(b._color);
      if(b===reading){ const rb=document.createElement('span'); rb.className='ribbon'; el.appendChild(rb); }
      const sp=document.createElement('span'); sp.className='spine'; sp.textContent=b.title||''; el.appendChild(sp);
      if(b.finished){ const f=document.createElement('span'); f.className='fin'; el.appendChild(f); }
      el.tabIndex=0;
      el.setAttribute('aria-label',describe(b));
      const on=e=>{ el.classList.add('up'); list.classList.add('pointing'); paintFoot(b); if(e.type==='mouseenter') sr.textContent=describe(b); };
      const off=()=>{ el.classList.remove('up'); list.classList.remove('pointing'); paintFoot(resting); };
      el.addEventListener('mouseenter',on); el.addEventListener('mouseleave',off);
      el.addEventListener('focus',on); el.addEventListener('blur',off);
      list.appendChild(el);
    });
  }

  function decorate(books){
    return books.map((b,i)=>{
      const title=b.title||'';
      const h=hash(title+'|'+i);
      return Object.assign({}, b, {
        _w: Math.max(14,Math.min(19,12+Math.round(title.length*.35)))+(h%2),
        _h: SHELVES>1 ? 90 + (h % 10) : 72 + (h % 24),
        _color: b.color || PALETTE[(h>>>4) % PALETTE.length],
      });
    });
  }

  function paintPlaceholders(){
    lbl.replaceChildren(placeholder(72,9));
    for(const bay of bays){
      const n=Math.min(SHOW,Math.max(5,Math.floor((bay.list.clientWidth||140)/18)));
      bay.list.setAttribute('aria-hidden','true');
      bay.list.replaceChildren(...Array.from({length:n},(_,i)=>{
        const ph=placeholder(14+(i*7)%5,0,1.5);
        ph.style.height=(62+(i*37)%32)+'%';
        ph.style.borderRadius='1.5px 1.5px 0 0';
        return ph;
      }));
    }
    fT.replaceChildren(placeholder(90,10));
    fP.replaceChildren(placeholder(36,10));
  }

  async function boot(){
    paintPlaceholders();
    const c=await getConfig().catch(()=>null);
    href=c?.widgetConfig?.href||'';
    const link=document.getElementById('bk-link');
    const setLink=d=>{ if(linkTo(link,(d&&d.link)||href)) link.setAttribute('aria-label', wt('widget.label','Books')); };
    setLink(null);
    const state = errorState({ root:card, content:document.getElementById('shelves'),
      caption:document.getElementById('cap') });

    let shownData=null;
    const paintShelves=d=>{
      const shelves=Array.isArray(d.shelves)?d.shelves:[];
      lbl.textContent=SHELVES>1?wt('widget.label','Books'):shelfName(shelves[0]);
      const rows=bays.map((_,i)=>{ const sh=shelves[i]||{books:[]}; return decorate((Array.isArray(sh.books)?sh.books:[]).slice(0,SHOW)); });
      const all=rows.flat();
      reading=all.find(inProgress)||null;
      resting=reading||all[0]||null;
      bays.forEach((bay,i)=>{
        bay.lbl.hidden=SHELVES<2;
        bay.lbl.textContent=shelfName(shelves[i]||{books:[]});
        render(rows[i],bay.list,bay.shelf);
      });
      paintFoot(resting);
    };
    addEventListener('resize',()=>{ if(shownData) paintShelves(shownData); });

    poll({ interval:POLL_MS,
      isEmpty:d=>(Array.isArray(d&&d.shelves)?d.shelves:[]).every(sh=>!(sh&&Array.isArray(sh.books)&&sh.books.length)),
      onEmpty:d=>{
        shownData=null;
        lbl.textContent=SHELVES>1?wt('widget.label','Books'):shelfName((d&&d.shelves||[])[0]);
        for(const bay of bays){ bay.list.replaceChildren(); bay.list.removeAttribute('aria-hidden'); }
        paintFoot(null); state.empty(wt('ui.noBooks','No books'));
      },
      onError:({error,everOk,stale,since})=>{ if(!everOk||stale) state.fail(error,{since,inert:everOk}); },
      render:d=>{
      state.ok();
      setLink(d);
      shownData=d;
      paintShelves(d);
    } });
  }
  boot();
