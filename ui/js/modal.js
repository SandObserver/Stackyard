// @ts-check
/* The one modal in the admin UI.

   Everything a dialog owes the person using it lives here once: a backdrop that
   dismisses, Escape, a focus trap, and focus returned to whatever opened it.
   The browser's own confirm() and prompt() do all of that too, which is why
   they were worth using, but they cannot show a list, cannot be styled, and
   block the page while open.

   Structure only. Callers fill the body with their own nodes. */

import { trapFocus } from '/js/dialog.js?v=4ff94595';

/** Open a modal and return its parts.

    `close()` is safe to call more than once, since a dialog can be dismissed by
    the backdrop, Escape, an action button, or the caller.

    The trap is armed by `focus()` rather than on open, because the element
    worth focusing is usually one the caller has not appended yet.

    @param {{ title: string, className?: string, onClose?: () => void }} opts
    @returns {{ box: HTMLElement, body: HTMLElement, footer: HTMLElement,
                close: () => void,
                addAction: (label: string, cls: string, onAct?: () => void) => HTMLButtonElement,
                focus: (initial?: HTMLElement|null) => void }} */
export function openModal({ title, className, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'dlg-ov' + (className ? ' ' + className : '');

  const box = document.createElement('div');
  box.className = 'dlg-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const hdr = document.createElement('div');
  hdr.className = 'dlg-hdr';
  /* Unique per open: two ids would point the second dialog's label at the
     first one's heading. */
  hdr.id = 'dlg-hdr-' + Math.random().toString(36).slice(2, 8);
  hdr.textContent = title;
  box.setAttribute('aria-labelledby', hdr.id);

  const body = document.createElement('div');
  body.className = 'dlg-body';

  const footer = document.createElement('div');
  footer.className = 'dlg-foot';

  let release = () => {};
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    release();
    ov.remove();
    if (onClose) onClose();
  };

  ov.onclick = e => {
    if (e.target === ov) close();
  };

  const addAction = (label, cls, onAct) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.onclick = () => {
      if (onAct) onAct();
      else close();
    };
    footer.appendChild(b);
    return b;
  };

  box.append(hdr, body, footer);
  ov.appendChild(box);
  document.body.appendChild(ov);

  const focus = initial => {
    release = trapFocus(box, { onClose: close, initialFocus: initial });
  };

  return { box, body, footer, close, addAction, focus };
}

/** A modal with Cancel and a confirming action, resolving to true or false.
    Replaces confirm() where the question needs more than one line of text.

    @param {{ title: string, body: Node, confirmLabel: string, cancelLabel: string,
              destructive?: boolean, className?: string }} opts
    @returns {Promise<boolean>} */
export function confirmModal({ title, body, confirmLabel, cancelLabel, destructive, className }) {
  return new Promise(resolve => {
    let answer = false;
    const m = openModal({ title, className, onClose: () => resolve(answer) });
    m.body.appendChild(body);
    m.addAction(cancelLabel, 'bg sm', m.close);
    const go = m.addAction(confirmLabel, destructive ? 'bd-btn sm' : 'bp sm', () => {
      answer = true;
      m.close();
    });
    m.focus(go);
  });
}

/** A modal asking for one line of text, resolving to the trimmed value or null.
    Replaces prompt().

    @param {{ title: string, label: string, placeholder?: string,
              confirmLabel: string, cancelLabel: string }} opts
    @returns {Promise<string|null>} */
export function promptModal({ title, label, placeholder, confirmLabel, cancelLabel }) {
  return new Promise(resolve => {
    /** @type {string|null} */
    let answer = null;
    const m = openModal({ title, onClose: () => resolve(answer) });

    const field = document.createElement('label');
    field.className = 'dlg-field';
    const cap = document.createElement('span');
    cap.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inp';
    if (placeholder) input.placeholder = placeholder;
    field.append(cap, input);
    m.body.appendChild(field);

    const accept = () => {
      const v = input.value.trim();
      if (!v) return;
      answer = v;
      m.close();
    };
    input.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        accept();
      }
    };
    m.addAction(cancelLabel, 'bg sm', m.close);
    m.addAction(confirmLabel, 'bp sm', accept);
    m.focus(input);
  });
}
