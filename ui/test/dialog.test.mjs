/* Regression tests for P9-4 and P10-5: dialogs that focus could escape.

   Focus belongs inside an open dialog. Tab at the last control should return to
   the first rather than moving into the page behind, which is still there and
   still focusable while being visually covered. Without that, a keyboard user
   tabs out of the dialog into controls they cannot see, with nothing on screen
   saying where they are.

   The search overlay did this correctly and the other two did not, but its trap
   was written inline against its own elements, so there was nothing to reuse.
   That is the logic here.

   The state before this:

     search overlay   Tab trapped, Escape closes, focus restored
     folder (desktop) Escape closes, focus restored, no Tab trap
     folder (mobile)  none of the three
     setup prompt     none of the three

   Escape and focus restoration are part of this rather than a separate concern,
   because a Tab trap without them is worse than none: focus that cannot leave,
   and no way to close the thing holding it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* Enough DOM for focus and Tab. Real browsers decide focusability with layout,
   which is not available here, so visibility is modelled explicitly. */
function makeDom() {
  const listeners = new Map();
  let active = null;

  const el = (tag, opts = {}) => {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      parent: null,
      isConnected: true,
      hidden: false,
      disabled: opts.disabled || false,
      attrs: new Map(Object.entries(opts.attrs || {})),
      offsetParent: opts.hidden ? null : {},
      focus() { active = this; this.focused = (this.focused || 0) + 1; },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      setAttribute(k, v) { this.attrs.set(k, v); },
      contains(other) {
        if (other === this) return true;
        return this.children.some(c => c.contains && c.contains(other));
      },
      append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } },
      querySelectorAll(sel) {
        /* Only the shapes the module asks for. */
        const wanted = sel.split(',').map(s => s.trim());
        const out = [];
        const walk = n => {
          for (const c of n.children) {
            const matches = wanted.some(w => {
              if (w.startsWith('a[href]')) return c.tagName === 'A' && c.getAttribute('href') != null;
              if (w.startsWith('button')) return c.tagName === 'BUTTON' && !c.disabled;
              if (w.startsWith('input')) return c.tagName === 'INPUT' && !c.disabled;
              if (w.startsWith('select')) return c.tagName === 'SELECT' && !c.disabled;
              if (w.startsWith('textarea')) return c.tagName === 'TEXTAREA' && !c.disabled;
              if (w.startsWith('[tabindex]')) return c.getAttribute('tabindex') != null && c.getAttribute('tabindex') !== '-1';
              return false;
            });
            if (matches) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      addEventListener(type, fn) {
        if (!listeners.has(this)) listeners.set(this, []);
        listeners.get(this).push({ type, fn });
      },
      removeEventListener(type, fn) {
        const l = listeners.get(this) || [];
        const at = l.findIndex(x => x.type === type && x.fn === fn);
        if (at !== -1) l.splice(at, 1);
      },
      _fire(type, event) {
        for (const l of (listeners.get(this) || []).filter(x => x.type === type)) l.fn(event);
      },
      _listenerCount() { return (listeners.get(this) || []).length; },
    };
    return node;
  };

  globalThis.document = {
    get activeElement() { return active; },
    createElement: t => el(t),
  };
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block', position: 'static' });

  return { el, setActive: n => { active = n; }, getActive: () => active };
}

function keyEvent(key, shiftKey = false) {
  const e = { key, shiftKey, defaultPrevented: false };
  e.preventDefault = () => { e.defaultPrevented = true; };
  return e;
}

async function withDom(fn) {
  const dom = makeDom();
  const mod = await import('../js/dialog.js');
  try { await fn(mod, dom); } finally { delete globalThis.document; delete globalThis.getComputedStyle; }
}

/* A dialog with three focusable controls and one that is not. */
function dialogOf(dom) {
  const ov = dom.el('div');
  const first = dom.el('button');
  const middle = dom.el('input');
  const disabled = dom.el('button', { disabled: true });
  const last = dom.el('a', { attrs: { href: '#' } });
  ov.append(first, middle, disabled, last);
  return { ov, first, middle, disabled, last };
}

/* ── what is focusable ────────────────────────────────────────────────────── */

