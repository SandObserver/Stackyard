/* Admin UI: the app and folder edit forms. Reads and writes shared state. */
import { clr as rc, el, inp as inpById, q as qSel, qa, qi, tgt } from '/js/utils.js?v=84d58686';
import { html, raw, setHtml } from '/js/html.js?v=ccec347c';
import { loadLocalIcons, resolveIcon, iconChain, cdnIconName } from '/js/icons.js?v=a0ea3e4b';
import { state } from '/js/admin-state.js?v=3f9ad806';
import { isDockBlocked, DOCK_MAX, clearsStoredSecret } from '/js/admin-logic.js?v=056a11e9';
import { t } from '/js/i18n.js?v=133a7aac';
import {
  toast,
  ag,
  ap,
  PE_SVG,
  CHEV_SVG,
  initInlineEdit,
  setTogDisabled,
  wireChecklist,
} from '/js/admin-shared.js?v=bb36dbb3';
import { renderColorControl, BADGE_SWATCHES } from '/js/admin-color-control.js?v=601fe763';
import { badgeErrorAdvice, TONE } from '/js/admin-error.js?v=af729113';

/* Folder form: settings-row system (PSD: add_new_folder).
   Folder Name = inline-edit row; Add Apps = tap-to-toggle checklist dropdown. */
export function buildFolderForm(body, item) {
  const children = item?.children || [];
  const apps = state.items.filter(i => i.type === 'app' && !i.dock);
  children.forEach(cid => {
    if (!apps.some(a => a.id === cid)) {
      const a = state.items.find(i => i.id === cid);
      if (a) apps.push(a);
    }
  });

  const opts = apps.length
    ? apps.map(
        a =>
          html`<li role="option" data-val="${a.id}" aria-selected="${children.includes(a.id) ? 'true' : 'false'}">${a.label || a.id}</li>`,
      )
    : html`<li class="row-dd-empty" aria-disabled="true">${t('folder.noApps')}</li>`;

  setHtml(
    body,
    html`
    <div class="grp">
      <div class="row ie-row" id="ie-fname">
        <span class="rl">${t('folder.name')}</span>
        <span class="rv${item?.label ? '' : ' is-ph'}">${item?.label || t('folder.namePh')}</span>
        <input id="f-fname" type="text" value="${item?.label || ''}" style="display:none">
        <button class="pe" type="button" aria-label="Edit folder name">${raw(PE_SVG)}</button>
      </div>
      <div class="row">
        <span class="rl">${t('folder.addApps')}</span>
        <div class="row-dd" id="folder-apps-dd">
          <button class="row-dd-btn" id="folder-apps-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="folder-apps-label">${t('folder.selectApps')}</span>
            ${raw(CHEV_SVG)}
          </button>
          <ul class="row-dd-list checklist" id="folder-apps-list" role="listbox" aria-multiselectable="true" aria-label="Apps in this folder" hidden>${opts}</ul>
        </div>
      </div>
    </div>
    <p class="grp-tip">${t('folder.tip')}</p>`,
  );

  initInlineEdit('ie-fname', 'f-fname', { placeholder: t('folder.namePh') });
  _wireFolderApps();
}

