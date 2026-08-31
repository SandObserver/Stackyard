import { clr as rc, el, inp as inpById, q as qSel, qa, qi, tgt } from '/js/utils.js?v=3ae4d9d8';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { loadLocalIcons, resolveIcon, iconChain, cdnIconName } from '/js/icons.js?v=69c2b9bd';
import { state } from '/js/admin-state.js?v=c23e6346';
import { isDockBlocked, DOCK_MAX, clearsStoredSecret } from '/js/admin-logic.js?v=d17394da';
import { t } from '/js/i18n.js?v=83239bf4';
import {
  toast,
  ag,
  ap,
  PE_SVG,
  CHEV_SVG,
  initInlineEdit,
  setTogDisabled,
  wireChecklist,
} from '/js/admin-shared.js?v=cd2162b7';
import { MAX_LABELS } from '/js/badge-logic.js?v=41a929ac';
import { renderColorControl, BADGE_SWATCHES, BADGE_DEFAULT } from '/js/admin-color-control.js?v=234b76f0';
import { badgeErrorAdvice, TONE } from '/js/admin-error.js?v=10f3cdb1';

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
        <button class="pe" type="button">${raw(PE_SVG)}</button>
      </div>
      <div class="row">
        <span class="rl">${t('folder.addApps')}</span>
        <div class="row-dd" id="folder-apps-dd">
          <button class="row-dd-btn" id="folder-apps-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="folder-apps-label">${t('folder.selectApps')}</span>
            ${raw(CHEV_SVG)}
          </button>
          <ul class="row-dd-list checklist" id="folder-apps-list" role="listbox" aria-multiselectable="true" aria-label="${t('folder.appsInFolder')}" hidden>${opts}</ul>
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
      sel.length === 0
        ? t('folder.selectApps')
        : sel.length === 1
          ? sel[0].textContent
          : t('widgetCfg.selectedCount', { count: sel.length });
  };
  wireChecklist(dd, btn, list, li => {
    li.setAttribute('aria-selected', li.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
    sync();
  });
  sync();
}

