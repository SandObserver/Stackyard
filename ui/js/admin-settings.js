/* Admin UI — settings sections.
   General / Appearance / Security settings: loads values into the settings
   screen and persists changes. Exports loadSettings (called on config load)
   and showBgFields (called by the background-type toggle). */
import { state } from '/js/admin-state.js?v=1';
import { toast, ag, ap } from '/js/admin-shared.js?v=2';
import { wirePasswordStrength, pwStrength } from '/js/admin-auth.js?v=1';

export function loadSettings(c){
  const s=c.settings||{};
  const ld=document.getElementById('set-lbl-d');
  const lm=document.getElementById('set-lbl-m');
  if(ld){ld.checked=s.showLabels?.desktop!==false;ld.addEventListener('change',saveLabels);}
  if(lm){lm.checked=s.showLabels?.ios===true;lm.addEventListener('change',saveLabels);}
  const bg=s.background||{type:'unsplash',brightness:0.62};
  const typeEl=document.getElementById('bg-type');
  if(typeEl){
    typeEl.value=bg.type||'unsplash';
    showBgFields(bg.type||'unsplash');
    const btn=document.getElementById('bg-type-btn');
    const labels={'unsplash':'Unsplash','url':'Image URL','color':'Solid color'};
    if(btn){const tn=btn.childNodes[0];if(tn&&tn.nodeType===3)tn.textContent=labels[typeEl.value]||typeEl.value;}
    document.querySelectorAll('#bg-type-list li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.val===typeEl.value)));
  }
  /* Unsplash API key — fetch whether one is configured via dedicated endpoint
     (the key itself is never included in /api/config to avoid exposure) */
  const apiEl=(document.getElementById('bg-apikey-inp')||document.getElementById('bg-apikey'));
  if(apiEl){
    apiEl.placeholder='●●●●●●●●●● (configured)';
    ag('/api/settings/unsplash-key').then(d=>{
      const vEl=document.getElementById('ie-apikey-v');
      if(!d.configured){
        apiEl.placeholder='Paste your Unsplash API key';
        if(vEl)vEl.textContent='Not set';
      }else{
        if(vEl)vEl.textContent='Configured';
      }
    }).catch(()=>{});
  }
  const colEl=document.getElementById('bg-col');if(colEl)colEl.value=bg.collection||'';
  const urlEl=document.getElementById('bg-url');if(urlEl)urlEl.value=bg.url||'';
  const colorEl=document.getElementById('bg-color');if(colorEl)colorEl.value=bg.color||'';
  const brEl=document.getElementById('bg-br');
  const brVal=document.getElementById('bg-br-val');
  function updateSliderFill(el){
    if(!el)return;
    const min=parseFloat(el.min)||0.1, max=parseFloat(el.max)||1.0;
    const pct=((parseFloat(el.value)-min)/(max-min))*100;
    el.style.background=`linear-gradient(to right, var(--ac) 0%, var(--ac) ${pct}%, var(--bd-inner) ${pct}%, var(--bd-inner) 100%)`;
  }
  if(brEl){brEl.value=bg.brightness??0.62;if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);
    updateSliderFill(brEl);
    brEl.addEventListener('input',()=>{updateSliderFill(brEl);if(brVal)brVal.textContent=parseFloat(brEl.value).toFixed(2);});}
  document.getElementById('bg-save').addEventListener('click',saveWallpaper);

  /* Populate General inline-edit value spans (empty → greyed placeholder, no dash) */
  const _sv=(id,v,ph='')=>{const el=document.getElementById(id);if(!el)return;
    if(v){el.textContent=v;el.classList.remove('is-ph');}
    else{el.textContent=ph;el.classList.add('is-ph');}};
  _sv('ie-title-v',s.title||'Stackyard','Stackyard');
  _sv('ie-desc-v',s.description||'Stackyard · self-hosted homelab dashboard','Stackyard · self-hosted homelab dashboard');
  _sv('ie-ip-v',s.server?.hostIp,'192.168.1.100');
  _sv('ie-socket-v',s.server?.socketProxyUrl,'tcp://socket-proxy:2375');
  _sv('ie-pw-v','','Not set'); /* set below after auth check */
  /* Sync hidden input values used by save */
  const _si=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null)el.value=v;};
  _si('srv-ip',s.server?.hostIp||'');
  _si('srv-socket',s.server?.socketProxyUrl||'');
  /* Appearance */
  _sv('ie-bgcol-v',s.background?.collection,'Collection ID');
  _si('bg-col-inp',s.background?.collection||'');
  _si('bg-url-inp',s.background?.url||'');
  _si('bg-color-inp',s.background?.color||'');
  _sv('ie-bgurl-v',s.background?.url,'Image URL');
  _sv('ie-bgcolor-v',s.background?.color,'#rrggbb or any CSS color');

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
    const applyDocker=v=>{
      if(dockerSubEl)dockerSubEl.classList.toggle('open',v);
      if(hideHealthyRowEl)hideHealthyRowEl.style.display=v?'':'none';
      const socketRow=document.getElementById('ie-socket');
      if(socketRow)socketRow.style.display=v?'':'none';
      const socketHint=document.getElementById('socket-hint');
      if(socketHint)socketHint.style.display=v?'':'none';
    };
    applyDocker(dockerEnEl.checked);
    dockerEnEl.addEventListener('change',()=>{
      applyDocker(dockerEnEl.checked);
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
  const secLogout=document.getElementById('sec-logout');
  const syncLogout=()=>{ if(secLogout) secLogout.classList.toggle('d-none', !secEnEl?.checked); };
  secLogout?.addEventListener('click',async()=>{
    await ap('/api/auth/logout',{}).catch(()=>{});
    location.reload();
  });
  if(secEnEl&&secSubEl){
    secEnEl.addEventListener('change',()=>{
      if(secEnEl.checked)openSecSub();
      else secSubEl.classList.remove('open');
      syncLogout();
    });
  }

  /* Load auth state from server and apply */
  ag('/api/auth/check').then(d=>{
    if(secEnEl){
      secEnEl.checked=!!(d.enabled);
      const pwRow=document.getElementById('ie-pw');
      const pwHint=document.getElementById('pw-hint-static');
      if(pwRow)pwRow.style.display=d.enabled?'':'none';
      if(pwHint)pwHint.style.display=d.enabled?'':'none';
    }
    const pwValEl=document.getElementById('ie-pw-v');
    if(pwValEl)pwValEl.textContent=d.passwordSet?'Configured':'Not set';
    syncLogout();
  }).catch(()=>{
    /* Auth check failed — toggle still works, just without pre-loaded state */
  });
}
export function showBgFields(type){
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
      bg.collection=(document.getElementById('bg-col-inp')||document.getElementById('bg-col'))?.value?.trim()||'';
    }
    else if(type==='url'){bg.url=(document.getElementById('bg-url-inp')||document.getElementById('bg-url'))?.value?.trim()||'';}
    else if(type==='color'){bg.color=(document.getElementById('bg-color-inp')||document.getElementById('bg-color'))?.value?.trim()||'';}
    /* Save main config first */
    const c=await ag('/api/config');c.settings=c.settings||{};c.settings.background=bg;
    await ap('/api/config',c);
    /* Save Unsplash key separately AFTER main config — the GET /api/config strips the key,
       so state.saving it before would cause the subsequent config write to overwrite it with nothing */
    if(type==='unsplash'){
      const keyVal=(document.getElementById('bg-apikey-inp')||document.getElementById('bg-apikey'))?.value?.trim()||'';
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
    /* Title / description from inline-edit value spans (committed on blur).
       A greyed placeholder (.is-ph) means empty, so it is not saved. */
    const titleEl=document.getElementById('ie-title-v');
    const descEl=document.getElementById('ie-desc-v');
    const titleV=titleEl&&!titleEl.classList.contains('is-ph')?titleEl.textContent.trim():'';
    const descV=descEl&&!descEl.classList.contains('is-ph')?descEl.textContent.trim():'';
    if(titleV) c.settings.title=titleV;
    if(descV) c.settings.description=descV;
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
    toast('Saved');
  }catch(e){toast('Save failed: '+e.message,'err');}
}
