/* Admin UI: the General, Appearance and Security settings sections. */
import { toast, ag, ap } from '/js/admin-shared.js?v=182410cc';
import { wirePasswordStrength } from '/js/admin-auth.js?v=dd849d4c';
import { pwStrength } from '/js/password-strength.js?v=dab9978e';
import { t } from '/js/i18n.js?v=133a7aac';
import { authEnableBlocked } from '/js/admin-logic.js?v=056a11e9';
import { el, inp, q, qa } from '/js/utils.js?v=17424946';

/* Mirrors the server's rule: auth cannot be switched on with no password behind
   it. */
let _passwordSet=false;

export function loadSettings(c){
  const s=c.settings||{};
  const ld=inp('set-lbl-d');
  const lm=inp('set-lbl-m');
  if(ld){ld.checked=s.showLabels?.desktop!==false;ld.addEventListener('change',saveLabels);}
  if(lm){lm.checked=s.showLabels?.ios===true;lm.addEventListener('change',saveLabels);}
  const bg=s.background||{type:'unsplash',brightness:0.62};
  const typeEl=inp('bg-type');
  if(typeEl){
    typeEl.value=bg.type||'unsplash';
    showBgFields(bg.type||'unsplash');
    const btn=el('bg-type-btn');
    const labels={'unsplash':'Unsplash','url':'Image URL','color':'Solid color'};
    if(btn){const tn=btn.childNodes[0];if(tn&&tn.nodeType===3)tn.textContent=labels[typeEl.value]||typeEl.value;}
    qa('#bg-type-list li', document).forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===typeEl.value)));
  }
  const llEl=inp('log-level');
  if(llEl){
    llEl.value=s.logLevel||'info';
    const llBtn=el('log-level-btn');
    const llLabels={debug:'Debug',info:'Info',error:'Errors'};
    if(llBtn){const tn=llBtn.childNodes[0];if(tn&&tn.nodeType===3)tn.textContent=llLabels[llEl.value]||llEl.value;}
    qa('#log-level-list li', document).forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===llEl.value)));
  }
  const langEl=inp('lang-sel');
  if(langEl){
    langEl.value=s.language||'en';
    const laBtn=el('lang-btn');
    const laLi=q(`#lang-list li[data-val="${langEl.value}"]`);
    if(laBtn){const tn=laBtn.childNodes[0];if(tn&&tn.nodeType===3)tn.textContent=(laLi?laLi.textContent:langEl.value);}
    qa('#lang-list li', document).forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===langEl.value)));
  }
  /* Unsplash API key: fetch whether one is configured via dedicated endpoint
     (the key itself is never included in /api/config to avoid exposure) */
  const apiEl=(inp('bg-apikey-inp')||inp('bg-apikey'));
  if(apiEl){
    apiEl.placeholder='●●●●●●●●●● (configured)';
    ag('/api/settings/unsplash-key').then(d=>{
      const vEl=el('ie-apikey-v');
      if(!d.configured){
        apiEl.placeholder='Paste your Unsplash API key';
        if(vEl)vEl.textContent='Not set';
      }else{
        if(vEl)vEl.textContent='Configured';
      }
    }).catch(()=>{});
  }
  const colEl=inp('bg-col');if(colEl)colEl.value=bg.collection||'';
  const urlEl=inp('bg-url');if(urlEl)urlEl.value=bg.url||'';
  const colorEl=inp('bg-color');if(colorEl)colorEl.value=bg.color||'';
  const brEl=inp('bg-br');
  const brVal=el('bg-br-val');
  function updateSliderFill(el){
    if(!el)return;
    const min=parseFloat(el.min)||0.1, max=parseFloat(el.max)||1.0;
    const pct=((parseFloat(el.value)-min)/(max-min))*100;
    el.style.background=`linear-gradient(to right, var(--ac) 0%, var(--ac) ${pct}%, var(--bd-inner) ${pct}%, var(--bd-inner) 100%)`;
  }
  if(brEl){brEl.value=bg.brightness??0.62;if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);
    updateSliderFill(brEl);
    brEl.addEventListener('input',()=>{updateSliderFill(brEl);if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);});}
  el('bg-save').addEventListener('click',saveWallpaper);

  const _sv=(id,v,ph='')=>{const node=el(id);if(!node)return;
    if(v){node.textContent=v;node.classList.remove('is-ph');}
    else{node.textContent=ph;node.classList.add('is-ph');}};
  _sv('ie-title-v',s.title||'Stackyard','Stackyard');
  _sv('ie-desc-v',s.description||'Stackyard · self-hosted homelab dashboard','Stackyard · self-hosted homelab dashboard');
  _sv('ie-ip-v',s.server?.hostIp,'192.168.1.100');
  _sv('ie-socket-v',s.server?.socketProxyUrl,'tcp://socket-proxy:2375');
  _sv('ie-pw-v','','Not set'); /* set below after auth check */
  const _si=(id,v)=>{const node=inp(id);if(node&&v!=null)node.value=v;};
  _si('srv-ip',s.server?.hostIp||'');
  _si('srv-socket',s.server?.socketProxyUrl||'');
  _sv('ie-bgcol-v',s.background?.collection,'Collection ID');
  _si('bg-col-inp',s.background?.collection||'');
  _si('bg-url-inp',s.background?.url||'');
  _si('bg-color-inp',s.background?.color||'');
  _sv('ie-bgurl-v',s.background?.url,'Image URL');
  _sv('ie-bgcolor-v',s.background?.color,'#rrggbb or any CSS color');

  const ipEl=inp('srv-ip');if(ipEl)ipEl.value=s.server?.hostIp||'';
  const dockerEnEl=inp('srv-docker-en');
  const dockerSubEl=el('srv-docker-sub');
  const socketEl=inp('srv-socket');
  const hideHealthyRowEl=el('srv-hide-healthy-row');
  const hideHealthyEl=inp('srv-hide-healthy');
  if(dockerEnEl){
    dockerEnEl.checked=!!(s.server?.socketProxyUrl);
    const applyDocker=v=>{
      if(dockerSubEl)dockerSubEl.classList.toggle('open',v);
      if(hideHealthyRowEl)hideHealthyRowEl.style.display=v?'':'none';
      const socketRow=el('ie-socket');
      if(socketRow)socketRow.style.display=v?'':'none';
      const socketHint=el('socket-hint');
      if(socketHint)socketHint.style.display=v?'':'none';
    };
    applyDocker(dockerEnEl.checked);
    dockerEnEl.addEventListener('change',()=>applyDocker(dockerEnEl.checked));
  }
  if(hideHealthyEl)hideHealthyEl.checked=s.server?.hideHealthyBadge!==false;
  if(socketEl)socketEl.value=s.server?.socketProxyUrl||'';
  el('srv-save').addEventListener('click',saveServer);

  const secEnEl=inp('sec-en');
  const secSubEl=el('sec-sub');
  const secPwEl=el('sec-pw');
  let pwStrengthWired=false;
  function openSecSub(){
    secSubEl.classList.add('open');
    /* Wire strength meter on first open, avoids Safari input event bug
       where listeners on password fields in hidden containers don't fire */
    if(!pwStrengthWired&&secPwEl){
      pwStrengthWired=true;
      wirePasswordStrength('sec-pw','sec-pw-bars','sec-pw-hint');
    }
  }
  const secLogout=el('sec-logout');
  const secRevoke=inp('sec-revoke');
  const secRevokeRow=el('sec-revoke-row');
  const revokeTip=el('revoke-tip');
  /* Both controls only mean anything while auth is on; the revoke one also needs
     a password to exist, since that is what makes a session possible. */
  const syncLogout=()=>{
    const on=!!secEnEl?.checked;
    if(secLogout) secLogout.classList.toggle('d-none', !on);
    const canRevoke=on&&_passwordSet;
    if(secRevokeRow) secRevokeRow.style.display=canRevoke?'':'none';
    if(revokeTip) revokeTip.style.display=canRevoke?'':'none';
  };
  secLogout?.addEventListener('click',async()=>{
    await ap('/api/auth/logout',{}).catch(()=>{});
    location.reload();
  });
  secRevoke?.addEventListener('click',async()=>{
    if(!confirm(t('confirm.revokeSessions'))) return;
    secRevoke.disabled=true;
    try{
      /* The server reissues this browser's cookie in the same response, so the
         page stays signed in while every other device does not. */
      await ap('/api/auth/revoke-sessions',{});
      toast(t('toast.sessionsRevoked'),'ok');
    }catch(e){
      toast(e.message||t('toast.saveFailed'),'err');
    }finally{
      secRevoke.disabled=false;
    }
  });
  if(secEnEl&&secSubEl){
    secEnEl.addEventListener('change',()=>{
      if(secEnEl.checked)openSecSub();
      else secSubEl.classList.remove('open');
      syncLogout();
    });
  }

  ag('/api/auth/check').then(d=>{
    _passwordSet=!!d.passwordSet;
    if(secEnEl){
      /* The effective state: enabled with no password behaves as off, and the
         toggle has to match what the server does. */
      secEnEl.checked=!!(d.enabled);
      const pwRow=el('ie-pw');
      const pwHint=el('pw-hint-static');
      if(pwRow)pwRow.style.display=d.enabled?'':'none';
      if(pwHint)pwHint.style.display=d.enabled?'':'none';
    }
    const pwValEl=el('ie-pw-v');
    if(pwValEl)pwValEl.textContent=d.passwordSet?'Configured':'Not set';
    syncLogout();
  }).catch(()=>{
  });
}
export function showBgFields(type){
  ['unsplash','url','color'].forEach(t=>{
    const node=el(`bg-${t}-fields`);
    if(node)node.classList.toggle('d-none', t!==type);
  });
  /* Brightness dims a wallpaper image, meaningless for a solid colour,
     so it's shown only for the unsplash/url sources. */
  const brRow=el('bg-brightness-row');
  if(brRow)brRow.classList.toggle('d-none', type==='color');
}
async function saveLabels(){
  const c=await ag('/api/config');c.settings=c.settings||{};
  c.settings.showLabels={desktop:inp('set-lbl-d')?.checked!==false,ios:inp('set-lbl-m')?.checked||false};
  await ap('/api/config',c);toast(t('toast.saved'));
}
async function saveWallpaper(){
  try{
    const type=inp('bg-type')?.value||'unsplash';
    const br=parseFloat(inp('bg-br')?.value||'0.62');
    const bg={type,brightness:br};
    if(type==='unsplash'){
      bg.collection=(inp('bg-col-inp')||inp('bg-col'))?.value?.trim()||'';
    }
    else if(type==='url'){bg.url=(inp('bg-url-inp')||inp('bg-url'))?.value?.trim()||'';}
    else if(type==='color'){bg.color=(inp('bg-color-inp')||inp('bg-color'))?.value?.trim()||'';}
    const c=await ag('/api/config');c.settings=c.settings||{};c.settings.background=bg;
    await ap('/api/config',c);
    /* Save Unsplash key separately AFTER main config; the GET /api/config strips the key,
       so state.saving it before would cause the subsequent config write to overwrite it with nothing */
    if(type==='unsplash'){
      const keyVal=(inp('bg-apikey-inp')||inp('bg-apikey'))?.value?.trim()||'';
      if(keyVal) await ap('/api/settings/unsplash-key',{apiKey:keyVal});
    }
    toast(t('toast.wallpaperSaved'));
  }catch(e){toast(t('toast.saveFailed',{err:e.message}),'err');}
}
async function saveServer(){
  try{
    const c=await ag('/api/config');c.settings=c.settings||{};
    const prevLang=c.settings.language||'en';
    const dockerEnabled=inp('srv-docker-en')?.checked||false;
    const socketUrl=inp('srv-socket')?.value?.trim()||'';
    /* Title / description from inline-edit value spans (committed on blur).
       A greyed placeholder (.is-ph) means empty, so it is not saved. */
    const titleEl=el('ie-title-v');
    const descEl=el('ie-desc-v');
    const titleV=titleEl&&!titleEl.classList.contains('is-ph')?titleEl.textContent.trim():'';
    const descV=descEl&&!descEl.classList.contains('is-ph')?descEl.textContent.trim():'';
    if(titleV) c.settings.title=titleV;
    if(descV) c.settings.description=descV;
    c.settings.server={
      ...c.settings.server,
      hostIp:inp('srv-ip')?.value?.trim()||'',
      socketProxyUrl:dockerEnabled?socketUrl:'',
      hideHealthyBadge:inp('srv-hide-healthy')?.checked!==false,
    };
    c.settings.logLevel=inp('log-level')?.value||'info';
    c.settings.language=inp('lang-sel')?.value||'en';
    const langChanged=c.settings.language!==prevLang;
    await ap('/api/config',c);

    const pw=inp('sec-pw')?.value||'';
    const enabled=inp('sec-en')?.checked||false;
    if(authEnableBlocked({enabled,passwordSet:_passwordSet,newPassword:pw})){
      toast(t('toast.authNeedsPassword'),'err');
      return;
    }
    if(pw){
      const {ok,labelKey}=pwStrength(pw);
      if(!ok){toast(t('toast.pwWeak',{label:t(labelKey)}),'err');return;}
      await ap('/api/auth/set-password',{password:pw});
      _passwordSet=true;
      const pwEl=inp('sec-pw');
      if(pwEl){pwEl.value='';pwEl.placeholder='●●●●●●●●●● (configured)';}
    }
    await ap('/api/auth/toggle',{enabled});
    toast(t('toast.saved'));
    if(langChanged) location.reload();
  }catch(e){toast(t('toast.saveFailed',{err:e.message}),'err');}
}
