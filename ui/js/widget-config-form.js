/* Renders a widget's declared `fields` into a config form and reads the values
   back. Each builder returns { el, get, control, liveValue }. See
   docs/widgets.md. */

import { t } from '/js/i18n.js?v=d056c9c5';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { wireChecklist } from '/js/admin-shared.js?v=8f69dad6';
import { renderColorControl } from '/js/admin-color-control.js?v=984a0b69';
import {
  seedCarried,
  applyOptionSet,
  collectFieldValues,
  requiredFieldMissing,
  groupBounds,
  visibleFieldFlags,
} from '/js/admin-logic.js?v=ddfc6f80';
import { optionsErrorAdvice, TONE } from '/js/admin-error.js?v=10f3cdb1';
import { qi } from '/js/utils.js?v=b18c93ed';

const PE =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a1.85 1.85 0 0 1 2.6 2.6l-9.1 9.1-3.4 1 1-3.4z"/></svg>';
const CHEV =
  '<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

function _tag(field) {
  return field.optional ? html` <span class="opt-span">(optional)</span>` : html` <span class="req">*</span>`;
}

function _ieRow(field, value, inputType) {
  const has = value != null && value !== '';
  const ph = field.placeholder || '';
  const row = document.createElement('div');
  row.className = 'row ie-row';
  setHtml(
    row,
    html`<span class="rl">${field.label}${_tag(field)}</span><span class="rv${has ? '' : ' is-ph'}">${has ? value : ph}</span><input class="row-inp" type="${inputType}" autocomplete="off" value="${has ? value : field.default != null ? field.default : ''}" style="display:none"><button class="pe" type="button" aria-label="Edit ${field.label}">${raw(PE)}</button>`,
  );
  const rv = row.querySelector('.rv'),
    inp = qi('.row-inp', row),
    pe = row.querySelector('.pe');
  function open() {
    row.classList.add('editing');
    inp.style.display = 'block';
    inp.focus();
    inp.select?.();
  }
  function commit() {
    row.classList.remove('editing');
    inp.style.display = 'none';
    const v = inp.value.trim();
    if (v) {
      rv.textContent = v;
      rv.classList.remove('is-ph');
    } else {
      rv.textContent = ph;
      rv.classList.add('is-ph');
    }
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  pe.addEventListener('click', open);
  rv.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.blur();
    }
  });
  const get = () => {
    const v = inp.value.trim();
    if (v === '') return null;
    if (inputType === 'number') {
      const n = Number(v);
      return Number.isNaN(n) ? null : [field.key, n];
    }
    return [field.key, v];
  };
  if (field.hint) {
    const w = document.createElement('div');
    w.appendChild(row);
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = field.hint;
    w.appendChild(h);
    return { el: w, get, control: inp, liveValue: () => inp.value };
  }
  return { el: row, get, control: inp, liveValue: () => inp.value };
}

/* ── Secret: shows Configured / Not set, edit reveals a password input. Blank = keep. ── */
function _secret(field, isSet) {
  const row = document.createElement('div');
  row.className = 'row ie-row';
  const display = isSet ? t('common.configured') : t('common.notSet');
  setHtml(
    row,
    html`<span class="rl">${field.label}${_tag(field)}</span><span class="rv is-ph">${display}</span><input class="row-inp" type="password" autocomplete="new-password" placeholder="${isSet ? t('widgetCfg.replaceSecret') : field.placeholder || ''}" style="display:none"><button class="pe" type="button" aria-label="Edit ${field.label}">${raw(PE)}</button>`,
  );
  const rv = row.querySelector('.rv'),
    inp = qi('.row-inp', row),
    pe = row.querySelector('.pe');
  const open = () => {
    row.classList.add('editing');
    inp.style.display = 'block';
    inp.focus();
  };
  const commit = () => {
    row.classList.remove('editing');
    inp.style.display = 'none';
    rv.textContent = inp.value ? t('widgetCfg.newValueSet') : display;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  };
  pe.addEventListener('click', open);
  rv.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.blur();
    }
  });
  const get = () => {
    const v = inp.value.trim();
    return v === '' ? null : [field.key, v];
  };
  const hint = isSet ? t('widgetCfg.storedSecretHint') : field.hint;
  const api = { get, control: inp, liveValue: () => inp.value, hasStored: () => isSet };
  if (hint) {
    const w = document.createElement('div');
    w.appendChild(row);
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = hint;
    w.appendChild(h);
    return { el: w, ...api };
  }
  return { el: row, ...api };
}