function _wireFolderApps() {
  const dd = el('folder-apps-dd');
  const btn = inpById('folder-apps-btn');
  const list = el('folder-apps-list');
  const label = el('folder-apps-label');
  if (!dd || !btn || !list || !label) return;
  const sync = () => {
    const sel = qa('li[aria-selected="true"]', list);
    label.textContent =
      sel.length === 0 ? t('folder.selectApps') : sel.length === 1 ? sel[0].textContent : sel.length + ' selected';
  };
  wireChecklist(dd, btn, list, li => {
    li.setAttribute('aria-selected', li.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
    sync();
  });
  sync();
}

export function buildAppForm(body, item) {
  const dockBlocked = isDockBlocked(state.items, item);
  /* Per-app health checks only run when the global Docker toggle in General is on. */
  const globalHealthOn = !!inpById('srv-docker-en')?.checked;
  const mon = item?.monitoring || {};
  const hc = mon.healthcheck || {
    enabled: !!(item?.container || item?.ping),
    container: item?.container || '',
    pingUrl: item?.ping || '',
  };
  const act = mon.activity || {
    enabled: !!item?.badge?.enabled,
    url: item?.badge?.url || '',
    interval: item?.badge?.interval || 30,
  };
  const actCustom = mon.activity?.custom || {};
  const staticBadge = mon.staticBadge || {};
  const hasStatic = !!staticBadge.enabled;
  const isPing = !!hc.pingUrl;
  const skipTls = !!item?.skipTlsVerify;

  const ier = (rowId, label, inpId, val, ph, type = 'text') => {
    const has = val != null && val !== '';
    return html`<div class="row ie-row" id="${rowId}"><span class="rl">${label}</span><span class="rv${has ? '' : ' is-ph'}">${has ? val : ph}</span><input id="${inpId}" type="${type}" value="${val || ''}" style="display:none"><button class="pe" type="button" aria-label="Edit ${label}">${raw(PE_SVG)}</button></div>`;
  };
  /* The interval input sits inside the sentence, so the string is split around
     its placeholder rather than concatenated: word order differs per language,
     and in Persian the number comes before the unit with the whole line running
     right to left. */
  const [pollBefore, pollAfter] = t('app.pollInterval').split('{seconds}');

  const tog = (id, on) =>
    html`<label class="tog"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><div class="tr"></div></label>`;

  setHtml(
    body,
    html`
    <div class="grp">
      ${ier('ie-name', t('app.name'), 'f-lbl', item?.label, t('app.namePh'))}
      ${ier('ie-url', t('app.url'), 'f-href', item?.href, t('app.urlPh'), 'url')}
    </div>

    <p class="grp-hdr">${t('app.icon')}</p>
    <div class="grp" id="ipw">
      <div class="row icon-src-row">
        <span class="icon-prev" id="ipv" style="background:${rc(state.scol)}">${state.siurl ? html`<img src="${resolveIcon(state.siurl)}" alt="" id="ipv-img">` : html`<span>${(item?.label || '?')[0]?.toUpperCase() || '?'}</span>`}</span>
        <input class="icon-srch" id="ip-in" type="text" autocomplete="off" placeholder="${t('app.iconPh')}" value="${state.siurl}">
        <button type="button" class="row-btn" id="ip-upload-lbl">${t('app.upload')}</button>
        <input type="file" id="ip-upload" accept=".svg,.png,.ico,image/svg+xml,image/png,image/x-icon" style="position:absolute;width:1px;height:1px;opacity:0">
      </div>
      <div class="iprs" id="iprs"></div>
      <div id="icon-color-slot"></div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">${t('app.showInDock')}</span>${tog('f-dock', !!item?.dock)}</div>
    </div>
    ${dockBlocked ? html`<p class="grp-tip" id="dock-full-tip">${t('app.dockFull', { max: DOCK_MAX })}</p>` : ''}

    <p class="grp-hdr">${t('app.badge')}</p>
    <div class="grp">
      <div class="row"><span class="rl">${t('app.healthCheck')}</span>${tog('hc-en', hc.enabled)}</div>
      <div id="hc-sub" ${hc.enabled && globalHealthOn ? '' : 'hidden'}>
        <div class="row"><span class="rl">${t('app.type')}</span><div class="segr">
          <label class="segr-opt"><input type="radio" name="hc-type" id="hc-type-con" ${isPing ? '' : 'checked'}><span class="segr-dot"></span><span>${t('app.container')}</span></label>
          <label class="segr-opt"><input type="radio" name="hc-type" id="hc-type-ping" ${isPing ? 'checked' : ''}><span class="segr-dot"></span><span>${t('app.ping')}</span></label>
        </div></div>
        <div id="hc-con-row" ${isPing ? 'hidden' : ''}>${ier('ie-hc-con', t('app.container'), 'hc-con', hc.container, t('app.containerPh'))}</div>
        <div id="hc-ping-row" ${isPing ? '' : 'hidden'}>
          ${ier('ie-hc-ping', t('app.pingUrl'), 'hc-ping', hc.pingUrl, t('app.pingUrlPh'), 'url')}
          <div class="row"><span class="rl"></span><span id="hc-ping-status" class="row-status"></span><button type="button" class="row-btn" id="hc-ping-test">${t('app.test')}</button></div>
        </div>
      </div>
    </div>
    ${globalHealthOn ? '' : html`<p class="grp-tip" id="hc-off-tip">${t('app.healthGlobalOff')}</p>`}

    <div class="grp">
      <div class="row"><span class="rl">${t('app.fixedLabel')}</span>${tog('static-en', hasStatic)}</div>
      <div id="static-sub" ${hasStatic ? '' : 'hidden'}>
        ${ier('ie-static-label', t('app.labelText'), 'f-static-label', staticBadge.label, t('app.labelPh'))}
        <div id="static-color-slot"></div>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">${t('app.liveActivity')}</span>${tog('act-en', act.enabled)}</div>
      <div id="act-sub" ${act.enabled ? '' : 'hidden'}>
        ${ier('ie-burl', t('app.apiUrl'), 'f-burl', act.url, t('app.apiUrlPh'), 'url')}
        <div class="row"><span class="rl"></span><span id="bst" class="row-status">${state.spaths.length ? 'Saved: ' + state.spaths.join(' + ') : ''}</span><button type="button" class="row-btn" id="bfetch">${t('app.fetch')}</button></div>
        <div id="bprow" class="${state.spaths.length ? '' : 'bprow-hidden'}">
          <div class="row"><span class="rl">${t('app.value')}</span></div>
          <div class="bval-box"><input class="bval-search" id="bsearch" type="text" placeholder="${t('app.filterValues')}" autocomplete="off"><div class="blist" id="blist"></div></div>
        </div>
        <div id="auth-row-wrap">
          <div class="row"><span class="rl">${t('app.authentication')}</span>${tog('auth-en', !!(act.params || act.headers))}</div>
          <div id="auth-sub" ${act.params?.length || act.headers?.length ? '' : 'hidden'}>
            <div class="row kv-hdr"><span class="rl">Add to URL <span class="rl-sub">(query params)</span></span></div>
            <div id="bpar-rows" class="kv-rows"></div>
            <div class="row kv-hdr"><span class="rl">${t('app.addToHeader')}</span></div>
            <div id="bhdr-rows" class="kv-rows"></div>
          </div>
        </div>
        <div id="act-color-slot"></div>
        ${ier('ie-bunit', t('app.unit'), 'bcust-unit', actCustom.unit, t('app.unitPh'))}
        <div id="poll-row"><div class="row"><span class="rl">${t('app.poll')}</span><div class="poll-inline">${pollBefore}<input id="f-bint" type="number" min="10" max="3600" value="${act.interval || 30}">${pollAfter}</div></div></div>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">${t('app.allowSelfSigned')}</span>${tog('f-skip-tls', skipTls)}</div>
    </div>
    <p class="grp-tip">${t('app.selfSignedTip')}</p>`,
  );

  initInlineEdit('ie-name', 'f-lbl', {
    placeholder: t('app.namePh'),
    onCommit() {
      updPrev();
    },
  });
  initInlineEdit('ie-url', 'f-href', { placeholder: t('app.urlPh') });
  initInlineEdit('ie-hc-con', 'hc-con', { placeholder: t('app.containerPh') });
  initInlineEdit('ie-hc-ping', 'hc-ping', { placeholder: t('app.pingUrlPh') });
  initInlineEdit('ie-static-label', 'f-static-label', { placeholder: t('app.labelPh') });
  initInlineEdit('ie-burl', 'f-burl', { placeholder: t('app.apiUrlPh') });
  initInlineEdit('ie-bunit', 'bcust-unit', { placeholder: t('app.unitPh') });

  renderColorControl(el('icon-color-slot'), {
    value: state.scol || 'dark',
    idPrefix: 'icon-col',
    semantic: true,
    label: t('common.color'),
    onChange(v) {
      state.scol = v;
      const pv = el('ipv');
      if (pv) pv.style.background = rc(state.scol);
    },
  });
  renderColorControl(el('static-color-slot'), {
    value: staticBadge.color || '#1e6ef4',
    idPrefix: 'static-col',
    swatchColors: BADGE_SWATCHES,
    label: t('common.color'),
  });
  renderColorControl(el('act-color-slot'), {
    value: actCustom.color || '#1e6ef4',
    idPrefix: 'act-col',
    swatchColors: BADGE_SWATCHES,
    label: t('common.color'),
  });

  state._bpar = normKvRows(act.params);
  state._bhdr = normKvRows(act.headers);
  renderKvRows(el('bpar-rows'), state._bpar, 'key=value');
  renderKvRows(el('bhdr-rows'), state._bhdr, 'X-Api-Key=…');

  wireIcon();
  if (state.siurl) updPrev();

  setTogDisabled(el('f-dock'), dockBlocked, 'dock-full-tip');
  const hcEn = el('hc-en');
  setTogDisabled(hcEn, !globalHealthOn, 'hc-off-tip');
  const showHide = (id, on) => {
    const node = el(id);
    if (node) node.hidden = !on;
  };
  hcEn?.addEventListener('change', e => {
    if (globalHealthOn) showHide('hc-sub', tgt(e).checked);
  });
  document.querySelectorAll('input[name="hc-type"]').forEach(r =>
    r.addEventListener('change', () => {
      const ping = inpById('hc-type-ping')?.checked;
      showHide('hc-con-row', !ping);
      showHide('hc-ping-row', ping);
    }),
  );
  el('hc-ping-test')?.addEventListener('click', testPing);
  el('static-en')?.addEventListener('change', e => showHide('static-sub', tgt(e).checked));
  el('act-en')?.addEventListener('change', e => showHide('act-sub', tgt(e).checked));
  el('auth-en')?.addEventListener('change', e => showHide('auth-sub', tgt(e).checked));
  el('bfetch')?.addEventListener('click', fetchBadge);
  el('bsearch')?.addEventListener('input', e => renderBadgeList(state.fnums, false, tgt(e).value));
  if (state.spaths.length) {
    ['bprow', 'auth-row-wrap', 'poll-row'].forEach(id => el(id)?.classList.remove('bprow-hidden'));
    renderBadgeList([], true);
  }
}

function wireIcon() {
  const inp = inpById('ip-in'),
    rs = el('iprs');
  if (!inp) return;
  let t;
  inp.oninput = () => {
    const v = inp.value.trim();
    if (v.startsWith('http://') || v.startsWith('https://')) {
      state.siurl = v;
      updPrev();
      rs.classList.remove('open');
      return;
    }
    if (v && !v.includes('/')) {
      state.siurl = v;
      updPrev();
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = v.replace(/\.(svg|png)$/i, '');
        try {
          const d = await ag(`/api/icons/search?q=${encodeURIComponent(q)}`);
          showIPRes(d.results || [], v);
        } catch {
          rs.classList.remove('open');
        }
      }, 300);
      return;
    }
    clearTimeout(t);
    if (!v) {
      rs.classList.remove('open');
      return;
    }
    t = setTimeout(async () => {
      try {
        const d = await ag(`/api/icons/search?q=${encodeURIComponent(v)}`);
        showIPRes(d.results || [], v);
      } catch {
        rs.classList.remove('open');
      }
    }, 300);
  };

  const upInput = inpById('ip-upload');
  const upBtn = el('ip-upload-lbl');
  /* Explicit click handler, more reliable than a <label> wrapping the input,
     especially since the button text is swapped during upload. */
  if (upBtn && upInput) {
    upBtn.onclick = () => upInput.click();
    upInput.onchange = async () => {
      const file = upInput.files[0];
      if (!file) return;
      const origText = upBtn.textContent;
      upBtn.textContent = '↑ Uploading…';
      try {
        const form = new FormData();
        form.append('icon', file, file.name);
        const r = await fetch('/api/icons/upload', { method: 'POST', body: form });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        await loadLocalIcons();
        state.siurl = d.filename;
        const ipIn = inpById('ip-in');
        if (ipIn) ipIn.value = d.filename;
        updPrev();
        toast(`Uploaded ${d.filename}`);
      } catch (e) {
        toast('Upload failed: ' + e.message, 'err');
      } finally {
        upBtn.textContent = origText;
        upInput.value = '';
      }
    };
  }

  document.addEventListener('click', e => {
    if (!el('ipw')?.contains(/** @type {Node} */ (e.target))) rs?.classList.remove('open');
  });
}
function showIPRes(list, rawInput) {
  const rs = el('iprs');
  if (!rs) return;
  rs.innerHTML = '';
  list.forEach(ic => {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'ipr';
    const img = document.createElement('img');
    img.alt = '';
    img.src = ic.svgUrl;
    img.onerror = () => {
      img.src = ic.pngUrl;
    };
    const sp = document.createElement('span');
    sp.textContent = ic.name;
    r.append(img, sp);
    r.onclick = () => {
      state.siurl = ic.svgUrl;
      inpById('ip-in').value = ic.svgUrl;
      updPrev();
      rs.classList.remove('open');
    };
    rs.appendChild(r);
  });
  if (!list.length && rawInput && !rawInput.includes('/')) {
    /* The catalogue is lowercase and hyphenated, so what was typed is offered in
       that spelling. Shown corrected rather than corrected silently, so what
       gets saved is what is on screen. */
    const val = cdnIconName(rawInput);
    if (!val) {
      rs.classList.remove('open');
      return;
    }
    const srcs = iconChain(val);
    if (!srcs.length) {
      rs.classList.remove('open');
      return;
    }
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'ipr';
    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'width:24px;height:24px;object-fit:contain;';
    let step = 0;
    img.src = srcs[0];
    img.onerror = () => {
      step++;
      if (step < srcs.length) img.src = srcs[step];
      else {
        img.onerror = null;
        img.src = '';
        img.style.display = 'none';
      }
    };
    const sp = document.createElement('span');
    sp.textContent = val;
    r.append(img, sp);
    r.onclick = () => {
      state.siurl = val;
      inpById('ip-in').value = val;
      updPrev();
      rs.classList.remove('open');
    };
    rs.appendChild(r);
  }
  if (rs.children.length) rs.classList.add('open');
  else rs.classList.remove('open');
}
function setInitialGlyph(p) {
  const l = inpById('f-lbl')?.value || '?';
  const s = document.createElement('span');
  s.textContent = (l[0] || '?').toUpperCase();
  p.replaceChildren(s);
}
function updPrev() {
  const p = el('ipv');
  if (!p) return;
  p.style.background = rc(state.scol);
  if (!state.siurl) {
    setInitialGlyph(p);
    return;
  }
  const fallbacks = iconChain(state.siurl);
  if (!fallbacks.length) {
    setInitialGlyph(p);
    return;
  }
  let step = 0;
  const img = document.createElement('img');
  img.style.cssText = 'width:30px;height:30px;object-fit:contain;';
  img.alt = '';
  img.onerror = () => {
    step++;
    if (step < fallbacks.length) {
      img.src = fallbacks[step];
    } else {
      setInitialGlyph(p);
    }
  };
  img.src = fallbacks[0];
  p.replaceChildren(img);
}

