/* The dialog the admin UI opens for anything the browser's own confirm() and
   prompt() cannot show. It replaced them, so it owes what they gave for free:
   a backdrop that dismisses, Escape, and an answer that comes back once.

   It is a native <dialog> now, so Escape and focus restoration belong to the
   browser and are not re-tested here. What is still ours is which clicks
   dismiss and that an answer arrives exactly once, however the dialog went.

   The dismissal routes are what these cover. A dialog that closes when it
   should not is worse than the browser's version, because the import preview
   behind it is a list someone reads before deciding, and a dropped answer
   reads as Cancel and discards the whole import. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

/* Enough DOM for appending, dismissing and focus. Layout decides focusability
   in a browser and there is none here, so everything visible counts. */
function makeDom() {
  const listeners = new Map();
  let active = null;

  const el = tag => ({
    tagName: tag.toUpperCase(),
    children: [],
    parent: null,
    isConnected: true,
    open: false,
    _on: new Map(),
    addEventListener(type, fn) {
      if (!this._on.has(type)) this._on.set(type, []);
      this._on.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = this._on.get(type) || [];
      const at = l.indexOf(fn);
      if (at !== -1) l.splice(at, 1);
    },
    _fire(type) {
      for (const fn of [...(this._on.get(type) || [])]) fn({ type, target: this });
    },
    /* The browser's own contract: showModal opens it, close fires `close`, and
       closing an already-closed dialog does nothing. */
    showModal() {
      this.open = true;
    },
    close() {
      if (!this.open) return;
      this.open = false;
      this._fire('close');
    },
    disabled: false,
    className: '',
    textContent: '',
    offsetParent: {},
    attrs: new Map(),
    focus() {
      active = this;
    },
    getAttribute(k) {
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    },
    setAttribute(k, v) {
      this.attrs.set(k, v);
    },
    append(...kids) {
      for (const k of kids) {
        k.parent = this;
        this.children.push(k);
      }
    },
    appendChild(k) {
      this.append(k);
      return k;
    },
    contains(other) {
      return other === this || this.children.some(c => c.contains && c.contains(other));
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
      this.isConnected = false;
    },
    querySelectorAll(sel) {
      const wanted = sel.split(',').map(s => s.trim());
      const out = [];
      const walk = n => {
        for (const c of n.children) {
          const hit = wanted.some(w => w.startsWith(c.tagName.toLowerCase()));
          if (hit && !c.disabled) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
  });

  const body = el('div');
  const doc = {
    get activeElement() {
      return active;
    },
    body,
    createElement: el,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = listeners.get(type) || [];
      const at = l.indexOf(fn);
      if (at !== -1) l.splice(at, 1);
    },
    _fire(type, event) {
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    },
  };

  globalThis.document = doc;
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block', position: 'static' });
  return { el, doc, body, setActive: n => (active = n), getActive: () => active };
}

async function withDom(fn) {
  const dom = makeDom();
  const mod = await import('../js/modal.js');
  try {
    return await fn(mod, dom);
  } finally {
    delete globalThis.document;
    delete globalThis.getComputedStyle;
  }
}

const dialog = dom => dom.body.children[dom.body.children.length - 1];
const buttons = box => box.children[2].children;

/* The backdrop is not an element, so a click on it is reported against the
   dialog. Both ends are given: a selection dragged out of the dialog comes up
   there having gone down inside. */
function clickFrom(dlg, downTarget, upTarget) {
  dlg.onmousedown({ target: downTarget });
  dlg.onclick({ target: upTarget });
}

/* Escape is the browser's, and it closes the dialog rather than calling back
   into the module. */
const pressEscape = dlg => dlg.close();

test('the backdrop dismisses when the click both starts and ends on it', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    openModal({ title: 'T', onClose: () => closed++ });
    const dlg = dialog(dom);
    clickFrom(dlg, dlg, dlg);
    assert.equal(closed, 1);
    assert.equal(dom.body.children.includes(dlg), false, 'the dialog is gone');
  });
});

/* Selecting a line of the preview and releasing past the edge of the dialog.
   Dismissing there discards an import the person was still reading. */
test('a selection released on the backdrop does not dismiss', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    const m = openModal({ title: 'T', onClose: () => closed++ });
    const dlg = dialog(dom);
    clickFrom(dlg, m.body, dlg);
    assert.equal(closed, 0);
    assert.equal(dom.body.children.includes(dlg), true, 'the dialog is still open');
  });
});