function _toggle(field, value) {
  const on = value != null ? !!value : !!field.default;
  const row = document.createElement('div');
  row.className = 'row';
  setHtml(
    row,
    html`<span class="rl">${field.label}</span><label class="tog"><input type="checkbox"${on ? ' checked' : ''} aria-label="${field.label}"><div class="tr"></div></label>`,
  );
  const input = row.querySelector('input');
  const get = () => [field.key, input.checked];
  if (field.hint) {
    const w = document.createElement('div');
    w.appendChild(row);
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = field.hint;
    w.appendChild(h);
    return { el: w, get, control: input, liveValue: () => input.checked };
  }
  return { el: row, get, control: input, liveValue: () => input.checked };
}

async function _fetchOptions(field, ctx) {
  const cfg = ctx && ctx.getDraft ? ctx.getDraft() : {};
  const wid = (ctx && ctx.widgetId) || '__preview__';
  const r = await fetch(`/api/widget-options/${encodeURIComponent(wid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      widgetType: ctx && ctx.widgetType,
      endpoint: field.optionsFrom,
      widgetConfig: cfg,
      row: (ctx && ctx.row) || undefined,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    /* Carry the structured fields so the caller branches on `kind`, never on
       the message. */
    const err = /** @type {Error & { status?: number, kind?: string, detail?: Record<string, unknown> }} */ (
      new Error(d.error || 'HTTP ' + r.status)
    );
    err.status = r.status;
    if (typeof d.kind === 'string') err.kind = d.kind;
    if (d.detail && typeof d.detail === 'object') err.detail = d.detail;
    throw err;
  }
  return Array.isArray(d.options) ? d.options : [];
}

function _picklist(field, value, ctx, size) {
  const count =
    field.countBySize && size && field.countBySize[size] != null
      ? field.countBySize[size]
      : field.count != null
        ? field.count
        : 1;
  const rowLabel = field.rowLabel || field.label;
  const chosen = Array.isArray(value) ? value.slice(0, count) : [];
  while (chosen.length < count) chosen.push(null);

  const wrap = document.createElement('div');
  wrap.className = 'wcf-group';
  const hdr = document.createElement('p');
  hdr.className = 'grp-hdr';
  hdr.textContent = field.label;
  wrap.appendChild(hdr);
  const card = document.createElement('div');
  card.className = 'grp';
  wrap.appendChild(card);

  const fr = document.createElement('div');
  fr.className = 'row';
  const status = document.createElement('span');
  status.className = 'row-status';
  status.textContent = field.hint || '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row-btn';
  btn.textContent = field.fetchLabel || t('widgetCfg.fetch');
  setHtml(fr, html`<span class="rl"></span>`);
  fr.appendChild(status);
  fr.appendChild(btn);
  card.appendChild(fr);

  let opts = Array.isArray(field.options) ? field.options.slice() : [];
  const sels = [];
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    setHtml(row, html`<span class="rl">${rowLabel} ${i + 1}</span>`);
    const selWrap = document.createElement('div');
    selWrap.className = 'sel-wrap';
    const sel = document.createElement('select');
    sel.className = 'row-sel';
    sel.setAttribute('aria-label', `${rowLabel} ${i + 1}`);
    selWrap.appendChild(sel);
    const chevT = document.createElement('template');
    setHtml(chevT, raw(CHEV));
    selWrap.appendChild(chevT.content.firstElementChild);
    row.appendChild(selWrap);
    card.appendChild(row);
    sels.push(sel);
  }

  function paint() {
    sels.forEach((sel, i) => {
      const cur = sel.value || (chosen[i] != null ? String(chosen[i]) : '');
      const items = opts.map(
        o =>
          html`<option value="${o.value}"${String(o.value) === cur ? ' selected' : ''}>${o.label != null ? o.label : o.value}</option>`,
      );
      if (cur && !opts.some(o => String(o.value) === cur))
        items.unshift(html`<option value="${cur}" selected>${cur}</option>`);
      items.unshift(html`<option value=""${cur ? '' : ' selected'}>${t('widgetCfg.empty')}</option>`);
      setHtml(sel, html`${items}`);
    });
  }
  paint();

  if (field.optionsFrom) {
    btn.addEventListener('click', async () => {
      status.textContent = t('widgetCfg.fetching');
      status.className = 'row-status';
      btn.disabled = true;
      try {
        opts = await _fetchOptions(field, ctx);
        paint();
        status.textContent = opts.length
          ? t(opts.length === 1 ? 'widgetCfg.loaded' : 'widgetCfg.loadedPlural', { n: opts.length })
          : t('widgetCfg.noOptions');
        status.className = 'row-status ok';
      } catch (e) {
        const advice = optionsErrorAdvice(e);
        status.textContent = advice.message;
        status.className = 'row-status ' + (advice.tone === TONE.WARN ? 'warn' : 'err');
      } finally {
        btn.disabled = false;
      }
    });
  } else {
    btn.style.display = 'none';
  }

  const get = () => [field.key, sels.map(s => s.value || null)];
  return { el: wrap, get, control: null, liveValue: () => null };
}

function _select(field, value, ctx, config = {}) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  let opts = Array.isArray(field.options) ? field.options.slice() : [];
  const carryKeys = Array.isArray(field.carries) ? field.carries : [];
  let carried = seedCarried(config, carryKeys);
  let chosen = value != null ? String(value) : field.default != null ? String(field.default) : '';
  setHtml(row, html`<span class="rl">${field.label}${_tag(field)}</span>`);
  const selWrap = document.createElement('div');
  selWrap.className = 'sel-wrap';
  const sel = document.createElement('select');
  sel.className = 'row-sel';
  selWrap.appendChild(sel);
  const chevT = document.createElement('template');
  setHtml(chevT, raw(CHEV));
  selWrap.appendChild(chevT.content.firstElementChild);
  row.appendChild(selWrap);
  wrap.appendChild(row);

  function paint() {
    const items = opts.map(
      o =>
        html`<option value="${o.value}"${String(o.value) === chosen ? ' selected' : ''}>${o.label != null ? o.label : o.value}</option>`,
    );
    if (chosen && !opts.some(o => String(o.value) === chosen))
      items.unshift(html`<option value="${chosen}" selected>${chosen}</option>`);
    if (field.optional) items.unshift(html`<option value="">None</option>`);
    setHtml(sel, items.length ? html`${items}` : html`<option value="">None</option>`);
  }
  paint();

  function syncCarried() {
    if (!carryKeys.length) return;
    carried = applyOptionSet(
      carried,
      opts.find(x => String(x.value) === sel.value),
      carryKeys,
    );
  }
  sel.addEventListener('change', syncCarried);

  if (field.optionsFrom) {
    const fr = document.createElement('div');
    fr.className = 'row';
    const status = document.createElement('span');
    status.className = 'row-status';
    status.textContent = field.hint || '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-btn';
    btn.textContent = t('widgetCfg.fetch');
    setHtml(fr, html`<span class="rl"></span>`);
    fr.appendChild(status);
    fr.appendChild(btn);
    wrap.appendChild(fr);
    btn.addEventListener('click', async () => {
      status.textContent = t('widgetCfg.fetching');
      status.className = 'row-status';
      btn.disabled = true;
      try {
        opts = await _fetchOptions(field, ctx);
        chosen = sel.value || chosen;
        paint();
        syncCarried();
        status.textContent = opts.length
          ? t(opts.length === 1 ? 'widgetCfg.loaded' : 'widgetCfg.loadedPlural', { n: opts.length })
          : t('widgetCfg.noOptions');
        status.className = 'row-status ok';
      } catch (e) {
        const advice = optionsErrorAdvice(e);
        status.textContent = advice.message;
        status.className = 'row-status ' + (advice.tone === TONE.WARN ? 'warn' : 'err');
      } finally {
        btn.disabled = false;
      }
    });
  } else if (field.hint) {
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = field.hint;
    wrap.appendChild(h);
  }

  const get = () => [field.key, sel.value, carryKeys.length ? carried : null];
  return { el: wrap, get, control: sel, liveValue: () => sel.value };
}

function _pills(field, value) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  const opts = Array.isArray(field.options) ? field.options : [];
  let sel = value != null ? value : field.default != null ? field.default : opts[0] ? opts[0].value : '';
  const name = 'wcf-' + field.key + '-' + Math.random().toString(36).slice(2, 7);
  setHtml(
    row,
    html`<span class="rl">${field.label}</span><div class="segr" role="group" aria-label="${field.label}">${opts.map(o => html`<label class="segr-opt"><input type="radio" name="${name}" value="${o.value}"${String(o.value) === String(sel) ? ' checked' : ''}><span class="segr-dot"></span><span>${o.label}</span></label>`)}</div>`,
  );
  wrap.appendChild(row);
  const group = row.querySelector('.segr');
  group.querySelectorAll('input').forEach(r =>
    r.addEventListener('change', () => {
      if (r.checked) {
        sel = r.value;
        group.dispatchEvent(new Event('change'));
      }
    }),
  );
  if (field.hint) {
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = field.hint;
    wrap.appendChild(h);
  }
  const get = () => [field.key, sel];
  return { el: wrap, get, control: group, liveValue: () => sel };
}

/* ── Multi-select → checklist dropdown (tap to toggle), value is array in declared order. ── */
function _multiselect(field, value) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  const opts = Array.isArray(field.options) ? field.options : [];
  const cur = new Set(
    Array.isArray(value) ? value.map(String) : Array.isArray(field.default) ? field.default.map(String) : [],
  );
  const summary = () => (cur.size === 0 ? 'None selected' : cur.size + ' selected');
  setHtml(
    row,
    html`<span class="rl">${field.label}</span><div class="row-dd"><button class="row-dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="ms-sum">${summary()}</span>${raw(CHEV)}</button><ul class="row-dd-list checklist" role="listbox" aria-multiselectable="true" hidden>${opts.map(o => html`<li role="option" data-val="${o.value}" aria-selected="${String(cur.has(String(o.value)))}">${o.label}</li>`)}</ul></div>`,
  );
  wrap.appendChild(row);
  const dd = row.querySelector('.row-dd');
  const btn = row.querySelector('.row-dd-btn'),
    list = row.querySelector('.row-dd-list'),
    sumEl = row.querySelector('.ms-sum');
  wireChecklist(dd, btn, list, li => {
    const v = li.dataset.val,
      on = li.getAttribute('aria-selected') !== 'true';
    li.setAttribute('aria-selected', String(on));
    if (on) cur.add(v);
    else cur.delete(v);
    sumEl.textContent = summary();
    wrap.dispatchEvent(new Event('change'));
  });
  if (field.hint) {
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = field.hint;
    wrap.appendChild(h);
  }
  const get = () => [field.key, opts.map(o => String(o.value)).filter(v => cur.has(v))];
  return { el: wrap, get, control: wrap, liveValue: () => [...cur] };
}