async function testPing() {
  const url = inpById('hc-ping')?.value?.trim();
  const st = el('hc-ping-status');
  if (!url) {
    st.textContent = 'Enter a URL first.';
    return;
  }
  st.textContent = 'Testing…';
  const skipTls = inpById('f-skip-tls')?.checked || false;
  try {
    const r = await ap('/api/ping', { url, skipTls });
    st.textContent = r.ok ? `✓ Reachable (${r.status})` : `✗ HTTP ${r.status}`;
  } catch (e) {
    st.textContent = '✗ ' + e.message;
  }
}

/* A stored secret row arrives as value:"" with valueSet:true, so an empty value
   means "keep the stored one". */
function normKvRows(v) {
  if (Array.isArray(v))
    return v.map(r => ({
      key: r.key || '',
      value: r.value != null ? r.value : '',
      secret: !!r.secret,
      valueSet: !!r.valueSet,
    }));
  if (v && typeof v === 'object')
    return Object.entries(v).map(([key, value]) => ({ key, value: String(value), secret: false, valueSet: false }));
  return [];
}

/* An untouched secret row is sent with no value, so the server keeps the stored
   one. Rows with no key are dropped. */
export function serializeKvRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const key = (r.key || '').trim();
    if (!key) continue;
    const row = { key, secret: !!r.secret };
    if (r.value !== '') row.value = r.value;
    else if (r.valueSet) row.valueSet = true;
    else row.value = '';
    out.push(row);
  }
  return out;
}

