// @ts-check
/* Keyboard behaviour a dialog needs to be usable and escapable.

   Focus belongs inside an open dialog. Tab at the last control returns to the
   first, rather than moving into the page behind, which is still there and still
   focusable while being visually covered. Without that, a keyboard user tabs out
   of the dialog into controls they cannot see, with nothing on screen saying
   where they are.

   The search overlay did this correctly; the folder overlay and the setup prompt
   had none of it. That trap was written inline against its own elements, so
   there was nothing for the other two to reuse. This is that logic, taken out.

   Escape and focus restoration are included because a trap without them makes
   things worse rather than better: focus that cannot leave, and no way to close
   the thing holding it. */

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
    /* offsetParent is null for a hidden element, which is the cheap way to ask
       without measuring. It is also null for position:fixed, so that is checked
       separately rather than treating such an element as hidden. */
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
  const first = f[0], last = f[f.length - 1];
  const active = document.activeElement;

  /* Focus outside the dialog entirely, which happens when it opens without
     anything focused: pull it back rather than letting Tab continue behind. */
  if (!root.contains(active)) { e.preventDefault(); first.focus(); return true; }

  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); return true; }
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
    /* Restoring focus is the half people forget: without it, closing a dialog
       leaves focus on nothing and the next Tab starts from the top of the page.
       Skipped if the element has since left the document, where focusing it does
       nothing useful. */
    if (restoreTo && restoreTo.focus && restoreTo.isConnected) {
      try { restoreTo.focus(); } catch { /* not focusable any more */ }
    }
  }

  root.addEventListener('keydown', /** @type {EventListener} */ (onKeydown));

  const target = initialFocus || focusableWithin(root)[0];
  if (target && target.focus) { try { target.focus(); } catch { /* nothing to focus */ } }

  return release;
}
