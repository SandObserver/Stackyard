/* Admin UI: shared foundation.
   Stateless helpers and constants used across the admin modules. No shared
   mutable state lives here; that stays in the main module. */
import { html, raw, setHtml } from '/js/html.js?v=1';

export const API = '';

/* Toast notifications. tt is private to this module. */
let tt;
export const toast = (m, t = 'ok') => {
  const e = document.getElementById('toast'); e.textContent = m;
  e.className = `show ${t}`; clearTimeout(tt); tt = setTimeout(() => e.className = '', 3000);
};

/* Fetch helpers. Throw a tagged 401 so callers can redirect to login. */
export const ag = async p => {
  const r = await fetch(API + p, { cache:'no-store' });
  if (r.status === 401) { const e = new Error('Unauthorised'); e.status = 401; throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
export const ap = async (p, b) => {
  const r = await fetch(API + p, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(b) });
  if (r.status === 401) { const e = new Error('Unauthorised'); e.status = 401; throw e; }
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'HTTP ' + r.status); }
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

/* Pencil/edit icon used by inline-edit rows. */
export const PE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a1.85 1.85 0 0 1 2.6 2.6l-9.1 9.1-3.4 1 1-3.4z"/></svg>';

/* Double-chevron used on custom select dropdowns. */
export const CHEV_SVG='<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

/* Inline-edit row: click the pencil to reveal an input, commit on blur/Enter. */
export function initInlineEdit(rowId, inputId, { type = 'text', placeholder = '', onCommit } = {}) {
  const row = document.getElementById(rowId);
  const inp = document.getElementById(inputId);
  if (!row || !inp) return;
  const valEl = row.querySelector('.rv');
  const pen = row.querySelector('.pe');
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
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); row.classList.remove('editing'); }
  });
}

/* Secret inline-edit row: shows Configured/Not set, edits via a password field,
   never renders the plaintext back. Input keeps its id/value for the save path. */
export function _secretRow(host, { rowId, inpId, label, req, opt, isSet, hidden, onInput }) {
  const disp = isSet ? 'Configured' : 'Not set';
  const row = document.createElement('div'); row.className = 'row ie-row'; row.id = rowId; row.hidden = !!hidden;
  setHtml(row, html`<span class="rl">${label}${req ? html` <span class="req">*</span>` : ''}${opt ? html` <span class="opt-span">(optional)</span>` : ''}</span><span class="rv${isSet ? '' : ' is-ph'}">${disp}</span><input id="${inpId}" type="password" autocomplete="new-password" style="display:none"><button class="pe" type="button" aria-label="Edit ${label}">${raw(PE_SVG)}</button>`);
  host.appendChild(row);
  const rv = row.querySelector('.rv'), inp = document.getElementById(inpId), pe = row.querySelector('.pe');
  const open = () => { row.classList.add('editing'); inp.style.display = 'block'; inp.focus(); };
  const commit = () => { row.classList.remove('editing'); inp.style.display = 'none'; const has = !!inp.value; rv.textContent = has ? 'New value set' : disp; rv.classList.toggle('is-ph', !(has || isSet)); };
  pe.addEventListener('click', open); rv.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  if (onInput) inp.addEventListener('input', () => onInput(inp.value));
  return row;
}
