/* Admin UI: shared foundation.
   Stateless helpers and constants used across the admin modules. No shared
   mutable state lives here; that stays in the main module. */
import { html, raw, setHtml } from '/js/html.js?v=ccec347c';
import { nextActiveIndex } from '/js/admin-logic.js?v=056a11e9';
import { el, qa, inp as inpById, q } from '/js/utils.js?v=17424946';

export const API = '';

let tt;
export const toast = (m, t = 'ok') => {
  const e = el('toast'); e.textContent = m;
  e.className = `show ${t}`; clearTimeout(tt); tt = setTimeout(() => e.className = '', 3000);
};

/* Fetch helpers. Throw a tagged 401 so callers can redirect to login.

   The API sends { error, kind, detail? } on failure (docs/api-errors.md). Carry
   `kind` and `detail` onto the thrown Error so callers branch on data instead of
   reading the message text. `ag` now also reads the body on a non-401 failure,
   so its message is the server's sentence rather than a bare 'HTTP 500'; every
   caller only displays it. */
/** An error carrying the API's structured fields. `kind` is the machine-readable
    classification the backend sends alongside the message; see docs/api-errors.md.
    @typedef {Error & { status?: number, kind?: string, detail?: Record<string, unknown> }} ApiError */

/** @param {number} status @param {any} body @returns {ApiError} */
function tagged(status, body) {
  const e = /** @type {ApiError} */ (new Error((body && body.error) || 'HTTP ' + status));
  e.status = status;
  if (body && typeof body.kind === 'string') e.kind = body.kind;
  if (body && body.detail && typeof body.detail === 'object') e.detail = body.detail;
  return e;
}
export const ag = async p => {
  const r = await fetch(API + p, { cache:'no-store' });
  if (!r.ok) {
    const d = r.status === 401 ? null : await r.json().catch(() => null);
    throw tagged(r.status, d || (r.status === 401 ? { error:'Unauthorised', kind:'auth' } : null));
  }
  return r.json();
};
export const ap = async (p, b) => {
  const r = await fetch(API + p, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(b) });
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw tagged(r.status, d || (r.status === 401 ? { error:'Unauthorised', kind:'auth' } : null));
  }
  return r.json();
};

/* Mark a .tog toggle unavailable without removing it from the accessibility
   tree. A native `disabled` control is skipped by screen readers, so the user
   is never told why it will not turn on; aria-disabled keeps it focusable and
   announced, and describedById points at the note giving the reason. Activation
   is blocked here instead, since aria-disabled carries no behaviour of its own. */
export function setTogDisabled(input, disabled, describedById) {
  if (!input) return;
  input.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  input.closest('.tog')?.classList.toggle('tog-disabled', disabled);
  if (describedById) {
    if (disabled) input.setAttribute('aria-describedby', describedById);
    else input.removeAttribute('aria-describedby');
  }
  if (input.dataset.togGuard) return;
  input.dataset.togGuard = '1';
  const blocked = () => input.getAttribute('aria-disabled') === 'true';
  input.addEventListener('click', e => { if (blocked()) e.preventDefault(); });
  input.addEventListener('keydown', e => { if (blocked() && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); });
}

export const PE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a1.85 1.85 0 0 1 2.6 2.6l-9.1 9.1-3.4 1 1-3.4z"/></svg>';

export const CHEV_SVG='<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

/* Inline-edit row: click the pencil to reveal an input, commit on blur/Enter. */
/* `root` lets a caller wire a subtree that is not in the document yet; it
   defaults to the document, which is where every id-based caller looks. */
/** @param {string} rowId @param {string} inputId
    @param {{ type?: string, placeholder?: string,
              onCommit?: (value: string) => void, root?: ParentNode }} [opts] */