/* The wrapper gives `showIf` one element to hide. The control appends several
   rows. */
function _color(field, value) {
  const wrap = document.createElement('div');
  const idPrefix =
    'wcf-' + String(field.key).replace(/[^a-zA-Z0-9_-]/g, '') + '-' + Math.random().toString(36).slice(2, 7);
  const initial =
    value != null && value !== '' ? String(value) : field.default != null ? String(field.default) : '#0289ff';
  const ctl = renderColorControl(wrap, {
    value: initial,
    idPrefix,
    label: field.label,
    onChange: () => wrap.dispatchEvent(new Event('change')),
  });
  if (field.hint) {
    const h = document.createElement('p');
    h.className = 'grp-tip in-card';
    h.textContent = field.hint;
    wrap.appendChild(h);
  }
  const get = () => [field.key, ctl.getValue()];
  return { el: wrap, get, control: wrap, liveValue: () => ctl.getValue() };
}

function _visible(b) {
  return b.el.style.display !== 'none';
}

function _missingIn(built) {
  const out = [];
  for (const b of built) {
    if (b.field.showIf && !_visible(b)) continue;
    if (b.field.type === 'secret' && !b.field.optional) {
      /* Blank means "keep the stored value". */
      if (!b.get() && !b.hasStored()) out.push(b.field.label);
      continue;
    }
    if (requiredFieldMissing(b.field, b.get())) out.push(b.field.label);
  }
  return out;
}

