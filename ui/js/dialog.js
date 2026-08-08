// @ts-check
/* Keyboard behaviour a dialog needs to be usable and escapable. The page behind
   an overlay is still focusable while covered, so Tab has to wrap inside it.
   Escape and focus restoration belong with the trap: without them it is focus
   that cannot leave and no way to close what is holding it. */

/* Focusable in practice. Deliberately narrow: this is for asking what a Tab
   press would reach, not for a general accessibility audit. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The elements inside `root` that a Tab press can reach, in document order.
    @param {Element} root @returns {HTMLElement[]} */
export function focusableWithin(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(FOCUSABLE)]).filter(el => {
    /* offsetParent is null for a hidden element, and also for position:fixed,
       which is why that is checked separately. */
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.display === 'none')) return false;
    if (el.offsetParent === null && (!style || style.position !== 'fixed')) return false;
    return el.getAttribute('aria-hidden') !== 'true';
  });
}

/** Move focus to the far end when Tab would otherwise leave `root`.
    Returns true when it handled the event.
    @param {KeyboardEvent} e @param {Element} root @returns {boolean} */
export function wrapTab(e, root) {
  if (e.key !== 'Tab') return false;
  const f = focusableWithin(root);
  if (!f.length) return false;
  const first = f[0],
    last = f[f.length - 1];
  const active = document.activeElement;

  /* Focus outside the dialog entirely, which happens when it opens without
     anything focused: pull it back rather than letting Tab continue behind. */
  if (!root.contains(active)) {
    e.preventDefault();
    first.focus();
    return true;
  }

  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** Make `root` behave as a modal dialog until the returned function is called.

    Traps Tab, closes on Escape, and returns focus to whatever was focused when
    it opened. Calling the returned function twice is harmless, since a dialog
    can be closed by more than one route.

    @param {Element} root
    @param {{ onClose?: () => void, initialFocus?: HTMLElement | null,
              closeOnEscape?: boolean }} [opts]
    @returns {() => void} */
export function trapFocus(root, opts = {}) {
  if (!root) return () => {};
  const { onClose, initialFocus, closeOnEscape = true } = opts;
  const restoreTo = /** @type {HTMLElement|null} */ (document.activeElement);
  let released = false;

  const onKeydown = /** @param {KeyboardEvent} e */ e => {
    if (wrapTab(e, root)) return;
    if (closeOnEscape && e.key === 'Escape') {
      e.preventDefault();
      release();
      if (onClose) onClose();
    }
  };

  function release() {
    if (released) return;
    released = true;
    root.removeEventListener('keydown', /** @type {EventListener} */ (onKeydown));
    /* Without this, closing leaves focus on nothing and the next Tab starts from
       the top of the page. Skipped if the element has left the document. */
    if (restoreTo && restoreTo.focus && restoreTo.isConnected) {
      try {
        restoreTo.focus();
      } catch {
        /* not focusable any more */
      }
    }
  }

  root.addEventListener('keydown', /** @type {EventListener} */ (onKeydown));

  const target = initialFocus || focusableWithin(root)[0];
  if (target && target.focus) {
    try {
      target.focus();
    } catch {
      /* nothing to focus */
    }
  }

  return release;
}