export function buildAppForm(body, item) {
  const dockBlocked = isDockBlocked(state.items, item);
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
  const staticBadge = mon.staticBadge || {};
  const hasStatic = !!staticBadge.enabled;
  const isPing = !!hc.pingUrl;
  const skipTls = !!item?.skipTlsVerify;

  const ier = _ieRow;
  /* Split the string around its placeholder. Word order differs per language. */
  const [pollBefore, pollAfter] = t('app.pollInterval').split('{seconds}');

  const tog = (id, on, name) =>
    html`<label class="tog"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="${name}"><div class="tr"></div></label>`;

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
        <input type="file" id="ip-upload" aria-label="${t('app.upload')}" accept=".svg,.png,.ico,image/svg+xml,image/png,image/x-icon" style="position:absolute;width:1px;height:1px;opacity:0">
      </div>
      <div class="iprs" id="iprs"></div>
      <div id="icon-color-slot"></div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">${t('app.showInDock')}</span>${tog('f-dock', !!item?.dock, t('app.showInDock'))}</div>
    </div>
    ${dockBlocked ? html`<p class="grp-tip" id="dock-full-tip">${t('app.dockFull', { max: DOCK_MAX })}</p>` : ''}

    <p class="grp-hdr">${t('app.badge')}</p>
    <div class="grp">
      <div class="row"><span class="rl">${t('app.healthCheck')}</span>${tog('hc-en', hc.enabled, t('app.healthCheck'))}</div>
      <div id="hc-sub" ${hc.enabled ? '' : 'hidden'}>
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
      <div class="row"><span class="rl">${t('app.fixedLabel')}</span>${tog('static-en', hasStatic, t('app.fixedLabel'))}</div>
      <div id="static-sub" ${hasStatic ? '' : 'hidden'}>
        ${ier('ie-static-label', t('app.labelText'), 'f-static-label', staticBadge.label, t('app.labelPh'))}
        <div id="static-color-slot"></div>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">${t('app.liveActivity')}</span>${tog('act-en', act.enabled, t('app.liveActivity'))}</div>
      <div id="act-sub" ${act.enabled ? '' : 'hidden'}>
        ${ier('ie-burl', t('app.apiUrl'), 'f-burl', act.url, t('app.apiUrlPh'), 'url')}
        <div class="row"><span class="rl"></span><span id="bst" class="row-status"></span><button type="button" class="row-btn" id="bfetch">${t('app.fetch')}</button></div>
        <div id="auth-row-wrap">
          <div class="row"><span class="rl">${t('app.authentication')}</span>${tog('auth-en', !!(act.params || act.headers), t('app.authentication'))}</div>
          <div id="auth-sub" ${act.params?.length || act.headers?.length ? '' : 'hidden'}>
            <div class="row kv-hdr"><span class="rl">${t('app.addToUrl')} <span class="rl-sub">(query params)</span></span></div>
            <div id="bpar-rows" class="kv-rows"></div>
            <div class="row kv-hdr"><span class="rl">${t('app.addToHeader')}</span></div>
            <div id="bhdr-rows" class="kv-rows"></div>
          </div>
        </div>
        <div id="poll-row"><div class="row"><span class="rl">${t('app.poll')}</span><div class="poll-inline">${pollBefore}<input id="f-bint" type="number" min="10" max="3600" value="${act.interval || 30}" aria-label="${t('app.poll')}">${pollAfter}</div></div></div>
      </div>
    </div>
    <div id="act-labels-wrap" class="bprow-hidden">
      <div id="act-labels"></div>
      <p class="grp-tip" id="act-label-order">${t('app.labelOrderTip')}</p>
      <div class="albl-add-wrap"><button type="button" class="albl-add" id="act-add-label">${t('app.addLabel')}</button></div>
      <p class="grp-tip" id="act-label-max" hidden>${t('app.labelMax', { count: MAX_LABELS })}</p>
      <div id="act-combine-row" class="bprow-hidden">
        <div class="grp"><div class="row"><span class="rl">${t('app.combineValues')}</span>${tog('act-combine', !!act.combine || !!state.slegacySum, t('app.combineValues'))}</div></div>
        <p class="grp-tip" id="act-combine-tip">${t('app.combineTip')}</p>
      </div>
    </div>

    <div class="grp">
      <div class="row"><span class="rl">${t('app.allowSelfSigned')}</span>${tog('f-skip-tls', skipTls, t('app.allowSelfSigned'))}</div>
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
    value: staticBadge.color || BADGE_DEFAULT,
    idPrefix: 'static-col',
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
  const showHide = (id, on) => {
    const node = el(id);
    if (node) node.hidden = !on;
  };
  hcEn?.addEventListener('change', e => {
    showHide('hc-sub', tgt(e).checked);
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
  el('act-combine')?.addEventListener('change', () => {
    captureActLabels();
    syncActMode();
  });
  el('act-add-label')?.addEventListener('click', addActLabel);
  const savedStatus = el('bst');
  if (savedStatus && state.spaths.length)
    savedStatus.textContent = t('app.labelsSaved', { count: state.spaths.length });
  syncActMode();
}

/* ── Live Activity labels ───────────────────────────────────────────────── */

/** One label's stored styling, keyed by value path. @param {string} path */
function actLabel(path) {
  if (!state.slabels) state.slabels = Object.create(null);
  if (!state.slabels[path]) state.slabels[path] = { name: '', unit: '', color: BADGE_DEFAULT, min: '' };
  return state.slabels[path];
}

/** Read every rendered label card back into state. Run this before anything
    re-renders the list. Skipping it loses the edits in the DOM. */
export function captureActLabels() {
  state.spaths.forEach((path, i) => {
    const l = actLabel(path);
    const read = id => inpById(id)?.value?.trim() ?? undefined;
    const name = read(`albl-name-${i}`);
    if (name !== undefined) l.name = name;
    const unit = read(`albl-unit-${i}`);
    if (unit !== undefined) l.unit = unit;
    const min = read(`albl-min-${i}`);
    if (min !== undefined) l.min = min;
    const col = inpById(`albl-col-${i}-val`)?.value;
    if (col) l.color = col;
  });
}

/** Carry a label's styling to its new path. Styling is keyed by path, so
    without this the card resets to the defaults. */
function repathActLabel(from, to) {
  if (from === to) return;
  const l = state.slabels?.[from];
  if (l && !state.slabels[to]) state.slabels[to] = l;
}

function syncActMode() {
  const ready = state.fnums.length > 0 || state.spaths.length > 0;
  el('act-labels-wrap')?.classList.toggle('bprow-hidden', !ready);
  el('act-combine-row')?.classList.toggle('bprow-hidden', state.spaths.length < 2);
  const add = el('act-add-label');
  if (add) {
    add.hidden = state.spaths.length >= MAX_LABELS;
    const tip = el('act-label-max');
    if (tip) tip.hidden = !add.hidden;
  }
  const host = el('act-labels');
  if (!host) return;
  if (!ready) {
    host.innerHTML = '';
    return;
  }
  renderActLabels(host);
}

/** Fetched values, plus any path the config already uses so a saved label
    stays selectable before its API is re-fetched. */
function actValueOptions() {
  const seen = new Set();
  const out = [];
  for (const n of state.fnums) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    out.push({ path: n.path, label: n.label || n.path, value: n.value, computed: !!n.computed });
  }
  for (const p of state.spaths) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ path: p, label: p, value: null, computed: false });
  }
  return out;
}