function _wireShowIf(built) {
  /* Null prototype. A showIf naming "toString" would otherwise resolve to
     Object.prototype.toString and be called as a field reader. */
  const liveByKey = Object.create(null);
  for (const b of built) if (b.liveValue) liveByKey[b.field.key] = b.liveValue;
  const fields = built.map(b => b.field);
  const readValue = key => (liveByKey[key] ? liveByKey[key]() : undefined);
  const apply = () => {
    const shown = visibleFieldFlags(fields, readValue);
    built.forEach((b, i) => {
      if (!b.field.showIf) return;
      b.el.style.display = shown[i] ? '' : 'none';
    });
  };
  for (const b of built) {
    if (b.control) b.control.addEventListener('change', apply);
    if (b.control && b.control.tagName === 'INPUT' && (b.control.type === 'text' || b.control.type === 'number'))
      b.control.addEventListener('input', apply);
  }
  apply();
}

function _object(field, value, ctx) {
  const cfg = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const wrap = document.createElement('div');
  const hdr = document.createElement('p');
  hdr.className = 'grp-hdr';
  hdr.textContent = field.label;
  wrap.appendChild(hdr);
  const card = document.createElement('div');
  card.className = 'grp';
  wrap.appendChild(card);

  const subCtx = {
    widgetId: ctx && ctx.widgetId,
    widgetType: ctx && ctx.widgetType,
    getDraft: () => (ctx && ctx.getDraft ? ctx.getDraft() : {}),
  };
  const built = [];
  for (const sf of Array.isArray(field.fields) ? field.fields : []) {
    if (sf.type === 'group' || sf.type === 'object') continue;
    const b = _buildSimple(sf, cfg, subCtx);
    b.field = sf;
    card.appendChild(b.el);
    built.push(b);
  }
  _wireShowIf(built);
  if (field.hint) {
    const h = document.createElement('p');
    h.className = 'grp-tip';
    h.textContent = field.hint;
    wrap.appendChild(h);
  }

  const get = () => [
    field.key,
    collectFieldValues(built.map(b => ({ field: b.field, visible: _visible(b), kv: b.get() }))),
  ];
  return { el: wrap, get, control: null, liveValue: () => null, missing: () => _missingIn(built) };
}

