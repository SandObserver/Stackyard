import { state } from '/js/admin-state.js?v=831e219e';
import { PE_SVG, initInlineEdit, swapContent } from '/js/admin-shared.js?v=7c3b99fa';
import { createListbox } from '/js/listbox.js?v=699c6308';
import { renderWidgetConfigForm } from '/js/widget-config-form.js?v=9ea22e3f';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { sizesForView, widgetConfigMode, rejectionLines, carriesTypedValues } from '/js/admin-logic.js?v=5356a1b3';
import { t } from '/js/i18n.js?v=1f1ea9c1';
import { q, qi, qa } from '/js/utils.js?v=843b7c2b';
import { iconSvg } from '/js/icon-set.js?v=606a68c6';

const SIZES_WITH_ICONS = new Set(['small', 'medium', 'large', 'xlarge']);

const CUSTOM_SIZES = ['small', 'medium', 'large', 'xlarge'];
function widgetSizes(type) {
  return type === 'custom' ? CUSTOM_SIZES : state._widgetReg[type]?.sizes || ['medium'];
}
const SIZE_KEYS = {
  small: 'widgetCfg.sizeSmall',
  medium: 'widgetCfg.sizeMedium',
  large: 'widgetCfg.sizeLarge',
  xlarge: 'widgetCfg.sizeXLarge',
};

/* A registry widget may declare a size that is not one of the four. */
export const sizeLabel = size => (SIZE_KEYS[size] ? t(SIZE_KEYS[size]) : size);

export function buildWidgetForm(body, item) {
  const wt = item?.widgetType || 'custom';
  const ws = item?.widgetSize || 'medium';
  const wc = item?.widgetConfig || {};
  state._wtype = wt;
  state._wsize = ws;
  state._wlabel = item?.label || '';
  state._wAutoCfg = Object.assign({}, wc);
  _renderWidgetForm(body);
}

