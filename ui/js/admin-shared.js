/* Stateless helpers shared by the admin modules. Mutable state stays out. */
import { nextActiveIndex, recoversSession, toastHoldMs } from '/js/admin-logic.js?v=ddfc6f80';
import { el, qa, q } from '/js/utils.js?v=26566e09';
import { t } from '/js/i18n.js?v=d056c9c5';

export const API = '';

let tt;
let _toastWired = false;

/** @param {string} m @param {'ok'|'err'} [t] @returns {void} */
export const toast = (m, t = 'ok') => {
  const e = el('toast');
  e.textContent = m;
  e.className = `show ${t}`;
  clearTimeout(tt);
  if (!_toastWired) {
    _toastWired = true;
    const hold = () => clearTimeout(tt);
    const release = () => {
      clearTimeout(tt);
      const ms = toastHoldMs(e.classList.contains('err') ? 'err' : 'ok', e.textContent || '', 'release');
      if (ms != null) tt = setTimeout(() => (e.className = ''), ms);
    };
    e.addEventListener('mouseenter', hold);
    e.addEventListener('focusin', hold);
    e.addEventListener('mouseleave', release);
    e.addEventListener('focusout', release);
    e.addEventListener('click', () => {
      clearTimeout(tt);
      e.className = '';
    });
  }
  const ms = toastHoldMs(t, m, 'show');
  if (ms != null) tt = setTimeout(() => (e.className = ''), ms);
};

/* Carry `kind` and `detail`, so callers branch on data, never on message
   text. */
/** An error carrying the API's structured fields. See docs/api-errors.md.
    @typedef {Error & { status?: number, kind?: string, detail?: Record<string, unknown> }} ApiError */

/** @param {number} status @param {any} body @returns {ApiError} */
function tagged(status, body) {
  const e = /** @type {ApiError} */ (new Error((body && body.error) || 'HTTP ' + status));
  e.status = status;
  if (body && typeof body.kind === 'string') e.kind = body.kind;
  if (body && body.detail && typeof body.detail === 'object') e.detail = body.detail;
  return e;
}
/* Set by the admin entry point, never imported. The sign-in screen imports this
   module, so importing it back is a cycle. */
/** @type {(() => Promise<boolean>) | null} */
let _reauth = null;

/** @param {() => Promise<boolean>} fn */
export function setReauthHandler(fn) {
  _reauth = fn;
}

/* One sign-in however many requests fail at once. */
/** @type {Promise<boolean> | null} */
let _signingIn = null;
function reauthenticate() {
  if (!_reauth) return Promise.resolve(false);
  if (!_signingIn) {
    _signingIn = Promise.resolve(_reauth()).finally(() => {
      _signingIn = null;
    });
  }
  return _signingIn;
}

/* Retried once only. A second 401 after a successful sign-in is the server
   refusing the request itself. */
export const ag = async (p, recover = true) => {
  const r = await fetch(API + p, { cache: 'no-store' });
  if (recover && recoversSession(p, r.status) && (await reauthenticate())) return ag(p, false);
  if (!r.ok) {
    const d = r.status === 401 ? null : await r.json().catch(() => null);
    throw tagged(r.status, d || (r.status === 401 ? { error: 'Unauthorised', kind: 'auth' } : null));
  }
  return r.json();
};
export const ap = async (p, b, recover = true) => {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  if (recover && recoversSession(p, r.status) && (await reauthenticate())) return ap(p, b, false);
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw tagged(r.status, d || (r.status === 401 ? { error: 'Unauthorised', kind: 'auth' } : null));
  }
  const body = await r.json();
  /* Every config write goes through here, and a withheld credential has to be
     said out loud. */
  const withheld = (body?.withheld || []).map(w => w.label).filter(Boolean);
  if (withheld.length) toast(t('toast.secretsWithheld', { items: withheld.join(', ') }), 'err');
  return body;
};

