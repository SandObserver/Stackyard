// @ts-check
/* Structure only; callers fill the body. */

/* A counter, not randomness. Six base-36 characters collide plausibly over a
   long session, and an id that changes per run cannot be asserted on. */
let _seq = 0;
const uniqueId = prefix => `${prefix}-${++_seq}`;

/** Open a modal and return its parts. `close()` is safe to call more than once.

    @param {{ title: string, className?: string, onClose?: () => void }} opts
    @returns {{ box: HTMLElement, body: HTMLElement, footer: HTMLElement,
                close: () => void, setBusy: (busy: boolean) => void,
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
  let busy = false;
  const close = () => {
    if (closed || busy) return;
    closed = true;
    box.close();
  };

  /* Escape and the close() above arrive here alike, so the caller is told once
     however the dialog went away. */
  box.addEventListener('cancel', e => {
    if (busy) e.preventDefault();
  });
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

  /* Closing while a submit runs reports a cancel for a write that went through. */
  const setBusy = on => {
    busy = on;
    box.setAttribute('aria-busy', String(on));
    for (const c of box.querySelectorAll('button, input')) /** @type {HTMLInputElement} */ (c).disabled = on;
  };

  return { box, body, footer, close, addAction, focus, setBusy };
}

/** A modal with Cancel and a confirming action, resolving to true or false.

    @param {{ title: string, body: Node, confirmLabel: string, cancelLabel: string,
              destructive?: boolean, irreversible?: boolean, className?: string }} opts
      destructive: the action does harm the person did not ask for.
      irreversible: Cancel takes the first focus, so Return does not confirm.
    @returns {Promise<boolean>} */
export function confirmModal({ title, body, confirmLabel, cancelLabel, destructive, irreversible, className }) {
  return new Promise(resolve => {
    let answer = false;
    const m = openModal({ title, className, onClose: () => resolve(answer) });
    m.body.appendChild(body);
    const cancel = m.addAction(cancelLabel, 'bg sm', m.close);
    const go = m.addAction(confirmLabel, destructive ? 'bd-btn sm' : 'bp sm', () => {
      answer = true;
      m.close();
    });
    m.focus(irreversible ? cancel : go);
  });
}

/** confirmModal for a plain sentence, which is what a replaced confirm() asks.

    @param {{ title: string, text: string, confirmLabel: string, cancelLabel: string,
              destructive?: boolean, irreversible?: boolean }} opts
    @returns {Promise<boolean>} */
export function confirmText({ title, text, confirmLabel, cancelLabel, destructive, irreversible }) {
  const lead = document.createElement('p');
  lead.className = 'dlg-lead';
  lead.textContent = text;
  return confirmModal({ title, body: lead, confirmLabel, cancelLabel, destructive, irreversible });
}

/** A modal asking for one line of text, resolving to the value or null. Never
    trim a password.

    `submit` runs with the dialog still open. It returns a sentence to show
    under the field and keep the dialog open, or null to close it.

    @param {{ title: string, label: string, placeholder?: string, text?: string,
              password?: boolean, destructive?: boolean,
              confirmLabel: string, cancelLabel: string,
              submit?: (value: string) => Promise<string|null> }} opts
    @returns {Promise<string|null>} */
export function promptModal({
  title,
  label,
  placeholder,
  text,
  password,
  destructive,
  confirmLabel,
  cancelLabel,
  submit,
}) {
  return new Promise(resolve => {
    /** @type {string|null} */
    let answer = null;
    /** @type {Promise<{ value: string, refusal: string|null }> | null} */
    let pending = null;
    /* A browser closes a busy modal on repeated Escape. The running submit
       decides the answer, or a write that went through reads as a cancel. */
    const m = openModal({
      title,
      onClose: () => {
        if (!pending) resolve(answer);
        else
          pending.then(
            r => resolve(r.refusal ? null : r.value),
            () => resolve(null),
          );
      },
    });

    if (text) {
      const lead = document.createElement('p');
      lead.className = 'dlg-lead';
      lead.textContent = text;
      m.body.appendChild(lead);
    }
    const field = document.createElement('label');
    field.className = 'dlg-field';
    const cap = document.createElement('span');
    cap.textContent = label;
    const input = document.createElement('input');
    input.type = password ? 'password' : 'text';
    if (password) input.autocomplete = 'current-password';
    input.className = 'inp';
    if (placeholder) input.placeholder = placeholder;
    field.append(cap, input);
    m.body.appendChild(field);
    const err = document.createElement('p');
    err.className = 'dlg-err';
    err.id = uniqueId('dlg-err');
    err.hidden = true;
    m.body.appendChild(err);

    const showError = msg => {
      err.textContent = msg;
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', err.id);
      input.focus();
      input.select();
    };
    input.addEventListener('input', () => {
      if (err.hidden) return;
      err.hidden = true;
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });

    const accept = async () => {
      const v = password ? input.value : input.value.trim();
      if (!v || pending) return;
      if (submit) {
        m.setBusy(true);
        const run = (async () => {
          try {
            return { value: v, refusal: await submit(v) };
          } finally {
            m.setBusy(false);
          }
        })();
        pending = run;
        let refusal;
        try {
          ({ refusal } = await run);
        } finally {
          pending = null;
        }
        if (refusal) {
          if (input.isConnected) showError(refusal);
          return;
        }
      }
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
    m.addAction(confirmLabel, destructive ? 'bd-btn sm' : 'bp sm', accept);
    m.focus(input);
  });
}
