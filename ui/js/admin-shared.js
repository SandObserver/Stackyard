/* Stateless helpers shared by the admin modules. Mutable state stays out. */
import { recoversSession, toastHoldMs } from '/js/admin-logic.js?v=cf072e65';
import { el, isolate, q, qa } from '/js/utils.js?v=14d4695d';
import { t } from '/js/i18n.js?v=ed7c5565';
import { errorAdvice } from '/js/admin-error.js?v=0882cee9';
import { formatList, formatNumber } from '/js/format-number.js?v=abcd4ae4';
import { iconChain } from '/js/icons.js?v=5ac01d72';
import { iconSvg } from '/js/icon-set.js?v=b279fd98';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { slideBlock } from '/js/modal.js?v=bd88cb9e';
import { blockingScreenFor, recoveryShown, showBlockingScreen } from '/js/config-recovery.js?v=c03e1465';

export const API = '';

let tt;
let _toastWired = false;
let _warnHolds = false;
/** @type {HTMLElement|null} */
let _toastReturn = null;

function hideToast() {
  const e = el('toast');
  if (!e) return;
  clearTimeout(tt);
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  if (active && e.contains(active)) {
    if (_toastReturn?.isConnected) _toastReturn.focus();
    else active.blur();
  }
  _toastReturn = null;
  e.className = '';
  const act = /** @type {HTMLButtonElement|null} */ (q('.toast-act', e));
  if (act) {
    act.hidden = true;
    act.onclick = null;
  }
}

const TOAST_ICON = Object.freeze({ ok: 'success', warn: 'warning', err: 'failure' });

/** @param {string} m @param {'ok'|'warn'|'err'} [tone] 'warn' is for an action
    that worked with a caveat. Neither 'warn' nor 'err' goes away on its own.
    An 'ok' replaces a 'warn' only after the user next presses a key or a
    pointer outside the toast, so the same action's success cannot hide it.
    @param {{ label: string, run: () => void } | null} [action] one button that
      does what the message asks for.
    @returns {void} */
export const toast = (m, tone = 'ok', action = null) => {
  const e = el('toast');
  const msg = el('toast-msg');
  if (!e || !msg) return;
  const showing = e.classList.contains('show');
  if (tone === 'ok' && _warnHolds && showing && e.classList.contains('warn')) return;
  _warnHolds = tone === 'warn';
  const ico = q('.toast-ico', e);
  if (ico) setHtml(ico, html`${raw(iconSvg(TOAST_ICON[tone] || 'info', 20))}`);
  /* An error interrupts. A repeat of the same words is read again only when
     the text changes, so it is cleared first. */
  msg.setAttribute('role', tone === 'err' ? 'alert' : 'status');
  msg.setAttribute('aria-live', tone === 'err' ? 'assertive' : 'polite');
  if (showing && msg.textContent === m) {
    msg.textContent = '';
    setTimeout(() => {
      if (!msg.textContent) msg.textContent = m;
    }, 50);
  } else msg.textContent = m;
  const act = /** @type {HTMLButtonElement|null} */ (q('.toast-act', e));
  if (act) {
    act.hidden = !action;
    act.textContent = action ? action.label : '';
    act.onclick = action
      ? ev => {
          ev.stopPropagation();
          hideToast();
          action.run();
        }
      : null;
  }
  e.className = `show ${tone}`;
  clearTimeout(tt);
  if (!_toastWired) {
    _toastWired = true;
    const toneOf = () => (e.classList.contains('err') ? 'err' : e.classList.contains('warn') ? 'warn' : 'ok');
    const hold = () => clearTimeout(tt);
    const release = () => {
      clearTimeout(tt);
      const ms = toastHoldMs(toneOf(), msg.textContent || '', 'release');
      if (ms != null) tt = setTimeout(hideToast, ms);
    };
    e.addEventListener('mouseenter', hold);
    e.addEventListener('focusin', ev => {
      const from = /** @type {HTMLElement|null} */ (ev.relatedTarget);
      if (from && !e.contains(from)) _toastReturn = from;
      hold();
    });
    e.addEventListener('mouseleave', release);
    e.addEventListener('focusout', release);
    e.addEventListener('click', hideToast);
    const acted = ev => {
      if (!e.contains(/** @type {Node|null} */ (ev.target))) _warnHolds = false;
    };
    document.addEventListener('pointerdown', acted, true);
    document.addEventListener('keydown', acted, true);
  }
  const ms = action ? null : toastHoldMs(tone, m, 'show');
  if (ms != null) tt = setTimeout(hideToast, ms);
};

