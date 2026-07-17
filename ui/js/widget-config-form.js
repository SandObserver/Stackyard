/* Renders a widget's declared `fields` into a settings-row config form and reads
   values back. Field types: text, secret, number, toggle, select, pills, multiselect, group.
   renderWidgetConfigForm(container, fields, config) -> { getValues, validate }
   Each builder returns { el, get, control, liveValue }; the public API is unchanged. */

import { html, raw, setHtml } from '/js/html.js?v=1';

const PE='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a1.85 1.85 0 0 1 2.6 2.6l-9.1 9.1-3.4 1 1-3.4z"/></svg>';
const CHEV='<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

function _tag(field){ return field.optional ? html` <span class="opt-span">(optional)</span>` : html` <span class="req">*</span>`; }

function _ieRow(field, value, inputType) {
  const has = value != null && value !== '';
  const ph = field.placeholder || '';
  const row = document.createElement('div'); row.className = 'row ie-row';
  setHtml(row, html`<span class="rl">${field.label}${_tag(field)}</span><span class="rv${has ? '' : ' is-ph'}">${has ? value : ph}</span><input class="row-inp" type="${inputType}" autocomplete="off" value="${has ? value : (field.default != null ? field.default : '')}" style="display:none"><button class="pe" type="button" aria-label="Edit ${field.label}">${raw(PE)}</button>`);
  const rv = row.querySelector('.rv'), inp = row.querySelector('.row-inp'), pe = row.querySelector('.pe');
  function open() { row.classList.add('editing'); inp.style.display = 'block'; inp.focus(); inp.select?.(); }
  function commit() {
    row.classList.remove('editing'); inp.style.display = 'none';
    const v = inp.value.trim();
    if (v) { rv.textContent = v; rv.classList.remove('is-ph'); } else { rv.textContent = ph; rv.classList.add('is-ph'); }
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  pe.addEventListener('click', open); rv.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  const get = () => {
    const v = inp.value.trim();
    if (v === '') return null;
    if (inputType === 'number') { const n = Number(v); return Number.isNaN(n) ? null : [field.key, n]; }
    return [field.key, v];
  };
  if (field.hint) { const w = document.createElement('div'); w.appendChild(row); const h = document.createElement('p'); h.className = 'grp-tip in-card'; h.textContent = field.hint; w.appendChild(h); return { el: w, get, control: inp, liveValue: () => inp.value }; }
  return { el: row, get, control: inp, liveValue: () => inp.value };
}

/* ── Secret: shows Configured / Not set, edit reveals a password input. Blank = keep. ── */
function _secret(field, isSet) {
  const row = document.createElement('div'); row.className = 'row ie-row';
  const display = isSet ? 'Configured' : 'Not set';
  setHtml(row, html`<span class="rl">${field.label}${_tag(field)}</span><span class="rv is-ph">${display}</span><input class="row-inp" type="password" autocomplete="new-password" placeholder="${isSet ? 'Enter new value to replace' : (field.placeholder || '')}" style="display:none"><button class="pe" type="button" aria-label="Edit ${field.label}">${raw(PE)}</button>`);
  const rv = row.querySelector('.rv'), inp = row.querySelector('.row-inp'), pe = row.querySelector('.pe');
  const open = () => { row.classList.add('editing'); inp.style.display = 'block'; inp.focus(); };
  const commit = () => { row.classList.remove('editing'); inp.style.display = 'none'; rv.textContent = inp.value ? 'New value set' : display; inp.dispatchEvent(new Event('change', { bubbles: true })); };
  pe.addEventListener('click', open); rv.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  const get = () => { const v = inp.value.trim(); return v === '' ? null : [field.key, v]; };
  const hint = isSet ? 'A value is saved. Enter a new one to replace it, or leave blank to keep it.' : field.hint;
  if (hint) { const w = document.createElement('div'); w.appendChild(row); const h = document.createElement('p'); h.className = 'grp-tip in-card'; h.textContent = hint; w.appendChild(h); return { el: w, get, control: inp, liveValue: () => inp.value }; }
  return { el: row, get, control: inp, liveValue: () => inp.value };
}

function _toggle(field, value) {
  const on = value != null ? !!value : !!field.default;
  const row = document.createElement('div'); row.className = 'row';
  setHtml(row, html`<span class="rl">${field.label}</span><label class="tog"><input type="checkbox"${on ? ' checked' : ''} aria-label="${field.label}"><div class="tr"></div></label>`);
  const input = row.querySelector('input');
  const get = () => [field.key, input.checked];
  if (field.hint) { const w = document.createElement('div'); w.appendChild(row); const h = document.createElement('p'); h.className = 'grp-tip in-card'; h.textContent = field.hint; w.appendChild(h); return { el: w, get, control: input, liveValue: () => input.checked }; }
  return { el: row, get, control: input, liveValue: () => input.checked };
}

function _select(field, value, ctx) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'row';
  let opts = Array.isArray(field.options) ? field.options.slice() : [];
  let chosen = value != null ? String(value) : (field.default != null ? String(field.default) : '');
  setHtml(row, html`<span class="rl">${field.label}${_tag(field)}</span>`);
  const selWrap = document.createElement('div'); selWrap.className = 'sel-wrap';
  const sel = document.createElement('select'); sel.className = 'row-sel';
  selWrap.appendChild(sel);
  const chevT = document.createElement('template'); setHtml(chevT, raw(CHEV)); selWrap.appendChild(chevT.content.firstElementChild);
  row.appendChild(selWrap); wrap.appendChild(row);

  function paint() {
    const items = opts.map(o => html`<option value="${o.value}"${String(o.value) === chosen ? ' selected' : ''}>${o.label != null ? o.label : o.value}</option>`);
    if (chosen && !opts.some(o => String(o.value) === chosen)) items.unshift(html`<option value="${chosen}" selected>${chosen}</option>`);
    if (field.optional) items.unshift(html`<option value="">None</option>`);
    setHtml(sel, items.length ? html`${items}` : html`<option value="">None</option>`);
  }
  paint();

  if (field.optionsFrom) {
    const fr = document.createElement('div'); fr.className = 'row';
    const status = document.createElement('span'); status.className = 'row-status'; status.textContent = field.hint || '';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'row-btn'; btn.textContent = 'Fetch';
    setHtml(fr, html`<span class="rl"></span>`); fr.appendChild(status); fr.appendChild(btn); wrap.appendChild(fr);
    btn.addEventListener('click', async () => {
      const cfg = ctx && ctx.getValues ? ctx.getValues() : {};
      const wid = (ctx && ctx.widgetId) || '__preview__';
      status.textContent = 'Fetching...'; status.className = 'row-status'; btn.disabled = true;
      try {
        const r = await fetch(`/api/widget-options/${encodeURIComponent(wid)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetType: ctx && ctx.widgetType, endpoint: field.optionsFrom, widgetConfig: cfg }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
        opts = Array.isArray(d.options) ? d.options : [];
        chosen = sel.value || chosen; paint();
        status.textContent = opts.length ? `Loaded ${opts.length} option${opts.length > 1 ? 's' : ''}` : 'No options found';
        status.className = 'row-status ok';
      } catch (e) { status.textContent = 'Fetch failed: ' + e.message; status.className = 'row-status err'; }
      finally { btn.disabled = false; }
    });
  } else if (field.hint) {
    const h = document.createElement('p'); h.className = 'grp-tip in-card'; h.textContent = field.hint; wrap.appendChild(h);
  }

  const get = () => [field.key, sel.value];
  return { el: wrap, get, control: sel, liveValue: () => sel.value };
}

function _pills(field, value) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'row';
  const opts = Array.isArray(field.options) ? field.options : [];
  let sel = value != null ? value : (field.default != null ? field.default : (opts[0] ? opts[0].value : ''));
  const name = 'wcf-' + field.key + '-' + Math.random().toString(36).slice(2, 7);
  setHtml(row, html`<span class="rl">${field.label}</span><div class="segr" role="group" aria-label="${field.label}">${opts.map(o => html`<label class="segr-opt"><input type="radio" name="${name}" value="${o.value}"${String(o.value) === String(sel) ? ' checked' : ''}><span class="segr-dot"></span><span>${o.label}</span></label>`)}</div>`);
  wrap.appendChild(row);
  const group = row.querySelector('.segr');
  group.querySelectorAll('input').forEach(r => r.addEventListener('change', () => { if (r.checked) { sel = r.value; group.dispatchEvent(new Event('change')); } }));
  if (field.hint) { const h = document.createElement('p'); h.className = 'grp-tip in-card'; h.textContent = field.hint; wrap.appendChild(h); }
  const get = () => [field.key, sel];
  return { el: wrap, get, control: group, liveValue: () => sel };
}

/* ── Multi-select → checklist dropdown (tap to toggle), value is array in declared order. ── */
function _multiselect(field, value) {
  const wrap = document.createElement('div');
  const row = document.createElement('div'); row.className = 'row';
  const opts = Array.isArray(field.options) ? field.options : [];
  const cur = new Set(Array.isArray(value) ? value.map(String) : (Array.isArray(field.default) ? field.default.map(String) : []));
  const summary = () => cur.size === 0 ? 'None selected' : cur.size + ' selected';
  setHtml(row, html`<span class="rl">${field.label}</span><div class="row-dd"><button class="row-dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="ms-sum">${summary()}</span>${raw(CHEV)}</button><ul class="row-dd-list checklist" role="listbox" aria-multiselectable="true" hidden>${opts.map(o => html`<li role="option" data-val="${o.value}" aria-selected="${String(cur.has(String(o.value)))}">${o.label}</li>`)}</ul></div>`);
  wrap.appendChild(row);
  const btn = row.querySelector('.row-dd-btn'), list = row.querySelector('.row-dd-list'), sumEl = row.querySelector('.ms-sum');
  btn.addEventListener('click', () => { const open = list.hidden; list.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
  list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
    const v = li.dataset.val, on = li.getAttribute('aria-selected') !== 'true';
    li.setAttribute('aria-selected', String(on)); if (on) cur.add(v); else cur.delete(v);
    sumEl.textContent = summary(); wrap.dispatchEvent(new Event('change'));
  }));
  document.addEventListener('click', e => { if (!row.contains(e.target)) { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  if (field.hint) { const h = document.createElement('p'); h.className = 'grp-tip in-card'; h.textContent = field.hint; wrap.appendChild(h); }
  const get = () => [field.key, opts.map(o => String(o.value)).filter(v => cur.has(v))];
  return { el: wrap, get, control: wrap, liveValue: () => [...cur] };
}

function _group(field, rows, size) {
  const min = field.min != null ? field.min : 0;
  const max = (field.maxBySize && size && field.maxBySize[size] != null)
    ? field.maxBySize[size]
    : (field.max != null ? field.max : 99);
  const subFields = Array.isArray(field.fields) ? field.fields : [];
  let data = Array.isArray(rows) ? rows.map(r => Object.assign({}, r)) : [];
  while (data.length < min) data.push({});
  if (data.length > max) data.length = max;

  const wrap = document.createElement('div'); wrap.className = 'wcf-group';
  const rowsHost = document.createElement('div'); wrap.appendChild(rowsHost);
  const addWrap = document.createElement('div'); addWrap.className = 'grp';
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'wcf-add-row';
  setHtml(addBtn, html`<span class="rl" style="color:var(--ac2)">+ Add ${field.label}</span>`);
  addWrap.appendChild(addBtn); wrap.appendChild(addWrap);
  if (field.hint) { const h = document.createElement('p'); h.className = 'grp-tip'; h.textContent = field.hint; wrap.appendChild(h); }

  let rowGetters = [];

  function render() {
    rowsHost.innerHTML = ''; rowGetters = [];
    data.forEach((rowData, idx) => {
      const hdr = document.createElement('p'); hdr.className = 'grp-hdr grp-hdr-row';
      setHtml(hdr, html`<span>${field.label} ${idx + 1}</span>`);
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'grp-hdr-rm'; rm.textContent = 'Remove';
      rm.disabled = data.length <= min;
      rm.onclick = () => { captureCurrent(); data.splice(idx, 1); render(); };
      hdr.appendChild(rm); rowsHost.appendChild(hdr);

      const card = document.createElement('div'); card.className = 'grp';
      const subGetters = [];
      for (const sf of subFields) {
        if (sf.type === 'group') continue;
        const built = _buildSimple(sf, rowData);
        card.appendChild(built.el);
        subGetters.push({ key: sf.key, get: built.get });
      }
      rowsHost.appendChild(card);
      rowGetters.push(subGetters);
    });
    addBtn.parentElement.style.display = data.length >= max ? 'none' : '';
  }

  function captureCurrent() {
    data = rowGetters.map(getters => {
      const obj = {};
      for (const g of getters) { const kv = g.get(); if (kv && kv[1] !== undefined) obj[kv[0]] = kv[1]; }
      return obj;
    });
  }

  addBtn.onclick = () => { captureCurrent(); data.push({}); render(); };
  render();

  const get = () => { captureCurrent(); return [field.key, data]; };
  return { el: wrap, get, control: null, liveValue: () => null, isGroup: true };
}

function _buildSimple(field, config, ctx) {
  const value = config[field.key];
  switch (field.type) {
    case 'secret': return _secret(field, config[field.key + 'Set'] === true);
    case 'number': return _ieRow(field, value, 'number');
    case 'toggle': return _toggle(field, value);
    case 'select': return field.variant === 'pills' ? _pills(field, value) : _select(field, value, ctx);
    case 'multiselect': return _multiselect(field, value);
    default:       return _ieRow(field, value, 'text');
  }
}

export function renderWidgetConfigForm(container, fields, config = {}, opts = {}) {
  container.innerHTML = '';
  const built = [];
  const liveByKey = {};
  const ctx = { widgetId: (opts && opts.widgetId) || null, widgetType: (opts && opts.widgetType) || null, getValues: null };

  /* Group consecutive simple fields into a card; group fields render as their own cards. */
  let card = null;
  const flush = () => { card = null; };
  for (const f of fields) {
    if (!f || !f.key) continue;
    if (f.type === 'group') {
      flush();
      const b = _group(f, config[f.key], opts && opts.size); b.field = f;
      container.appendChild(b.el); built.push(b);
      continue;
    }
    const b = _buildSimple(f, config, ctx); b.field = f;
    if (!card) { card = document.createElement('div'); card.className = 'grp'; container.appendChild(card); }
    card.appendChild(b.el);
    built.push(b);
    if (b.liveValue) liveByKey[f.key] = b.liveValue;
  }

  function condMatch(cond, cur) {
    if (Array.isArray(cond.in)) return cond.in.map(String).includes(String(cur));
    if (typeof cur === 'boolean') return cur === !!cond.equals;
    return String(cur) === String(cond.equals);
  }
  function applyShowIf() {
    for (const b of built) {
      const cond = b.field.showIf;
      if (!cond || !(cond.field in liveByKey)) continue;
      b.el.style.display = condMatch(cond, liveByKey[cond.field]()) ? '' : 'none';
    }
  }
  for (const b of built) {
    if (b.control) b.control.addEventListener('change', applyShowIf);
    if (b.control && b.control.tagName === 'INPUT' && (b.control.type === 'text' || b.control.type === 'number')) b.control.addEventListener('input', applyShowIf);
  }
  applyShowIf();

  function visible(b) { return b.el.style.display !== 'none'; }

  const api = {
    root: container,
    getValues() {
      const out = {};
      for (const b of built) {
        if (b.field.showIf && !visible(b)) continue;
        const kv = b.get();
        if (kv && kv[1] !== undefined) out[kv[0]] = kv[1];
      }
      return out;
    },
    validate() {
      const missing = [];
      for (const b of built) {
        if (b.field.optional || b.field.type === 'toggle' || b.field.type === 'group') continue;
        if (b.field.showIf && !visible(b)) continue;
        if (b.field.type === 'secret') continue;
        const kv = b.get();
        if (!kv || kv[1] === '' || kv[1] == null) missing.push(b.field.label);
      }
      return missing;
    },
  };
  ctx.getValues = api.getValues;
  return api;
}