function _valueSelect(idx, path) {
  const opts = actValueOptions();
  const groups = [
    { name: t('app.values'), rows: opts.filter(o => !o.computed) },
    { name: t('app.computedFromArray'), rows: opts.filter(o => o.computed) },
  ].filter(g => g.rows.length);
  const optionOf = o =>
    html`<option value="${o.path}" ${o.path === path ? 'selected' : ''}>${o.value == null ? o.label : `${o.label} — ${o.value}`}</option>`;
  const body =
    groups.length > 1
      ? groups.map(g => html`<optgroup label="${g.name}">${g.rows.map(optionOf)}</optgroup>`)
      : opts.map(optionOf);
  return html`<div class="row"><span class="rl">${t('app.value')}</span><div class="sel-wrap"><select class="row-sel" id="albl-path-${idx}" aria-label="${t('app.value')}">${body}</select>${raw(CHEV_SVG)}</div></div>`;
}

function renderActLabels(host) {
  host.innerHTML = '';
  state.spaths.forEach((path, i) => {
    const l = actLabel(path);
    const hdr = document.createElement('p');
    hdr.className = 'grp-hdr grp-hdr-row albl-hdr' + (i === 0 ? ' albl-hdr-first' : '');
    hdr.dataset.idx = String(i);
    setHtml(
      hdr,
      html`<span class="albl-grip" aria-hidden="true">${raw(GRIP_SVG)}</span><span>${t('app.labelN', { n: i + 1 })}</span>`,
    );
    const ctl = document.createElement('span');
    ctl.className = 'albl-ctl';
    const mkBtn = (txt, aria, cls, disabled, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = txt;
      b.setAttribute('aria-label', aria);
      b.disabled = disabled;
      b.onclick = onClick;
      return b;
    };
    ctl.append(
      mkBtn('\u2191', t('app.moveUp'), 'albl-move', i === 0, () => moveActLabel(i, -1)),
      mkBtn('\u2193', t('app.moveDown'), 'albl-move', i === state.spaths.length - 1, () => moveActLabel(i, 1)),
      mkBtn(t('widgetCfg.remove'), t('app.removeLabel'), 'grp-hdr-rm', false, () => {
        captureActLabels();
        state.spaths.splice(i, 1);
        syncActMode();
      }),
    );
    hdr.appendChild(ctl);
    host.appendChild(hdr);

    const card = document.createElement('div');
    card.className = 'grp';
    setHtml(
      card,
      html`${_valueSelect(i, path)}
      ${_ieRow(`ie-albl-name-${i}`, _optRow(t('app.labelText')), `albl-name-${i}`, l.name, t('app.labelPh'))}
      <div id="albl-col-slot-${i}"></div>
      ${_ieRow(`ie-albl-unit-${i}`, _optRow(t('app.unit')), `albl-unit-${i}`, l.unit, t('app.unitPh'))}
      ${_ieRow(`ie-albl-min-${i}`, _optRow(t('app.badgeMin')), `albl-min-${i}`, l.min, t('app.badgeMinPh'), 'number')}`,
    );
    host.appendChild(card);
    initInlineEdit(`ie-albl-name-${i}`, `albl-name-${i}`, { placeholder: t('app.labelPh') });
    initInlineEdit(`ie-albl-unit-${i}`, `albl-unit-${i}`, { placeholder: t('app.unitPh') });
    initInlineEdit(`ie-albl-min-${i}`, `albl-min-${i}`, { placeholder: t('app.badgeMinPh') });
    renderColorControl(el(`albl-col-slot-${i}`), {
      value: l.color || BADGE_DEFAULT,
      idPrefix: `albl-col-${i}`,
      swatchColors: BADGE_SWATCHES,
      label: t('common.color'),
    });
    const sel = inpById(`albl-path-${i}`);
    if (sel) {
      sel.onchange = () => {
        captureActLabels();
        const next = sel.value;
        if (state.spaths.includes(next)) {
          sel.value = state.spaths[i];
          toast(t('app.labelValueTaken'), 'err');
          return;
        }
        repathActLabel(state.spaths[i], next);
        state.spaths[i] = next;
        syncActMode();
      };
    }
  });
  wireActLabelDrag(host);
}

