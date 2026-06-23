/* Renders a widget's declared `fields` into a config form and reads values back.
   Field types: text, secret, number, toggle, select, group.
   renderWidgetConfigForm(container, fields, config) -> { getValues, validate } */

import { esc } from '/js/utils.js?v=37';

function _labelHtml(field) {
  const tag = field.optional ? ' <span class="opt-span">(optional)</span>' : ' <span class="req">*</span>';
  return `<label>${esc(field.label)}${tag}</label>`;
}

/* ── Simple field builders. Each returns { el, get, control } where get()
   yields [key, value] (or null to omit), and control is the live input. ── */

function _textLike(field, value, inputType) {
  const row = document.createElement('div'); row.className = 'fr';
  row.innerHTML = _labelHtml(field) +
    `<input class="fc" type="${inputType}" autocomplete="off"` +
    (field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : '') +
    ` value="${esc(value != null ? value : (field.default != null ? field.default : ''))}">` +
    (field.hint ? `<div class="hint">${esc(field.hint)}</div>` : '');
  const input = row.querySelector('input');
  const get = () => {
    const v = input.value.trim();
    return v === '' ? null : [field.key, v];
  };
  return { el: row, get, control: input, liveValue: () => input.value };
}

function _number(field, value) {
  const row = document.createElement('div'); row.className = 'fr';
  const attrs = ['min', 'max', 'step'].filter(a => field[a] != null).map(a => `${a}="${esc(field[a])}"`).join(' ');
  row.innerHTML = _labelHtml(field) +
    `<input class="fc" type="number" ${attrs}` +
    (field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : '') +
    ` value="${esc(value != null ? value : (field.default != null ? field.default : ''))}">` +
    (field.hint ? `<div class="hint">${esc(field.hint)}</div>` : '');
  const input = row.querySelector('input');
  const get = () => {
    const v = input.value.trim();
    if (v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : [field.key, n];
  };
  return { el: row, get, control: input, liveValue: () => input.value };
}

function _secret(field, isSet) {
  const row = document.createElement('div'); row.className = 'fr';
  const placeholder = isSet ? '••••••••  (saved — leave blank to keep)' : (field.placeholder || '');
  const hint = isSet
    ? 'A value is saved. Enter a new one to replace it, or leave blank to keep it.'
    : (field.hint || '');
  row.innerHTML = _labelHtml(field) +
    `<input class="fc" type="password" autocomplete="new-password" placeholder="${esc(placeholder)}">` +
    (hint ? `<div class="hint">${esc(hint)}</div>` : '');
  const input = row.querySelector('input');
  /* Blank → omit, so the server preserves the stored secret. */
  const get = () => {
    const v = input.value.trim();
    return v === '' ? null : [field.key, v];
  };
  return { el: row, get, control: input, liveValue: () => input.value };
}

function _toggle(field, value) {
  const on = value != null ? !!value : !!field.default;
  const row = document.createElement('div'); row.className = 'trow';
  row.innerHTML =
    `<div><div class="tlbl">${esc(field.label)}</div>` +
    (field.hint ? `<div class="tdsc">${esc(field.hint)}</div>` : '') + `</div>` +
    `<label class="tog"><input type="checkbox"${on ? ' checked' : ''} aria-label="${esc(field.label)}"><div class="tr"></div></label>`;
  const input = row.querySelector('input');
  const get = () => [field.key, input.checked];
  return { el: row, get, control: input, liveValue: () => input.checked };
}

function _select(field, value, ctx) {
  const row = document.createElement('div'); row.className = 'fr';
  let opts = Array.isArray(field.options) ? field.options.slice() : [];
  let chosen = value != null ? String(value) : (field.default != null ? String(field.default) : '');
  row.innerHTML = _labelHtml(field);
  const line = document.createElement('div'); line.style.cssText = 'display:flex;gap:8px;align-items:center';
  const sel = document.createElement('select'); sel.className = 'fc'; sel.style.flex = '1'; sel.style.minWidth = '0';
  line.appendChild(sel); row.appendChild(line);

  function paint() {
    let html = opts.map(o => `<option value="${esc(o.value)}"${String(o.value) === chosen ? ' selected' : ''}>${esc(o.label != null ? o.label : o.value)}</option>`).join('');
    if (chosen && !opts.some(o => String(o.value) === chosen)) html = `<option value="${esc(chosen)}" selected>${esc(chosen)}</option>` + html;
    if (field.optional) html = `<option value="">\u2014</option>` + html;
    sel.innerHTML = html || `<option value="">\u2014</option>`;
  }
  paint();

  if (field.optionsFrom) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn bg sm'; btn.textContent = 'Fetch';
    btn.style.flexShrink = '0'; btn.style.whiteSpace = 'nowrap'; line.appendChild(btn);
    const status = document.createElement('div'); status.className = 'hint'; status.style.marginTop = '4px'; row.appendChild(status);
    if (field.hint) status.textContent = field.hint;
    btn.addEventListener('click', async () => {
      const cfg = ctx && ctx.getValues ? ctx.getValues() : {};
      const wid = (ctx && ctx.widgetId) || '__preview__';
      status.textContent = 'Fetching\u2026'; btn.disabled = true;
      try {
        const r = await fetch(`/api/widget-options/${encodeURIComponent(wid)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetType: ctx && ctx.widgetType, endpoint: field.optionsFrom, widgetConfig: cfg }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
        opts = Array.isArray(d.options) ? d.options : [];
        chosen = sel.value || chosen; paint();
        status.textContent = opts.length ? `Loaded ${opts.length} list${opts.length > 1 ? 's' : ''}` : 'No lists found';
      } catch (e) { status.textContent = 'Fetch failed: ' + e.message; }
      finally { btn.disabled = false; }
    });
  } else if (field.hint) {
    const h = document.createElement('div'); h.className = 'hint'; h.textContent = field.hint; row.appendChild(h);
  }

  const get = () => [field.key, sel.value];
  return { el: row, get, control: sel, liveValue: () => sel.value };
}

/* Segmented pill control (variant:"pills") — same look as the widget size picker.
   Dispatches 'change' on click so the showIf wiring re-evaluates. */
function _pills(field, value) {
  const row = document.createElement('div'); row.className = 'fr';
  const opts = Array.isArray(field.options) ? field.options : [];
  let sel = value != null ? value : (field.default != null ? field.default : (opts[0] ? opts[0].value : ''));
  row.innerHTML = _labelHtml(field) + (field.hint ? `<div class="hint">${esc(field.hint)}</div>` : '');
  const group = document.createElement('div');
  group.className = 'wtype-row'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', field.label);
  opts.forEach(o => {
    const b = document.createElement('button'); b.type = 'button';
    const on = String(o.value) === String(sel);
    b.className = 'wchip' + (on ? ' on' : ''); b.textContent = o.label;
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      sel = o.value;
      group.querySelectorAll('.wchip').forEach(c => { const a = c === b; c.classList.toggle('on', a); c.setAttribute('aria-pressed', String(a)); });
      group.dispatchEvent(new Event('change'));
    });
    group.appendChild(b);
  });
  const hint = row.querySelector('.hint');
  if (hint) row.insertBefore(group, hint); else row.appendChild(group);
  const get = () => [field.key, sel];
  return { el: row, get, control: group, liveValue: () => sel };
}

/* ── Multi-select: like pills, but each chip toggles independently and the
   value is the array of selected option values (in declared order). ── */

function _multiselect(field, value) {
  const row = document.createElement('div'); row.className = 'fr';
  const opts = Array.isArray(field.options) ? field.options : [];
  const cur = new Set(
    Array.isArray(value) ? value.map(String)
    : (Array.isArray(field.default) ? field.default.map(String) : [])
  );
  row.innerHTML = _labelHtml(field) + (field.hint ? `<div class="hint">${esc(field.hint)}</div>` : '');
  const group = document.createElement('div');
  group.className = 'wtype-row'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', field.label);
  opts.forEach(o => {
    const b = document.createElement('button'); b.type = 'button';
    const on = cur.has(String(o.value));
    b.className = 'wchip' + (on ? ' on' : ''); b.textContent = o.label;
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const nowOn = !b.classList.contains('on');
      b.classList.toggle('on', nowOn); b.setAttribute('aria-pressed', String(nowOn));
      if (nowOn) cur.add(String(o.value)); else cur.delete(String(o.value));
      group.dispatchEvent(new Event('change'));
    });
    group.appendChild(b);
  });
  const hint = row.querySelector('.hint');
  if (hint) row.insertBefore(group, hint); else row.appendChild(group);
  const get = () => [field.key, opts.map(o => String(o.value)).filter(v => cur.has(v))];
  return { el: row, get, control: group, liveValue: () => [...cur] };
}

/* ── Repeatable group: a stack of removable rows, each holding the group's
   sub-fields, with an Add button bounded by min/max. ── */

function _group(field, rows) {
  const min = field.min != null ? field.min : 0;
  const max = field.max != null ? field.max : 99;
  const subFields = Array.isArray(field.fields) ? field.fields : [];
  let data = Array.isArray(rows) ? rows.map(r => Object.assign({}, r)) : [];
  while (data.length < min) data.push({});

  const wrap = document.createElement('div'); wrap.className = 'wcf-group';
  const head = document.createElement('div'); head.className = 'stl'; head.textContent = field.label;
  wrap.appendChild(head);
  if (field.hint) { const h = document.createElement('div'); h.className = 'hint'; h.style.marginBottom = '10px'; h.textContent = field.hint; wrap.appendChild(h); }
  const rowsHost = document.createElement('div'); wrap.appendChild(rowsHost);
  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'wcf-add'; addBtn.textContent = '+ Add ' + field.label;
  wrap.appendChild(addBtn);

  let rowGetters = [];

  function render() {
    rowsHost.innerHTML = ''; rowGetters = [];
    data.forEach((rowData, idx) => {
      const card = document.createElement('div'); card.className = 'wcf-row';
      const bar = document.createElement('div'); bar.className = 'wcf-row-bar';
      bar.innerHTML = `<span class="wcf-row-title">${esc(field.label)} ${idx + 1}</span>`;
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'wcf-remove'; rm.textContent = 'Remove';
      rm.disabled = data.length <= min;
      rm.onclick = () => { captureCurrent(); data.splice(idx, 1); render(); };
      bar.appendChild(rm); card.appendChild(bar);

      const subGetters = [];
      for (const sf of subFields) {
        if (sf.type === 'group') continue; /* nested groups not allowed */
        const built = _buildSimple(sf, rowData);
        card.appendChild(built.el);
        subGetters.push({ key: sf.key, get: built.get });
      }
      rowsHost.appendChild(card);
      rowGetters.push(subGetters);
    });
    addBtn.style.display = data.length >= max ? 'none' : '';
  }

  /* Pull current DOM values back into `data` before structural changes so edits
     aren't lost on add/remove. */
  function captureCurrent() {
    data = rowGetters.map(getters => {
      const obj = {};
      for (const g of getters) { const kv = g.get(); if (kv && kv[1] !== undefined) obj[kv[0]] = kv[1]; }
      return obj;
    });
  }

  addBtn.onclick = () => { captureCurrent(); data.push({}); render(); };
  render();

  const get = () => {
    captureCurrent();
    return [field.key, data];
  };
  return { el: wrap, get, control: null, liveValue: () => null };
}

/* Build a non-group field. */
function _buildSimple(field, config, ctx) {
  const value = config[field.key];
  switch (field.type) {
    case 'secret': return _secret(field, config[field.key + 'Set'] === true);
    case 'number': return _number(field, value);
    case 'toggle': return _toggle(field, value);
    case 'select': return field.variant === 'pills' ? _pills(field, value) : _select(field, value, ctx);
    case 'multiselect': return _multiselect(field, value);
    case 'text':
    default:       return _textLike(field, value, 'text');
  }
}

export function renderWidgetConfigForm(container, fields, config = {}, opts = {}) {
  container.innerHTML = '';
  const built = [];          /* { field, el, get, liveValue } */
  const liveByKey = {};
  const ctx = { widgetId: (opts && opts.widgetId) || null, widgetType: (opts && opts.widgetType) || null, getValues: null };

  for (const f of fields) {
    if (!f || !f.key) continue;
    const b = f.type === 'group' ? _group(f, config[f.key]) : _buildSimple(f, config, ctx);
    b.field = f;
    container.appendChild(b.el);
    built.push(b);
    if (b.liveValue) liveByKey[f.key] = b.liveValue;
  }

  /* showIf: live show/hide a field based on another top-level field's value. */
  function applyShowIf() {
    for (const b of built) {
      const cond = b.field.showIf;
      if (!cond || !(cond.field in liveByKey)) continue;
      const cur = liveByKey[cond.field]();
      const match = (typeof cur === 'boolean') ? (cur === !!cond.equals) : (String(cur) === String(cond.equals));
      b.el.style.display = match ? '' : 'none';
    }
  }
  for (const b of built) {
    if (b.control) b.control.addEventListener('change', applyShowIf);
    if (b.control && b.control.tagName === 'INPUT' && b.control.type === 'text') b.control.addEventListener('input', applyShowIf);
  }
  applyShowIf();

  function visible(b) { return b.el.style.display !== 'none'; }

  const api = {
    root: container,
    getValues() {
      const out = {};
      for (const b of built) {
        if (b.field.showIf && !visible(b)) continue; /* hidden fields don't contribute */
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
        if (b.field.type === 'secret') continue; /* blank secret = keep existing */
        const kv = b.get();
        if (!kv || kv[1] === '' || kv[1] == null) missing.push(b.field.label);
      }
      return missing;
    },
  };
  ctx.getValues = api.getValues; /* lets optionsFrom Fetch read the in-progress config */
  return api;
}