test('the focusable controls are found in order', async () => {
  await withDom(({ focusableWithin }, dom) => {
    const { ov, first, middle, last } = dialogOf(dom);
    assert.deepEqual(focusableWithin(ov), [first, middle, last]);
  });
});

test('a disabled control is not focusable', async () => {
  await withDom(({ focusableWithin }, dom) => {
    const { ov, disabled } = dialogOf(dom);
    assert.ok(!focusableWithin(ov).includes(disabled));
  });
});

test('a hidden control is not focusable', async () => {
  await withDom(({ focusableWithin }, dom) => {
    const ov = dom.el('div');
    const shown = dom.el('button');
    const hidden = dom.el('button', { hidden: true });
    ov.append(shown, hidden);
    assert.deepEqual(focusableWithin(ov), [shown]);
  });
});

test('focusableWithin tolerates junk', async () => {
  await withDom(({ focusableWithin }) => {
    for (const v of [null, undefined, {}, 'x']) assert.deepEqual(focusableWithin(v), []);
  });
});

/* ── the trap itself ──────────────────────────────────────────────────────── */

test('Tab at the last control returns to the first', async () => {
  await withDom(({ wrapTab }, dom) => {
    const { ov, first, last } = dialogOf(dom);
    dom.setActive(last);
    const e = keyEvent('Tab');
    assert.equal(wrapTab(e, ov), true);
    assert.ok(e.defaultPrevented, 'the browser must not move focus itself');
    assert.equal(dom.getActive(), first);
  });
});

test('Shift+Tab at the first control goes to the last', async () => {
  await withDom(({ wrapTab }, dom) => {
    const { ov, first, last } = dialogOf(dom);
    dom.setActive(first);
    const e = keyEvent('Tab', true);
    assert.equal(wrapTab(e, ov), true);
    assert.equal(dom.getActive(), last);
  });
});

/* Tabbing between controls is the browser's job; the trap only acts at the
   ends, or it would fight normal navigation. */
test('Tab in the middle is left to the browser', async () => {
  await withDom(({ wrapTab }, dom) => {
    const { ov, middle } = dialogOf(dom);
    dom.setActive(middle);
    const e = keyEvent('Tab');
    assert.equal(wrapTab(e, ov), false);
    assert.ok(!e.defaultPrevented);
  });
});

/* The case that made this a bug rather than a nicety: focus outside the dialog,
   which is where it ends up if the dialog opens with nothing focused. */
test('Tab with focus outside the dialog pulls it back in', async () => {
  await withDom(({ wrapTab }, dom) => {
    const { ov, first } = dialogOf(dom);
    const outside = dom.el('button');
    dom.setActive(outside);
    assert.equal(wrapTab(keyEvent('Tab'), ov), true);
    assert.equal(dom.getActive(), first, 'focus must not stay behind the dialog');
  });
});

test('a key that is not Tab is ignored', async () => {
  await withDom(({ wrapTab }, dom) => {
    const { ov, last } = dialogOf(dom);
    dom.setActive(last);
    for (const key of ['Enter', 'a', 'ArrowDown', 'Escape']) {
      assert.equal(wrapTab(keyEvent(key), ov), false);
    }
  });
});

test('a dialog with nothing focusable does not throw', async () => {
  await withDom(({ wrapTab }, dom) => {
    const ov = dom.el('div');
    assert.doesNotThrow(() => wrapTab(keyEvent('Tab'), ov));
    assert.equal(wrapTab(keyEvent('Tab'), ov), false);
  });
});

/* ── trapFocus, the whole behaviour ───────────────────────────────────────── */

test('opening focuses the first control', async () => {
  await withDom(({ trapFocus }, dom) => {
    const { ov, first } = dialogOf(dom);
    trapFocus(ov);
    assert.equal(dom.getActive(), first);
  });
});

test('an explicit initial focus is honoured', async () => {
  await withDom(({ trapFocus }, dom) => {
    const { ov, middle } = dialogOf(dom);
    trapFocus(ov, { initialFocus: middle });
    assert.equal(dom.getActive(), middle);
  });
});

/* The half that is easy to forget: without it, closing a dialog leaves focus on
   nothing and the next Tab starts from the top of the page. */