function _renderWidgetForm(body) {
  /* Re-render of the same form in the same editing session: keep typed values. */
  if (
    carriesTypedValues(
      { form: state._autoForm, type: state._autoFormType, session: state._autoFormSession },
      state._wtype,
      state._evSession,
    )
  ) {
    state._wAutoCfg = Object.assign({}, state._wAutoCfg, state._autoForm.getValues());
  }
  state._autoForm = null;
  const addNew = body.querySelector(':scope > .add-new-card');
  body.replaceChildren(...(addNew ? [addNew] : []));

  const typeList = [...Object.values(state._widgetReg).map(w => [w.name, w.label]), ['custom', 'Custom']].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const shell = document.createElement('div');
  shell.className = 'grp';
  setHtml(
    shell,
    html`
    <div class="row ie-row" id="ie-wname"><span class="rl">${t('widgetCfg.name')}</span><span class="rv${state._wlabel ? '' : ' is-ph'}">${state._wlabel ? state._wlabel : t('widgetCfg.namePh')}</span><input id="f-wlabel" type="text" value="${state._wlabel}" class="d-none"><button class="pe" type="button" aria-label="${t('widgetCfg.editName')}">${raw(PE_SVG)}</button></div>
    <div class="row" id="wtype-row"><span class="rl">${t('widgetCfg.type')}</span></div>`,
  );
  body.appendChild(shell);
  initInlineEdit('ie-wname', 'f-wlabel', {
    placeholder: t('widgetCfg.namePh'),
    onCommit(v) {
      state._wlabel = v;
    },
  });
  const typeBox = createListbox({
    id: 'f-wtype',
    label: t('widgetCfg.type'),
    options: typeList.map(([name, label]) => ({ value: name, label })),
    value: state._wtype,
    onChange: v => {
      state._wtype = String(v);
      state._wsize = widgetSizes(state._wtype)[0];
      swapContent(body, () => _renderWidgetForm(body));
    },
  });
  q('#wtype-row', shell).appendChild(typeBox.el);

  const refused = (state._widgetRejected || []).filter(r => r && r.name);
  if (refused.length) {
    const note = document.createElement('p');
    note.className = 'grp-tip';
    note.textContent = t('widgetCfg.refused', { count: refused.length });
    body.appendChild(note);
    appendRejectionReasons(body, refused);
  }

  const _sizeOpts = sizesForView(widgetSizes(state._wtype), state._widgetReg[state._wtype], state._wAutoCfg);
  if (!_sizeOpts.includes(state._wsize)) state._wsize = _sizeOpts.includes('medium') ? 'medium' : _sizeOpts[0];
  const sizeHdr = document.createElement('p');
  sizeHdr.className = 'grp-hdr';
  sizeHdr.textContent = t('widgetCfg.size');
  body.appendChild(sizeHdr);
  const scard = document.createElement('div');
  scard.className = 'grp';
  setHtml(
    scard,
    html`<div class="row tile-row"><div class="tile-grp">${_sizeOpts.map(s => html`<button type="button" class="tile-opt${s === state._wsize ? ' on' : ''}" aria-pressed="${String(s === state._wsize)}" data-size="${s}"><span class="tile-ico">${raw(iconSvg(SIZES_WITH_ICONS.has(s) ? s : 'medium', 38))}</span><span class="tile-cap">${sizeLabel(s)}</span></button>`)}</div></div>`,
  );
  body.appendChild(scard);
  qa('.tile-opt', scard).forEach(b =>
    b.addEventListener('click', () => {
      state._wsize = b.dataset.size;
      _renderWidgetForm(body);
    }),
  );

  const cfgDiv = document.createElement('div');
  cfgDiv.className = 'div';
  body.appendChild(cfgDiv);
  const _mode = widgetConfigMode(state._wtype, state._widgetReg);
  if (_mode === 'registry') {
    const d = document.createElement('div');
    body.appendChild(d);
    const _wid =
      state.eid !== null && state.items[state.eid] && state.items[state.eid].id ? state.items[state.eid].id : null;
    const _vf = state._widgetReg[state._wtype].viewField;
    state._autoForm = renderWidgetConfigForm(d, state._widgetReg[state._wtype].fields || [], state._wAutoCfg, {
      widgetId: _wid,
      widgetType: state._wtype,
      size: state._wsize,
      /* A view switch can change which sizes are offered, and the tiles are
         drawn above this form. */
      onChange(key) {
        if (_vf && key === _vf) swapContent(body, () => _renderWidgetForm(body));
      },
    });
    state._autoFormType = state._wtype;
    state._autoFormSession = state._evSession;
  } else if (_mode === 'unavailable') _renderUnavailableConfig(body);
  else _renderCustomConfig(body);
}

/* Its stored settings are held on the server and not sent here. A save leaves
   them untouched. */
function _renderUnavailableConfig(body) {
  const card = document.createElement('div');
  card.className = 'grp';
  body.appendChild(card);
  setHtml(card, html`<div class="row"><span class="rl">${t('widgetCfg.unavailable')}</span></div>`);
  const tip = document.createElement('p');
  tip.className = 'grp-tip';
  tip.textContent = t('widgetCfg.unavailableTip', { type: state._wtype });
  body.appendChild(tip);

  const why = (state._widgetRejected || []).find(r => r && r.name === state._wtype);
  if (why) appendRejectionReasons(body, [why], { name: false });
}

/* Why the server refused a widget, as a list. `withName` is what differs: the
   editor shows one widget, the picker lists several. */
function appendRejectionReasons(target, rejections, { name: withName = true } = {}) {
  const lines = rejectionLines(rejections, { withName });
  if (!lines.length) return;
  const list = document.createElement('ul');
  list.className = 'grp-tip cfg-reject-list';
  for (const line of lines) {
    const li = document.createElement('li');
    /* textContent, never markup. A validator message carries names taken out of
       the manifest. */
    li.textContent = line;
    list.appendChild(li);
  }
  target.appendChild(list);
}