/* A native `disabled` control is skipped by screen readers. aria-disabled keeps
   it announced but carries no behaviour, so activation is blocked here. */
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
  input.addEventListener('click', e => {
    if (blocked()) e.preventDefault();
  });
  input.addEventListener('keydown', e => {
    if (blocked() && (e.key === ' ' || e.key === 'Enter')) e.preventDefault();
  });
}

export const PE_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a1.85 1.85 0 0 1 2.6 2.6l-9.1 9.1-3.4 1 1-3.4z"/></svg>';

export const CHEV_SVG =
  '<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

/* `root` lets a caller wire a subtree that is not in the document yet. */
/** A function placeholder is resolved on use, not at wiring time: this runs
    before the catalog is fetched, so a translated one has to be read later.
    @param {string} rowId @param {string} inputId
    @param {{ type?: string, placeholder?: string | (() => string),
              onCommit?: (value: string) => void, root?: ParentNode }} [opts] */
export function initInlineEdit(rowId, inputId, { type = 'text', placeholder = '', onCommit, root = document } = {}) {
  const ph = () => (typeof placeholder === 'function' ? placeholder() : placeholder);
  const byId = id => (root === document ? el(id) : root.querySelector('#' + CSS.escape(id)));
  const row = byId(rowId);
  const inp = /** @type {HTMLInputElement} */ (byId(inputId));
  if (!row || !inp) return;
  const valEl = q('.rv', row);
  const pen = q('.pe', row);
  if (!valEl || !pen) return;

  inp.type = type;
  inp.placeholder = ph();
  inp.className = 'row-inp';
  inp.style.display = '';
  inp.style.cssText = '';
  /* The row's own label carries the translation. A placeholder is a hint, not a
     name, and several readers drop it once the field holds a value. */
  const labelEl = q('.rl', row);
  if (labelEl) {
    if (!labelEl.id) labelEl.id = `${rowId}-rl`;
    inp.setAttribute('aria-labelledby', labelEl.id);
  }
  row.insertBefore(inp, pen);

  function open() {
    if (row.classList.contains('editing')) return;
    row.classList.add('editing');
    inp.placeholder = ph();
    inp.value = valEl.classList.contains('is-ph') ? '' : valEl.textContent;
    inp.focus();
    inp.select?.();
  }
  function commit() {
    if (!row.classList.contains('editing')) return;
    row.classList.remove('editing');
    const v = inp.value.trim();
    if (v) {
      valEl.textContent = v;
      valEl.classList.remove('is-ph');
    } else {
      valEl.textContent = ph() || '';
      valEl.classList.add('is-ph');
    }
    onCommit?.(v);
  }

  pen.addEventListener('click', open);
  valEl.addEventListener('click', open);
  inp.addEventListener('blur', commit);
  inp.addEventListener(
    'keydown',
    /** @param {KeyboardEvent} e */ e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        row.classList.remove('editing');
      }
    },
  );
}

/* The listbox interaction WAI-ARIA expects for a `.row-dd` checklist. The
   caller owns the markup and what a toggle means. */
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
  const toggle = li => {
    onToggle(li);
  };

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (list.hidden) open();
    else close();
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) open();
    }
  });

  list.addEventListener('click', e => {
    const li = e.target.closest('li[role="option"]');
    if (li) toggle(li);
  });
  list.addEventListener('keydown', e => {
    const o = opts();
    if (!o.length) return;
    const moved = nextActiveIndex(e.key, active, o.length);
    if (moved != null) {
      e.preventDefault();
      setActive(moved);
      return;
    }
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (o[active]) toggle(o[active]);
        break;
      case 'Escape':
        e.preventDefault();
        close({ focusBtn: true });
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  });

  document.addEventListener('click', e => {
    if (!dd.contains(e.target)) close();
  });
  opts().forEach(li => {
    li.tabIndex = -1;
  });
  return { close };
}