test('a click inside the dialog does not dismiss', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    const m = openModal({ title: 'T', onClose: () => closed++ });
    clickFrom(dialog(dom), m.body, m.body);
    assert.equal(closed, 0);
  });
});

/* Escape reaches the dialog wherever focus sits inside it, because the browser
   owns the key now. The caller must still be told exactly once. */
test('Escape answers the caller once', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    const m = openModal({ title: 'T', onClose: () => closed++ });
    m.addAction('OK', 'bp sm');
    pressEscape(dialog(dom));
    assert.equal(closed, 1);
  });
});

test('Escape after close does not answer twice', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    const m = openModal({ title: 'T', onClose: () => closed++ });
    /* Held before closing: a closed dialog is removed from the page. */
    const dlg = dialog(dom);
    m.close();
    pressEscape(dlg);
    assert.equal(closed, 1);
  });
});

test('close is safe to call twice, so two dismissal routes answer once', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    const m = openModal({ title: 'T', onClose: () => closed++ });
    m.close();
    m.close();
    assert.equal(closed, 1);
  });
});

test('focusing twice leaves nothing behind to answer again', async () => {
  await withDom(({ openModal }, dom) => {
    let closed = 0;
    const m = openModal({ title: 'T', onClose: () => closed++ });
    const a = m.addAction('OK', 'bp sm');
    m.focus(a);
    m.focus(a);
    assert.equal(dom.getActive(), a, 'focus did not land on the requested control');
    pressEscape(dialog(dom));
    assert.equal(closed, 1);
  });
});

test('the dialog is opened as a modal, not merely appended', async () => {
  await withDom(({ openModal }, dom) => {
    openModal({ title: 'T' });
    assert.equal(dialog(dom).tagName, 'DIALOG', 'the page behind it is only inert for a real dialog');
    assert.equal(dialog(dom).open, true, 'showModal was never called');
  });
});

test('confirmModal resolves true on the confirming action and false otherwise', async () => {
  await withDom(async ({ confirmModal }, dom) => {
    const yes = confirmModal({ title: 'T', body: dom.el('p'), confirmLabel: 'Go', cancelLabel: 'No' });
    buttons(dialog(dom))[1].onclick();
    assert.equal(await yes, true);

    const no = confirmModal({ title: 'T', body: dom.el('p'), confirmLabel: 'Go', cancelLabel: 'No' });
    buttons(dialog(dom))[0].onclick();
    assert.equal(await no, false);
  });
});

/* Dismissing is not an answer. The caller treats false as Cancel, which is the
   safe reading for a destructive action. */
test('confirmModal resolves false when the backdrop dismisses it', async () => {
  await withDom(async ({ confirmModal }, dom) => {
    const answer = confirmModal({ title: 'T', body: dom.el('p'), confirmLabel: 'Go', cancelLabel: 'No' });
    const dlg = dialog(dom);
    clickFrom(dlg, dlg, dlg);
    assert.equal(await answer, false);
  });
});

test('promptModal returns the trimmed value and refuses an empty one', async () => {
  await withDom(async ({ promptModal }, dom) => {
    const answer = promptModal({ title: 'T', label: 'Name', confirmLabel: 'Save', cancelLabel: 'No' });
    const box = dialog(dom);
    const input = box.children[1].children[0].children[1];

    input.value = '   ';
    buttons(box)[1].onclick();
    assert.equal(dom.body.children.includes(box), true, 'an empty value keeps the dialog open');

    input.value = '  Media  ';
    buttons(box)[1].onclick();
    assert.equal(await answer, 'Media');
  });
});

test('promptModal resolves null when it is cancelled', async () => {
  await withDom(async ({ promptModal }, dom) => {
    const answer = promptModal({ title: 'T', label: 'Name', confirmLabel: 'Save', cancelLabel: 'No' });
    buttons(dialog(dom))[0].onclick();
    assert.equal(await answer, null);
  });
});

test('two open dialogs label their headings apart', async () => {
  await withDom(({ openModal }, dom) => {
    const a = openModal({ title: 'One' });
    const b = openModal({ title: 'Two' });
    assert.notEqual(a.box.getAttribute('aria-labelledby'), b.box.getAttribute('aria-labelledby'));
  });
});