test('closing returns focus to whatever opened it', async () => {
  await withDom(({ trapFocus }, dom) => {
    const opener = dom.el('button');
    dom.setActive(opener);
    const { ov } = dialogOf(dom);
    const release = trapFocus(ov);
    assert.notEqual(dom.getActive(), opener, 'focus moves into the dialog');
    release();
    assert.equal(dom.getActive(), opener);
  });
});

test('focus is not restored to an element that has left the page', async () => {
  await withDom(({ trapFocus }, dom) => {
    const opener = dom.el('button');
    dom.setActive(opener);
    const { ov, first } = dialogOf(dom);
    const release = trapFocus(ov);
    opener.isConnected = false;
    assert.doesNotThrow(() => release());
    assert.equal(dom.getActive(), first, 'focus stays where it was');
  });
});

test('Escape closes by default', async () => {
  await withDom(({ trapFocus }, dom) => {
    const { ov } = dialogOf(dom);
    let closed = 0;
    trapFocus(ov, { onClose: () => { closed++; } });
    ov._fire('keydown', keyEvent('Escape'));
    assert.equal(closed, 1);
  });
});

/* The setup prompt turns this off: dismissing it silently means "no password",
   so the choice should be deliberate. */
test('Escape can be turned off', async () => {
  await withDom(({ trapFocus }, dom) => {
    const { ov } = dialogOf(dom);
    let closed = 0;
    trapFocus(ov, { closeOnEscape: false, onClose: () => { closed++; } });
    ov._fire('keydown', keyEvent('Escape'));
    assert.equal(closed, 0);
  });
});

test('releasing removes the listener', async () => {
  await withDom(({ trapFocus }, dom) => {
    const { ov } = dialogOf(dom);
    const before = ov._listenerCount();
    const release = trapFocus(ov);
    assert.equal(ov._listenerCount(), before + 1);
    release();
    assert.equal(ov._listenerCount(), before, 'a trap that outlives its dialog would capture later keys');
  });
});

/* A dialog can be closed by more than one route: Escape, a button, a click
   outside. Releasing twice must be harmless. */
test('releasing twice is harmless', async () => {
  await withDom(({ trapFocus }, dom) => {
    const { ov } = dialogOf(dom);
    const release = trapFocus(ov);
    assert.doesNotThrow(() => { release(); release(); });
  });
});

test('trapFocus tolerates a missing root', async () => {
  await withDom(({ trapFocus }) => {
    assert.doesNotThrow(() => trapFocus(null)());
  });
});

/* ── every dialog uses it ─────────────────────────────────────────────────── */

test('all four dialogs use the shared behaviour', () => {
  const sites = [
    ['js/spotlight.js', /wrapTab\(e, ov\)/, 'the search overlay'],
    ['js/ui.js', /trapFocus\(ov, \{ closeOnEscape: false, onClose: closeDesk \}\)/, 'the desktop folder overlay'],
    ['js/ui.js', /releaseMobTrap = trapFocus\(ov, \{ onClose: closeMob \}\)/, 'the mobile folder overlay'],
    ['js/dashboard.js', /trapFocus\(ov, \{ closeOnEscape: false, initialFocus: pw \}\)/, 'the setup prompt'],
  ];
  for (const [file, pattern, what] of sites) {
    assert.match(read(file), pattern, `${what} does not use the shared trap`);
  }
});

test('every dialog releases its trap when it closes', () => {
  /* A trap that outlives its dialog keeps a listener on a removed element and
     never restores focus. */
  const ui = read('js/ui.js');
  assert.match(ui, /if \(releaseDeskTrap\) \{ releaseDeskTrap\(\); releaseDeskTrap = null; \}/);
  assert.match(ui, /if \(releaseMobTrap\) \{ releaseMobTrap\(\); releaseMobTrap = null; \}/);
  assert.match(read('js/dashboard.js'), /if \(releaseTrap\) \{ releaseTrap\(\); releaseTrap = null; \}/);
});

test('nothing keeps its own copy of the trap', () => {
  /* The search overlay's inline version is what left the others with nothing to
     reuse. */
  for (const file of ['js/spotlight.js', 'js/ui.js', 'js/dashboard.js']) {
    assert.doesNotMatch(read(file), /e\.shiftKey && document\.activeElement === first/,
      `${file} still carries its own trap`);
  }
});