export function initInlineEdit(rowId, inputId, { type = 'text', placeholder = '', onCommit, root = document } = {}) {
  const byId = id => (root === document ? el(id) : root.querySelector('#' + CSS.escape(id)));
  const row = byId(rowId);
  const inp = /** @type {HTMLInputElement} */ (byId(inputId));
  if (!row || !inp) return;
  const valEl = q('.rv', row);
  const pen = q('.pe', row);
  if (!valEl || !pen) return;

  inp.type = type;
  inp.placeholder = placeholder;
  inp.className = 'row-inp';
  inp.style.display = '';
  inp.style.cssText = '';
  row.insertBefore(inp, pen);

  function open() {
    if (row.classList.contains('editing')) return;
    row.classList.add('editing');
    inp.value = valEl.classList.contains('is-ph') ? '' : valEl.textContent;
    inp.focus(); inp.select?.();
  }
  function commit() {
    if (!row.classList.contains('editing')) return;
    row.classList.remove('editing');
    const v = inp.value.trim();
    if (v) { valEl.textContent = v; valEl.classList.remove('is-ph'); }
    else { valEl.textContent = placeholder || ''; valEl.classList.add('is-ph'); }
    onCommit?.(v);
  }

  pen.addEventListener('click', open);
  /* Secret rows already open from the value text; match that so the target is
     the whole value, not just a 28px pencil. */
  valEl.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', /** @param {KeyboardEvent} e */ e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); row.classList.remove('editing'); }
  });
}

/* Keyboard and focus behaviour for a `.row-dd` checklist (button + role=listbox).
   The caller owns the markup and what a toggle means; this adds the listbox
   interaction WAI-ARIA expects: roving tabindex, arrows, Home/End, Enter/Space,
   Escape, and outside-click close. onToggle(li) runs for an activated option. */
export function wireChecklist(dd, btn, list, onToggle) {
  const opts = () => qa('li[role="option"]', list);
  let active = -1;

  const setActive = i => {
    const o = opts();
    if (!o.length || i == null) return;
    active = i;
    o.forEach((li, n) => {
      li.tabIndex = n === active ? 0 : -1;
      li.classList.toggle('kb-active', n === active);
    });
    o[active].focus();
  };
  const open = () => {
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const o = opts();
    const first = o.findIndex(li => li.getAttribute('aria-selected') === 'true');
    setActive(first >= 0 ? first : 0);
  };
  const close = ({ focusBtn = false } = {}) => {
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    opts().forEach(li => li.classList.remove('kb-active'));
    if (focusBtn) btn.focus();
  };
  const toggle = li => { onToggle(li); };

  btn.addEventListener('click', e => { e.stopPropagation(); if (list.hidden) open(); else close(); });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) open(); }
  });

  list.addEventListener('click', e => {
    const li = e.target.closest('li[role="option"]');
    if (li) toggle(li);
  });
  list.addEventListener('keydown', e => {
    const o = opts();
    if (!o.length) return;
    const moved = nextActiveIndex(e.key, active, o.length);
    if (moved != null) { e.preventDefault(); setActive(moved); return; }
    switch (e.key) {
      case ' ':
      case 'Enter':  e.preventDefault(); if (o[active]) toggle(o[active]); break;
      case 'Escape': e.preventDefault(); close({ focusBtn: true }); break;
      case 'Tab':    close(); break;
      default: break;
    }
  });

  document.addEventListener('click', e => { if (!dd.contains(e.target)) close(); });
  opts().forEach(li => { li.tabIndex = -1; });
  return { close };
}

/* Secret inline-edit row: shows Configured/Not set, edits via a password field,
   never renders the plaintext back. Input keeps its id/value for the save path. */
export function _secretRow(host, { rowId, inpId, label, req, opt, isSet, hidden, onInput }) {
  const disp = isSet ? 'Configured' : 'Not set';
  const row = document.createElement('div'); row.className = 'row ie-row'; row.id = rowId; row.hidden = !!hidden;
  setHtml(row, html`<span class="rl">${label}${req ? html` <span class="req">*</span>` : ''}${opt ? html` <span class="opt-span">(optional)</span>` : ''}</span><span class="rv${isSet ? '' : ' is-ph'}">${disp}</span><input id="${inpId}" type="password" autocomplete="new-password" style="display:none"><button class="pe" type="button" aria-label="Edit ${label}">${raw(PE_SVG)}</button>`);
  host.appendChild(row);
  const rv = q('.rv', row), inp = inpById(inpId), pe = q('.pe', row);
  const open = () => { row.classList.add('editing'); inp.style.display = 'block'; inp.focus(); };
  const commit = () => { row.classList.remove('editing'); inp.style.display = 'none'; const has = !!inp.value; rv.textContent = has ? 'New value set' : disp; rv.classList.toggle('is-ph', !(has || isSet)); };
  pe.addEventListener('click', open); rv.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  if (onInput) inp.addEventListener('input', () => onInput(inp.value));
  return row;
}