function _group(field, rows, size, ctx) {
  const { min, max } = groupBounds(field, size);
  const subFields = Array.isArray(field.fields) ? field.fields : [];
  let data = Array.isArray(rows) ? rows.map(r => Object.assign({}, r)) : [];
  while (data.length < min) data.push({});
  if (data.length > max) data.length = max;

  const wrap = document.createElement('div');
  wrap.className = 'wcf-group';
  const rowsHost = document.createElement('div');
  wrap.appendChild(rowsHost);
  const addWrap = document.createElement('div');
  addWrap.className = 'grp';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'wcf-add-row';
  setHtml(addBtn, html`<span class="rl" style="color:var(--ac2)">+ Add ${field.label}</span>`);
  addWrap.appendChild(addBtn);
  wrap.appendChild(addWrap);
  const fixed = min === max;
  if (fixed) addWrap.style.display = 'none';
  if (field.hint) {
    const h = document.createElement('p');
    h.className = 'grp-tip';
    h.textContent = field.hint;
    wrap.appendChild(h);
  }

  let rowBuilt = [];

  function render() {
    rowsHost.innerHTML = '';
    rowBuilt = [];
    data.forEach((rowData, idx) => {
      const hdr = document.createElement('p');
      hdr.className = 'grp-hdr grp-hdr-row';
      setHtml(hdr, html`<span>${field.label} ${idx + 1}</span>`);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'grp-hdr-rm';
      rm.textContent = t('widgetCfg.remove');
      rm.disabled = data.length <= min;
      if (fixed) rm.style.display = 'none';
      rm.onclick = () => {
        captureCurrent();
        data.splice(idx, 1);
        render();
      };
      hdr.appendChild(rm);
      rowsHost.appendChild(hdr);

      const card = document.createElement('div');
      card.className = 'grp';
      /* Read through ctx, never copied. The form assigns it only once every
         field is built. */
      const rowCtx = {
        widgetId: ctx && ctx.widgetId,
        widgetType: ctx && ctx.widgetType,
        row: { key: field.key, index: idx },
        getDraft: () => (ctx && ctx.getDraft ? ctx.getDraft() : {}),
      };
      const built = [];
      for (const sf of subFields) {
        if (sf.type === 'group' || sf.type === 'object') continue;
        const b = _buildSimple(sf, rowData, rowCtx);
        b.field = sf;
        card.appendChild(b.el);
        built.push(b);
      }
      _wireShowIf(built);
      rowsHost.appendChild(card);
      rowBuilt.push(built);
    });
    if (!fixed) addBtn.parentElement.style.display = data.length >= max ? 'none' : '';
  }

  function captureCurrent() {
    data = rowBuilt.map(built =>
      collectFieldValues(built.map(b => ({ field: b.field, visible: _visible(b), kv: b.get() }))),
    );
  }

  addBtn.onclick = () => {
    captureCurrent();
    data.push({});
    render();
  };
  render();

  const get = () => {
    captureCurrent();
    return [field.key, data];
  };
  const missing = () => rowBuilt.flatMap((built, i) => _missingIn(built).map(l => `${l} (${field.label} ${i + 1})`));
  return { el: wrap, get, control: null, liveValue: () => null, isGroup: true, missing };
}

