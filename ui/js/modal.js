// @ts-check
/* The one modal in the admin UI. Structure only; callers fill the body.

   showModal() puts the dialog in the top layer and makes the rest of the page
   inert, which a focus trap cannot do: the old one stopped Tab but left the
   page behind readable to a screen reader. Escape, focus restoration and the
   backdrop come with it. */

/* A counter, not randomness. Six base-36 characters collide plausibly over a
   long session, and an id that changes per run cannot be asserted on. */
let _seq = 0;
const uniqueId = prefix => `${prefix}-${++_seq}`;

/** Open a modal and return its parts. `close()` is safe to call more than once.

    @param {{ title: string, className?: string, onClose?: () => void }} opts
    @returns {{ box: HTMLElement, body: HTMLElement, footer: HTMLElement,
                close: () => void,
                addAction: (label: string, cls: string, onAct?: () => void) => HTMLButtonElement,
                focus: (initial?: HTMLElement|null) => void }} */
export function openModal({ title, className, onClose }) {
  const box = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
  box.className = 'dlg-box' + (className ? ' ' + className : '');

  const hdr = document.createElement('div');
  hdr.className = 'dlg-hdr';
  /* Unique per open. Two ids point the second dialog's label at the first one's
     heading. */
  hdr.id = uniqueId('dlg-hdr');
  hdr.textContent = title;
  box.setAttribute('aria-labelledby', hdr.id);

  const body = document.createElement('div');
  body.className = 'dlg-body';

  const footer = document.createElement('div');
  footer.className = 'dlg-foot';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    box.close();
  };

  /* Escape and the close() above arrive here alike, so the caller is told once
     however the dialog went away. */
  box.addEventListener('close', () => {
    closed = true;
    box.remove();
    if (onClose) onClose();
  });

  /* A click on the backdrop is reported against the dialog itself, because the
     backdrop is not an element. Both ends of the click are checked: a text
     selection released past the dialog's edge would otherwise dismiss it. */
  let downOnBackdrop = false;
  box.onmousedown = e => {
    downOnBackdrop = e.target === box;
  };
  box.onclick = e => {
    if (e.target === box && downOnBackdrop) close();
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
  document.body.appendChild(box);
  box.showModal();

  /* The element worth focusing is usually one the caller appends after opening,
     so showModal's own choice is corrected here. */
  const focus = initial => {
    if (initial) initial.focus();
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