const _optRow = label => html`${label} <span class="rl-sub">${t('app.optional')}</span>`;

const GRIP_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" focusable="false"><circle cx="6" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12" r="1.3"/><circle cx="10" cy="12" r="1.3"/></svg>';

function addActLabel() {
  captureActLabels();
  if (state.spaths.length >= MAX_LABELS) {
    toast(t('app.labelMax', { count: MAX_LABELS }), 'err');
    return;
  }
  const free = actValueOptions().find(o => !state.spaths.includes(o.path));
  if (!free) {
    toast(t('app.noValuesLeft'), 'err');
    return;
  }
  state.spaths.push(free.path);
  syncActMode();
}

function moveActLabel(from, delta) {
  const to = from + delta;
  if (to < 0 || to >= state.spaths.length) return;
  captureActLabels();
  const [p] = state.spaths.splice(from, 1);
  state.spaths.splice(to, 0, p);
  syncActMode();
}

/** Drag a label header to reorder. Keep the arrows: a pointer drag is
    unreachable by keyboard. */
function wireActLabelDrag(host) {
  let from = -1;
  const headers = () => /** @type {HTMLElement[]} */ ([...host.querySelectorAll('.albl-hdr')]);
  for (const hdr of headers()) {
    hdr.addEventListener('pointerdown', e => {
      const ev = /** @type {PointerEvent} */ (e);
      if (ev.button != null && ev.button !== 0) return;
      if (/** @type {HTMLElement} */ (ev.target).closest('button')) return;
      from = Number(hdr.dataset.idx);
      hdr.classList.add('albl-dragging');
      hdr.setPointerCapture(ev.pointerId);
    });
    hdr.addEventListener('pointermove', e => {
      if (from < 0) return;
      e.preventDefault();
      const ev = /** @type {PointerEvent} */ (e);
      for (const other of headers()) {
        if (other === hdr) continue;
        const r = other.getBoundingClientRect();
        if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
        const to = Number(other.dataset.idx);
        hdr.classList.remove('albl-dragging');
        const at = from;
        from = -1;
        moveActLabel(at, to - at);
        return;
      }
    });
    const end = () => {
      hdr.classList.remove('albl-dragging');
      from = -1;
    };
    hdr.addEventListener('pointerup', end);
    hdr.addEventListener('pointercancel', end);
  }
}

