/* Stateless helpers shared by the admin modules. Mutable state stays out. */
import { recoversSession, toastHoldMs } from '/js/admin-logic.js?v=5356a1b3';
import { el, q } from '/js/utils.js?v=55685187';
import { t } from '/js/i18n.js?v=1f1ea9c1';
import { iconChain } from '/js/icons.js?v=9c8c550c';
import { iconSvg } from '/js/icon-set.js?v=606a68c6';

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

/* Carry `kind`, `code` and `detail`, so callers branch on data, never on
   message text. Dropping a field here fails silently: the advice falls back to
   the kind and the screen says something true but never the specific sentence. */
/** An error carrying the API's structured fields.
    @typedef {Error & { status?: number, kind?: string, code?: string,
                        detail?: Record<string, unknown> }} ApiError */

/** @param {number} status @param {any} body @returns {ApiError} */
function tagged(status, body) {
  const e = /** @type {ApiError} */ (new Error((body && body.error) || 'HTTP ' + status));
  e.status = status;
  if (body && typeof body.kind === 'string') e.kind = body.kind;
  if (body && typeof body.code === 'string') e.code = body.code;
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

/** Opens or closes a `.reveal` wrapper.

    @param {Element|null} node @param {boolean} open
    @param {boolean} [now] Skip the animation, for state restored from the
      server rather than chosen by the user.
    @returns {void} */
export function reveal(node, open, now = false) {
  if (!node) return;
  const box = /** @type {HTMLElement} */ (node);
  if (box.classList.contains('open') === open) return;
  /* The clip is only for the animation. Left on it cuts off any menu opened
     from a revealed row. */
  box.classList.remove('reveal-done');
  clearTimeout(Number(box.dataset.revealTimer || 0));
  if (open) {
    const settle = () => box.classList.add('reveal-done');
    if (now) settle();
    else box.dataset.revealTimer = String(setTimeout(settle, 400));
  }
  if (now) {
    box.classList.add('reveal-now');
    box.classList.toggle('open', open);
    /* Read back, or both class changes land in one recalculation and it
       animates anyway. */
    void box.offsetHeight;
    box.classList.remove('reveal-now');
    return;
  }
  box.classList.toggle('open', open);
}

/** Replaces a container's content and animates its height from the old to the
    new one.

    @param {Element|null} node The box whose height is animated.
    @param {() => void} apply Renders the new content, synchronously.
    @returns {void} */
export function swapContent(node, apply) {
  if (!node) {
    apply();
    return;
  }
  const box = /** @type {HTMLElement} */ (node);
  const from = box.getBoundingClientRect().height;
  /* Abandon a running swap, or its cleanup lands mid-way and pins a height. */
  box.classList.remove('swapping');
  box.style.height = '';
  box.style.overflow = '';
  box.style.transition = '';
  apply();
  const to = box.getBoundingClientRect().height;
  if (!(from > 0) || Math.abs(to - from) < 1) return;
  box.classList.add('swapping');
  /* Inline, not a class. A disclosure's own rule is more specific and would
     replace this transition with its own. */
  box.style.overflow = 'hidden';
  box.style.transition = 'height var(--t-reveal) var(--ease-reveal)';
  box.style.height = `${from}px`;
  void box.offsetHeight;
  box.style.height = `${to}px`;
  let timer = 0;
  const end = e => {
    if (e && (e.target !== box || e.propertyName !== 'height')) return;
    clearTimeout(timer);
    box.removeEventListener('transitionend', end);
    box.classList.remove('swapping');
    box.style.height = '';
    box.style.overflow = '';
    box.style.transition = '';
  };
  box.addEventListener('transitionend', end);
  /* transitionend never fires if the transition is dropped, and the height
     would stay pinned for the session. */
  timer = setTimeout(end, 600);
}

export const PE_SVG = iconSvg('edit', 17);

/* `root` lets a caller wire a subtree that is not in the document yet. */
/** A function placeholder is resolved on use, not at wiring time: this runs
    before the catalog is fetched, so a translated one has to be read later.
    @param {string} rowId @param {string} inputId
    @param {{ type?: string, placeholder?: string | (() => string),
              onCommit?: (value: string) => void, root?: ParentNode }} [opts] */
export function initInlineEdit(rowId, inputId, { type = 'text', placeholder = '', onCommit, root = document } = {}) {
  const byId = id => (root === document ? el(id) : root.querySelector('#' + CSS.escape(id)));
  const row = /** @type {HTMLElement} */ (byId(rowId));
  const inp = /** @type {HTMLInputElement} */ (byId(inputId));
  if (!row || !inp) return;
  wireInlineEdit(row, inp, { type, placeholder, onCommit });
}

/** The same row behaviour for elements a caller already holds. `row` needs an id.
    `fill: false` keeps the input's own value on open. `render` replaces how the
    committed value is shown.
    @param {HTMLElement} row @param {HTMLInputElement} inp
    @param {{ type?: string, placeholder?: string | (() => string), onCommit?: (value: string) => void,
              fill?: boolean, render?: (valEl: Element, value: string) => void }} [opts] */
export function wireInlineEdit(row, inp, { type = 'text', placeholder = '', onCommit, fill = true, render } = {}) {
  const ph = () => (typeof placeholder === 'function' ? placeholder() : placeholder);
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
    if (!labelEl.id) labelEl.id = `${row.id}-rl`;
    inp.setAttribute('aria-labelledby', labelEl.id);
    /* The pencil opens this row, so it is named after this row. Taking the name
       from the label keeps the two in one language, and in step when either
       changes. */
    pen.setAttribute('aria-label', t('common.editNamed', { name: labelEl.textContent.trim() }));
  }
  row.insertBefore(inp, pen);

  let before = '';
  function open() {
    if (row.classList.contains('editing')) return;
    row.classList.add('editing');
    inp.placeholder = ph();
    if (fill) inp.value = valEl.classList.contains('is-ph') ? '' : valEl.textContent;
    before = inp.value;
    inp.focus();
    inp.select?.();
  }
  function commit() {
    if (!row.classList.contains('editing')) return;
    row.classList.remove('editing');
    const v = inp.value.trim();
    if (render) render(valEl, v);
    else if (v) {
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
        inp.value = before;
        row.classList.remove('editing');
      }
    },
  );
}

/* The listbox interaction WAI-ARIA expects for a `.row-dd` checklist. The
   caller owns the markup and what a toggle means. */
export function paintIcon(host, rawIcon, fallbackText = '?', imgCss = '') {
  const letter = () => {
    host.textContent = fallbackText;
  };
  const candidates = rawIcon ? iconChain(rawIcon) : [];
  if (!candidates.length) return letter();
  const img = document.createElement('img');
  img.alt = '';
  if (imgCss) img.style.cssText = imgCss;
  let at = 0;
  img.onerror = () => {
    at++;
    if (at < candidates.length) img.src = candidates[at];
    else {
      img.remove();
      letter();
    }
  };
  img.src = candidates[0];
  host.appendChild(img);
}