function renderKvRows(host, rows, ph) {
  if (!host) return;
  host.replaceChildren();
  rows.forEach(row => host.appendChild(kvRowEl(host, rows, row, ph)));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'kv-add';
  setHtml(add, html`<span>+ Add</span>`);
  add.onclick = () => {
    rows.push({ key: '', value: '', secret: false, valueSet: false });
    renderKvRows(host, rows, ph);
  };
  host.appendChild(add);
}

const defaultValuePlaceholder = ph => ph.split('=')[1] || 'value';

function kvRowEl(host, rows, row, ph) {
  const el = document.createElement('div');
  el.className = 'kv-row';
  const valPh = row.secret && row.valueSet && row.value === '' ? 'Configured' : defaultValuePlaceholder(ph);
  setHtml(
    el,
    html`
    <input class="kv-k" type="text" placeholder="Key" value="${row.key}" aria-label="Header key">
    <input class="kv-v" type="${row.secret ? 'password' : 'text'}" placeholder="${valPh}" value="${row.value}" autocomplete="off" aria-label="Header value">
    <label class="kv-cred" title="Store this value as a credential: hidden after saving and never exported. Unticking clears the stored value."><input type="checkbox" ${row.secret ? 'checked' : ''} aria-label="${t('app.secret')}"><span class="kv-box"></span><span class="kv-cred-lbl">${t('app.secret')}</span></label>
    <button class="kv-del" type="button" aria-label="Remove">✕</button>`,
  );
  const kEl = qi('.kv-k', el),
    vEl = qi('.kv-v', el),
    cEl = qi('.kv-cred input', el),
    dEl = qSel('.kv-del', el);
  kEl.oninput = () => {
    row.key = kEl.value;
  };
  vEl.oninput = () => {
    row.value = vEl.value;
    row.valueSet = false;
  };
  cEl.onchange = () => {
    row.secret = cEl.checked;
    vEl.type = cEl.checked ? 'password' : 'text';
    /* The server refuses to refill a non-secret row, so unticking clears the
       credential on save. valueSet is cleared too, or the row would be sent as
       "keep what you have" and the loss would only show up afterwards. */
    if (clearsStoredSecret(row, cEl.checked)) {
      row.valueSet = false;
      vEl.value = '';
      vEl.placeholder = defaultValuePlaceholder(ph);
    }
  };
  dEl.onclick = () => {
    const idx = rows.indexOf(row);
    if (idx >= 0) rows.splice(idx, 1);
    renderKvRows(host, rows, ph);
  };
  return el;
}