/** @param {string} rowId */
function openGeneralAt(rowId) {
  if (location.hash === '#general') dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = 'general';
  setTimeout(() => {
    const row = el(rowId);
    const target = /** @type {HTMLElement|null} */ (row?.querySelector('.pe, input, button') ?? row);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus();
  }, 250);
}

const SOURCE_ROW = new Map([
  ['invalid.socket-missing', 'ie-socket'],
  ['invalid.proxmox-missing', 'ie-pve-url'],
]);

/** @param {unknown} e
    @returns {{ label: string, run: () => void } | null} */
export function errorAction(e) {
  const err = /** @type {any} */ (e);
  const code = typeof err?.code === 'string' ? err.code : '';
  const source = SOURCE_ROW.get(code);
  if (source) {
    const off = !(/** @type {HTMLInputElement|null} */ (el('srv-hc-en'))?.checked);
    return { label: t('toast.openGeneral'), run: () => openGeneralAt(off ? 'srv-hc-en' : source) };
  }
  if (err?.status === 409 || code === 'invalid.password-changed')
    return { label: t('toast.reload'), run: () => location.reload() };
  return null;
}

/** @param {Element|null} st
    @param {'ok'|'warn'|'err'|''} tone '' for a neutral line
    @param {string} text
    @param {{ label: string, run: () => void } | null} [action]
    @returns {void} */
export function setStatus(st, tone, text, action = null) {
  if (!st) return;
  st.classList.remove('ok', 'warn', 'err');
  if (tone) st.classList.add(tone);
  st.replaceChildren();
  if (tone) {
    const ico = document.createElement('span');
    ico.className = 'st-ico';
    setHtml(ico, html`${raw(iconSvg(TOAST_ICON[tone], 14))}`);
    st.append(ico);
  }
  st.append(text);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-act';
    b.textContent = action.label;
    b.addEventListener('click', action.run);
    st.append(' ', b);
  }
}

/** @type {WeakMap<Element, number>} */
const _savedTimers = new WeakMap();

/** Keep `quiet` for list moves. Otherwise the save announcement replaces the position
    announcement before a screen reader reads it.
    @param {Element|null|undefined} btn
    @param {boolean} [quiet]
    @returns {void} */
export function confirmSaved(btn, quiet = false) {
  const b = /** @type {HTMLElement|null|undefined} */ (btn);
  if (el('toast')?.classList.contains('err')) hideToast();
  if (!b?.isConnected || !b.getClientRects().length || !b.querySelector('.sv-done')) {
    if (!quiet) toast(t('toast.saved'));
    return;
  }
  clearTimeout(_savedTimers.get(b));
  b.classList.add('saved');
  if (!quiet) announce(t('toast.saved'));
  _savedTimers.set(
    b,
    window.setTimeout(() => b.classList.remove('saved'), 1500),
  );
}

/** @param {Element|null} node */
export function sectionSave(node) {
  return node?.closest('.sec')?.querySelector('.sec-hdr-actions .sv-btn') ?? null;
}

let _fieldErrSeq = 0;
/** @type {WeakMap<Element, AbortController>} */
const _fieldErrWatch = new WeakMap();
const TEXT_TYPES = new Set(['text', 'url', 'password', 'number', 'search', 'email']);

/** Says under a row what is wrong with its field and marks the field invalid.
    The message goes once the field is edited. A row not on screen, such as one
    on another page of a group, falls back to the toast.

    @param {Element|null|undefined} row a `.row`
    @param {string} message
    @param {{ focus?: boolean }} [opts] focus: false when called from the
      field's own blur, or focus is pulled back on every blur.
    @returns {void} */