function _buildSimple(field, config, ctx) {
  const value = config[field.key];
  switch (field.type) {
    case 'secret':
      return _secret(field, config[field.key + 'Set'] === true);
    case 'number':
      return _ieRow(field, value, 'number');
    case 'toggle':
      return _toggle(field, value);
    case 'color':
      return _color(field, value);
    case 'select':
      return field.variant === 'pills' ? _pills(field, value) : _select(field, value, ctx, config);
    case 'multiselect':
      return _multiselect(field, value);
    case 'picklist':
      return _picklist(field, value, ctx, ctx && ctx.size);
    default:
      return _ieRow(field, value, 'text');
  }
}

export function renderWidgetConfigForm(container, fields, config = {}, opts = {}) {
  container.innerHTML = '';
  const built = [];
  const ctx = {
    widgetId: (opts && opts.widgetId) || null,
    widgetType: (opts && opts.widgetType) || null,
    size: (opts && opts.size) || null,
    getDraft: null,
  };
  const notify = key => {
    if (typeof opts.onChange === 'function') opts.onChange(key);
  };

  let card = null;
  const flush = () => {
    card = null;
  };
  for (const f of fields) {
    if (!f || !f.key) continue;
    if (f.type === 'group' || f.type === 'object') {
      flush();
      const b = f.type === 'group' ? _group(f, config[f.key], opts && opts.size, ctx) : _object(f, config[f.key], ctx);
      b.field = f;
      container.appendChild(b.el);
      built.push(b);
      continue;
    }
    const b = _buildSimple(f, config, ctx);
    b.field = f;
    if (!card) {
      card = document.createElement('div');
      card.className = 'grp';
      container.appendChild(card);
    }
    card.appendChild(b.el);
    if (b.control) b.control.addEventListener('change', () => notify(f.key));
    built.push(b);
  }

  _wireShowIf(built);

  const api = {
    root: container,
    getValues(readOpts = {}) {
      return collectFieldValues(
        built.map(b => ({ field: b.field, visible: _visible(b), kv: b.get() })),
        readOpts,
      );
    },
    validate() {
      const missing = _missingIn(built);
      for (const b of built) {
        if (b.missing && (!b.field.showIf || _visible(b))) missing.push(...b.missing());
      }
      return missing;
    },
  };
  ctx.getDraft = () => api.getValues({ includeTransient: true });
  return api;
}
