// @ts-check
/* The one modal in the admin UI: backdrop, Escape, focus trap, and focus
   returned to whatever opened it. Structure only. Callers fill the body. */

import { trapFocus } from '/js/dialog.js?v=05935547';

/** Open a modal and return its parts. `close()` is safe to call more than once.
    `focus()` arms the trap, because the element worth focusing is usually one
    the caller has not appended yet.

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
  /* Unique per open. Two ids point the second dialog's label at the first one's
     heading. */
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

  /* Both ends of the click. A text selection released past the dialog's edge
     would otherwise dismiss it. */
  let downOnBackdrop = false;
  ov.onmousedown = e => {
    downOnBackdrop = e.target === ov;
  };
  ov.onclick = e => {
    if (e.target === ov && downOnBackdrop) close();
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
    /* Arming twice is a caller re-rendering the body. The previous trap must
       go, or its listener outlives the dialog. */
    release();
    release = trapFocus(box, { onClose: close, initialFocus: initial });
  };

  return { box, body, footer, close, addAction, focus };
}

/** A modal with Cancel and a confirming action, resolving to true or false.

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