export function showFieldError(row, message, { focus = true } = {}) {
  if (!row?.isConnected) {
    toast(message, 'err');
    return;
  }
  clearFieldError(row);
  const box = /** @type {HTMLElement} */ (row);
  const note = document.createElement('p');
  note.className = 'grp-tip in-card field-err';
  note.id = `field-err-${++_fieldErrSeq}`;
  note.textContent = message;
  box.after(note);
  slideBlock(note, true);
  box.classList.add('row-invalid');
  const controls = qa('input:not([type="hidden"]), select, textarea, [role="combobox"], button', box);
  for (const c of controls) {
    const pen = c.classList.contains('pe');
    if (c.tagName === 'BUTTON' && !pen && !c.classList.contains('row-dd-btn')) continue;
    if (!pen) c.setAttribute('aria-invalid', 'true');
    const ids = (c.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    c.setAttribute('aria-describedby', [...ids, note.id].join(' '));
  }
  const ac = new AbortController();
  _fieldErrWatch.set(box, ac);
  const clear = ev => {
    const tgt = ev.target;
    if (ev.type === 'change' && tgt instanceof HTMLInputElement && TEXT_TYPES.has(tgt.type)) return;
    clearFieldError(box);
  };
  box.addEventListener('input', clear, { signal: ac.signal });
  box.addEventListener('change', clear, { signal: ac.signal });
  if (!focus) {
    announce(message);
    return;
  }
  const pen = /** @type {HTMLElement|null} */ (box.querySelector('.pe'));
  if (pen && box.classList.contains('ie-row') && !box.classList.contains('editing')) pen.click();
  else {
    const target = /** @type {HTMLElement|undefined} */ (
      controls.find(c => !c.classList.contains('d-none') && /** @type {HTMLElement} */ (c).offsetParent)
    );
    target?.focus();
  }
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** @param {Element} row */
export function clearFieldError(row) {
  if (!row.classList.contains('row-invalid')) return;
  _fieldErrWatch.get(row)?.abort();
  _fieldErrWatch.delete(row);
  row.classList.remove('row-invalid');
  const note = /** @type {HTMLElement|null} */ (row.nextElementSibling);
  const noteId = note?.classList.contains('field-err') ? note.id : '';
  if (note && noteId) {
    note.removeAttribute('id');
    note.classList.replace('field-err', 'field-err-out');
    slideBlock(note, false, () => note.remove());
  }
  for (const c of qa('[aria-invalid="true"]', row)) c.removeAttribute('aria-invalid');
  if (!noteId) return;
  for (const c of qa('[aria-describedby]', row)) {
    const ids = (c.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== noteId);
    if (ids.length) c.setAttribute('aria-describedby', ids.join(' '));
    else c.removeAttribute('aria-describedby');
  }
}

/** @param {string} text */
export function announce(text) {
  const region = el('sr-announce');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => {
    region.textContent = text;
  }, 100);
}

/** @param {Element|null} node */
export function fadeIn(node) {
  if (!node) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.animate(
    still
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
    { duration: 200, easing: 'cubic-bezier(.32,.72,0,1)' },
  );
}

/** @param {ParentNode} root */
export function clearFieldErrors(root) {
  for (const row of qa('.row-invalid', root)) clearFieldError(row);
}

/* Carry `kind`, `code` and `detail`, so callers branch on data, never on
   message text. Dropping a field here fails silently: the advice falls back to
   the kind and the screen says something true but never the specific sentence. */
/** An error carrying the API's structured fields.
    @typedef {Error & { status?: number, kind?: string, code?: string,
                        detail?: Record<string, unknown> }} ApiError */

/** @param {number} status @param {any} body @returns {ApiError} */
function tagged(status, body) {
  const screen = status === 403 || status === 503 ? blockingScreenFor(body) : null;
  if (screen && !recoveryShown()) showBlockingScreen(screen);
  const e = /** @type {ApiError} */ (new Error((body && body.error) || 'HTTP ' + status));
  e.status = status;
  if (body && typeof body.kind === 'string') e.kind = body.kind;
  if (body && typeof body.code === 'string') e.code = body.code;
  if (body && body.detail && typeof body.detail === 'object') e.detail = body.detail;
  return e;
}

/** An error whose message is already a sentence in the reader's language. */
export class ShownError extends Error {}

/** The sentence for a failed action. Never the API's own text: it is English
    written for a log.
    @param {unknown} e @returns {string} */
export function errorText(e) {
  if (e instanceof ShownError) return e.message;
  const { key, vars } = errorAdvice(e);
  if (vars && typeof vars.max === 'number') vars.max = formatNumber(vars.max);
  return t(key, vars);
}

/** For a raw `fetch`. A body that is not JSON is the web server answering on
    its own.

    @param {Response} r @returns {Promise<Error>} */
export async function responseError(r) {
  const text = await r.text().catch(() => '');
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!body && r.status === 413) return new ShownError(t('toast.imageTooLarge'));
  return tagged(r.status, body);
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
export const apiGet = async (p, recover = true) => {
  const r = await fetch(API + p, { cache: 'no-store' });
  if (recover && recoversSession(p, r.status) && (await reauthenticate())) return apiGet(p, false);
  if (!r.ok) {
    const d = r.status === 401 ? null : await r.json().catch(() => null);
    throw tagged(r.status, d || (r.status === 401 ? { error: 'Unauthorised', kind: 'auth' } : null));
  }
  return r.json();
};
export const apiPost = async (p, b, recover = true) => {
  const r = await fetch(API + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  if (recover && recoversSession(p, r.status) && (await reauthenticate())) return apiPost(p, b, false);
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw tagged(r.status, d || (r.status === 401 ? { error: 'Unauthorised', kind: 'auth' } : null));
  }
  const body = await r.json();
  /* Every config write goes through here, and a withheld credential has to be
     said out loud. */
  const withheld = withheldText(body);
  if (withheld) toast(withheld, 'warn');
  return body;
};

/** @param {any} body a config write's reply
    @returns {string} the notice naming the credentials it withheld, or '' */
export function withheldText(body) {
  const names = (body?.withheld || [])
    .map(w => w.label)
    .filter(Boolean)
    .map(isolate);
  return names.length ? t('toast.secretsWithheld', { items: formatList(names) }) : '';
}

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

/** @param {HTMLInputElement} inp */
export function plainInput(inp) {
  inp.setAttribute('autocapitalize', 'none');
  inp.setAttribute('autocorrect', 'off');
  inp.spellcheck = false;
}

/* `root` lets a caller wire a subtree that is not in the document yet. */
/** A function placeholder is resolved on use, not at wiring time: this runs
    before the catalog is fetched, so a translated one has to be read later.
    @param {string} rowId @param {string} inputId
    @param {{ type?: string, placeholder?: string | (() => string),
              onCommit?: (value: string) => void, root?: ParentNode, plain?: boolean, fill?: boolean,
              render?: (valEl: Element, value: string) => void, empty?: () => string }} [opts] */
export function initInlineEdit(
  rowId,
  inputId,
  { type = 'text', placeholder = '', onCommit, root = document, plain = false, fill, render, empty } = {},
) {
  const byId = id => (root === document ? el(id) : root.querySelector('#' + CSS.escape(id)));
  const row = /** @type {HTMLElement} */ (byId(rowId));
  const inp = /** @type {HTMLInputElement} */ (byId(inputId));
  if (!row || !inp) return;
  wireInlineEdit(row, inp, { type, placeholder, onCommit, plain, fill, render, empty });
}

/** Name a row's pencil after its label. Call again once the catalog loads.
    @param {Element} row */
export function nameEditPen(row) {
  const labelEl = q('.rl', row);
  const pen = q('.pe', row);
  if (labelEl && pen) pen.setAttribute('aria-label', t('common.editNamed', { name: labelEl.textContent.trim() }));
}

/** The same row behaviour for elements a caller already holds. `row` needs an id.
    `fill: false` keeps the input's own value on open. `render` replaces how the
    committed value is shown. `plain` is for an address, host, username or key:
    no capitals, correction or spelling marks. `placeholder` shows only in the
    open field. `empty` is what an empty row shows, common.notSet by default.
    @param {HTMLElement} row @param {HTMLInputElement} inp
    @param {{ type?: string, placeholder?: string | (() => string), onCommit?: (value: string) => void,
              fill?: boolean, render?: (valEl: Element, value: string) => void, plain?: boolean,
              empty?: () => string }} [opts] */
export function wireInlineEdit(
  row,
  inp,
  {
    type = 'text',
    placeholder = '',
    onCommit,
    fill = true,
    render,
    plain = false,
    empty = () => t('common.notSet'),
  } = {},
) {
  const ph = () => (typeof placeholder === 'function' ? placeholder() : placeholder);
  const valEl = q('.rv', row);
  const pen = q('.pe', row);
  if (!valEl || !pen) return;
  if (!render && valEl.classList.contains('is-ph') && !valEl.hasAttribute('data-i18n')) valEl.textContent = empty();

  inp.type = type;
  inp.placeholder = ph();
  inp.className = 'row-inp';
  inp.style.display = '';
  inp.style.cssText = '';
  if (plain) plainInput(inp);
  /* The row's own label carries the translation. A placeholder is a hint, not a
     name, and several readers drop it once the field holds a value. */
  const labelEl = q('.rl', row);
  if (labelEl) {
    if (!labelEl.id) labelEl.id = `${row.id}-rl`;
    inp.setAttribute('aria-labelledby', labelEl.id);
    nameEditPen(row);
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
      valEl.textContent = empty();
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
        pen.focus();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        inp.value = before;
        row.classList.remove('editing');
        pen.focus();
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