async function fetchBadge() {
  const url = inpById('f-burl')?.value?.trim();
  const st = el('bst');
  if (!url) {
    if (st) st.style.cssText = 'margin-top:4px;color:var(--dm)';
    if (st) st.textContent = 'Enter a URL first.';
    return;
  }
  if (st) {
    st.style.cssText = 'margin-top:4px;color:var(--dm)';
    st.textContent = 'Fetching…';
  }
  const btn = inpById('bfetch');
  if (btn) btn.disabled = true;
  try {
    const params = serializeKvRows(state._bpar);
    const headers = serializeKvRows(state._bhdr);
    const skipTls = inpById('f-skip-tls')?.checked || false;
    const r = await ap('/api/badge-proxy', {
      url,
      params,
      headers,
      skipTls,
      itemId: state.eid !== null ? state.items[state.eid]?.id : undefined,
    });
    state.fnums = r.numbers || [];
    if (st) {
      st.style.cssText = 'margin-top:4px;color:#34c759';
      if (!state.fnums.length) st.textContent = '✓ Connected, no numeric values found';
      else st.textContent = `✓ Found ${state.fnums.length} value${state.fnums.length !== 1 ? 's' : ''}`;
    }
    ['bprow', 'auth-row-wrap', 'poll-row'].forEach(id => el(id)?.classList.remove('bprow-hidden'));
    if (state.fnums.length) renderBadgeList(state.fnums, false);
  } catch (e) {
    /* Branch on the error's `kind`, not on words inside its message. See
       ui/js/admin-error.js and docs/api-errors.md. */
    const advice = badgeErrorAdvice(e);
    if (st) {
      st.style.cssText = 'margin-top:4px;color:' + (advice.tone === TONE.WARN ? '#ff9f0a' : '#ff453a');
      st.textContent = advice.tone === TONE.WARN ? advice.message : '✗ ' + advice.message;
    }
    if (advice.openAuth) {
      const authCb = inpById('auth-en');
      const authSub = el('auth-sub');
      if (authCb && !authCb.checked) {
        authCb.checked = true;
        if (authSub) authSub.classList.add('open');
      }
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
function renderBadgeList(nums, existingOnly, query = '') {
  const list = el('blist');
  if (!list) return;
  list.innerHTML = '';
  if (existingOnly && !nums.length) {
    /* Issue #8: saved paths already shown in #bst hint, don't repeat here */
    if (state.spaths.length) {
      state.spaths.forEach(p => {
        const it = document.createElement('div');
        it.className = 'bi on';
        setHtml(
          it,
          html`<div class="bck"></div><div class="binfo"><div class="blabel">${p}</div><div class="bpath">${p}</div></div>`,
        );
        it.onclick = () => {
          const i = state.spaths.indexOf(p);
          if (i >= 0) {
            state.spaths.splice(i, 1);
            it.classList.remove('on');
          } else {
            state.spaths.push(p);
            it.classList.add('on');
          }
        };
        list.appendChild(it);
      });
    }
    return;
  }
  if (!nums.length) {
    const e = document.createElement('div');
    e.style.cssText = 'padding:8px 12px;font-size:13px;color:var(--dm)';
    e.textContent = 'No numeric values in response.';
    list.appendChild(e);
    return;
  }
  const q = query.toLowerCase().trim();
  const filtered = q ? nums.filter(n => (n.label || n.path).toLowerCase().includes(q)) : nums;
  if (!filtered.length) {
    const e = document.createElement('div');
    e.style.cssText = 'padding:8px 12px;font-size:13px;color:var(--dm)';
    e.textContent = t('list.noMatches');
    list.appendChild(e);
    return;
  }
  const direct = filtered.filter(n => !n.computed);
  const computed = filtered.filter(n => n.computed);
  const addItem = ({ path, value, label }) => {
    const it = document.createElement('div');
    it.className = 'bi' + (state.spaths.includes(path) ? ' on' : '');
    const displayLabel = label || path;
    setHtml(
      it,
      html`<div class="bck"></div><div class="binfo"><div class="blabel">${displayLabel}</div><div class="bpath">${path}</div></div><div class="bval">${value}</div>`,
    );
    it.onclick = () => {
      const i = state.spaths.indexOf(path);
      if (i >= 0) {
        state.spaths.splice(i, 1);
        it.classList.remove('on');
      } else {
        state.spaths.push(path);
        it.classList.add('on');
      }
    };
    list.appendChild(it);
  };
  if (direct.length) {
    if (computed.length && !q) {
      const s = document.createElement('div');
      s.className = 'bsep';
      s.textContent = 'Values';
      list.appendChild(s);
    }
    direct.forEach(addItem);
  }
  if (computed.length) {
    if (!q) {
      const s = document.createElement('div');
      s.className = 'bsep';
      s.textContent = 'Computed from array';
      list.appendChild(s);
    }
    computed.forEach(addItem);
  }
}