/** The inline-edit row markup. The pencil's accessible name is set by
    initInlineEdit, from the row's own label. */
function _ieRow(rowId, label, inpId, val, ph, type = 'text') {
  const has = val != null && val !== '';
  return html`<div class="row ie-row" id="${rowId}"><span class="rl">${label}</span><span class="rv${has ? '' : ' is-ph'}">${has ? val : ph}</span><input id="${inpId}" type="${type}" value="${val || ''}" style="display:none"><button class="pe" type="button">${raw(PE_SVG)}</button></div>`;
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
  if (upBtn && upInput) {
    upBtn.onclick = () => upInput.click();
    upInput.onchange = async () => {
      const file = upInput.files[0];
      if (!file) return;
      const origText = upBtn.textContent;
      upBtn.textContent = '↑ ' + t('appearance.uploading');
      try {
        const form = new FormData();
        form.append('icon', file, file.name);
        const r = await fetch('/api/icons/upload', { method: 'POST', body: form });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        await loadLocalIcons();
        state.siurl = d.filename;
        const ipIn = inpById('ip-in');
        if (ipIn) ipIn.value = d.filename;
        updPrev();
        toast(t('toast.uploaded', { name: d.filename }));
      } catch (e) {
        toast(t('toast.uploadFailed', { err: e.message }), 'err');
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
/* Several attempts are in flight at once and the half-typed ones finish last.
   The token stops a stale failure replacing a finished preview. */
let prevRun = 0;
function updPrev() {
  const p = el('ipv');
  if (!p) return;
  const run = ++prevRun;
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
  img.alt = '';
  img.onerror = () => {
    if (run !== prevRun) return;
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
    st.textContent = t('app.enterUrlFirst');
    return;
  }
  st.textContent = t('app.testing');
  const skipTls = inpById('f-skip-tls')?.checked || false;
  try {
    const r = await ap('/api/ping', { url, skipTls });
    st.textContent = r.ok
      ? '✓ ' + t('app.reachable', { status: r.status })
      : '✗ ' + t('app.httpError', { status: r.status });
  } catch (e) {
    st.textContent = '✗ ' + e.message;
  }
}

/* An empty value on a row with valueSet means "keep the stored one". */
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
   one. */
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
  setHtml(add, html`<span>${t('common.add')}</span>`);
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
    <input class="kv-k" type="text" placeholder="${t('app.headerKeyPh')}" value="${row.key}" aria-label="${t('app.headerKey')}">
    <input class="kv-v" type="${row.secret ? 'password' : 'text'}" placeholder="${valPh}" value="${row.value}" autocomplete="off" aria-label="${t('app.headerValue')}">
    <label class="kv-cred" title="${t('app.secretTip')}"><input type="checkbox" ${row.secret ? 'checked' : ''} aria-label="${t('app.secret')}"><span class="kv-box"></span><span class="kv-cred-lbl">${t('app.secret')}</span></label>
    <button class="kv-del" type="button" aria-label="${t('widgetCfg.remove')}">✕</button>`,
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
       credential on save. Clear valueSet too, or the row is sent as "keep what
       you have". */
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
    if (st) st.textContent = t('app.enterUrlFirst');
    return;
  }
  if (st) {
    st.style.cssText = 'margin-top:4px;color:var(--dm)';
    st.textContent = t('app.fetching');
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
      if (!state.fnums.length) st.textContent = '✓ ' + t('app.connectedNoValues');
      else st.textContent = '✓ ' + t('app.foundValues', { count: state.fnums.length });
    }
    el('auth-row-wrap')?.classList.remove('bprow-hidden');
    if (state.fnums.length && !state.spaths.length) addActLabel();
    else syncActMode();
  } catch (e) {
    /* Branch on the error's `kind`, never on words inside its message. */
    const advice = badgeErrorAdvice(e);
    if (st) {
      st.style.cssText = 'margin-top:4px;color:' + (advice.tone === TONE.WARN ? 'var(--warning)' : 'var(--danger)');
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