function _renderCustomConfig(body) {
  const card = document.createElement('div');
  card.className = 'grp';
  body.appendChild(card);
  setHtml(
    card,
    html`<div class="row ie-row" id="cust-url-row"><span class="rl">${t('widgetCfg.iframeUrl')} <span class="req">*</span></span><span class="rv${state._customUrl ? '' : ' is-ph'}">${state._customUrl ? state._customUrl : 'https://app.example.com/widget.html'}</span><input id="f-url" type="url" value="${state._customUrl || ''}" class="d-none"><button class="pe" type="button">${raw(PE_SVG)}</button></div>`,
  );
  const tip = document.createElement('p');
  tip.className = 'grp-tip';
  tip.textContent = t('widgetCfg.iframeTip');
  body.appendChild(tip);
  initInlineEdit('cust-url-row', 'f-url', {
    placeholder: 'https://app.example.com/widget.html',
    onCommit(v) {
      state._customUrl = v;
    },
  });

  const o = state._iframeOpts || {};
  const advHdr = document.createElement('p');
  advHdr.className = 'grp-hdr';
  advHdr.textContent = t('widgetCfg.advanced');
  body.appendChild(advHdr);
  const adv = document.createElement('div');
  adv.className = 'grp';
  body.appendChild(adv);
  const refOpts = [
    '',
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url',
  ].map(v => ({ value: v, label: v || 'Default' }));
  setHtml(
    adv,
    html`
    <div class="row" id="if-referrer-row"><span class="rl">${t('widgetCfg.referrerPolicy')}</span></div>
    <div class="row ie-row" id="if-allow-row"><span class="rl">${t('widgetCfg.allowFeaturePolicy')}</span><span class="rv${o.allow ? '' : ' is-ph'}">${o.allow ? o.allow : 'autoplay; fullscreen'}</span><input id="if-allow" type="text" value="${o.allow || ''}" class="d-none"><button class="pe" type="button">${raw(PE_SVG)}</button></div>
    <div class="row"><span class="rl">${t('widgetCfg.allowFullscreen')}</span><label class="tog"><input type="checkbox" id="if-fs" ${o.allowFullscreen !== false ? 'checked' : ''}><div class="tr"></div></label></div>
    <div class="row ie-row" id="if-refresh-row"><span class="rl">${t('widgetCfg.refreshInterval')} <span class="opt-span">(ms)</span></span><span class="rv${o.refreshInterval ? '' : ' is-ph'}">${o.refreshInterval ? o.refreshInterval : 'e.g. 2000'}</span><input id="if-refresh" type="number" min="250" step="250" value="${o.refreshInterval || ''}" class="d-none"><button class="pe" type="button">${raw(PE_SVG)}</button></div>`,
  );
  const refBox = createListbox({
    label: t('widgetCfg.referrerPolicy'),
    options: refOpts,
    value: o.referrerPolicy || '',
    onChange: () => sync(),
  });
  q('#if-referrer-row', adv).appendChild(refBox.el);

  const sync = () => {
    state._iframeOpts.referrerPolicy = refBox.getValue() || undefined;
    state._iframeOpts.allow = qi('#if-allow', adv).value.trim() || undefined;
    state._iframeOpts.allowFullscreen = qi('#if-fs', adv).checked;
    const ri = parseInt(qi('#if-refresh', adv).value, 10);
    state._iframeOpts.refreshInterval = ri && ri >= 250 ? ri : undefined;
  };
  q('#if-fs', adv).onchange = sync;
  initInlineEdit('if-allow-row', 'if-allow', {
    placeholder: 'autoplay; fullscreen',
    onCommit() {
      sync();
    },
  });
  initInlineEdit('if-refresh-row', 'if-refresh', {
    placeholder: 'e.g. 2000',
    onCommit() {
      sync();
    },
  });
}
