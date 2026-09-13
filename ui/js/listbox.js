// @ts-check
/* The picker for every list in the admin.

   Keep the list on <body>. Inside its row the settings panel clips it.

   Do not use popover. The top layer makes iOS collapse its browser toolbar,
   which exposes a strip of page canvas and misplaces the menu. */

import { nextActiveIndex } from '/js/admin-logic.js?v=74cb4272';
import { fluidHoverClear, fluidHoverKb } from '/js/fluid-hover.js?v=cb886e86';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { qa } from '/js/utils.js?v=970a91b0';

const CHEV =
  '<svg class="dd-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5 12 6.5 16 10.5"/><path d="M8 13.5 12 17.5 16 13.5"/></svg>';

const TYPEAHEAD_MS = 800;

let seq = 0;

/* The lists live on <body> while their rows do not, and the admin rebuilds a
   form by replacing its children. Without this every rebuild strands one list
   per picker on the page for the rest of the session. */
const mounted = new Set();
function pruneDetached() {
  for (const m of mounted) {
    /* `placed` is set a microtask after creation, by which time the caller has
       attached the row. Before that the entry is new, not abandoned. */
    if (!m.placed || m.dd.isConnected) continue;
    m.list.remove();
    mounted.delete(m);
  }
}

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]';

/** The list is last on <body>, so the browser's own Tab would leave the form.

    @param {HTMLElement} from @param {1|-1} step */
function focusBeside(from, step) {
  const all = qa(FOCUSABLE, document).filter(
    n =>
      n === from ||
      (n.tabIndex >= 0 &&
        !(/** @type {any} */ (n).disabled) &&
        n.getClientRects().length &&
        !n.closest('.row-dd-list')),
  );
  const next = all[all.indexOf(from) + step];
  (next || from).focus();
}

/** An entry with `group` and no `value` is a heading. The keyboard skips it.

    @typedef {{ value?: string, label?: string, group?: string }} ListboxOption */

/** Builds a picker and returns it with its own small API.

    @param {{ options?: ListboxOption[], value?: string|string[],
              multiple?: boolean, label: string, placeholder?: string,
              summary?: (selected: ListboxOption[]) => string,
              onChange?: (value: any) => void, emptyText?: string,
              id?: string }} opts
    @returns {{ el: HTMLElement, button: HTMLElement, list: HTMLElement,
                getValue: () => any, setValue: (v: any) => void,
                setOptions: (o: ListboxOption[], v?: any) => void,
                setLabel: (l: string) => void,
                close: () => void }} */
export function createListbox(
  {
    options = [],
    value,
    multiple = false,
    label,
    placeholder = '',
    summary,
    onChange,
    emptyText = '',
    id = '',
  } = /** @type {any} */ ({}),
) {
  let opts = options.slice();
  let chosen = multiple
    ? new Set((Array.isArray(value) ? value : []).map(String))
    : new Set(value == null || value === '' ? [] : [String(value)]);

  /* The list is not a descendant of its button, so the two are tied by id. */
  const listId = id ? `${id}-list` : `lb-${++seq}`;
  const dd = document.createElement('div');
  dd.className = 'row-dd';
  setHtml(
    dd,
    html`<button class="row-dd-btn"${raw(id ? ` id="${id}-btn"` : '')} type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}"><span class="row-dd-text"></span>${raw(CHEV)}</button>
      <ul class="row-dd-list${multiple ? ' checklist' : ''}" id="${listId}" role="listbox" aria-label="${label}"${raw(multiple ? ' aria-multiselectable="true"' : '')}></ul>`,
  );
  const btn = /** @type {HTMLElement} */ (dd.querySelector('.row-dd-btn'));
  const text = /** @type {HTMLElement} */ (dd.querySelector('.row-dd-text'));
  const list = /** @type {HTMLElement} */ (dd.querySelector('.row-dd-list'));
  pruneDetached();
  list.remove();
  list.hidden = true;
  document.body.appendChild(list);
  const entry = { dd, list, placed: false };
  mounted.add(entry);
  queueMicrotask(() => {
    entry.placed = true;
  });

  const selected = () => opts.filter(o => o.group == null && chosen.has(String(o.value)));
  const items = () => qa('li[role="option"]', list);

  function paintButton() {
    const sel = selected();
    if (summary) text.textContent = summary(sel);
    else if (!sel.length) text.textContent = placeholder;
    else text.textContent = sel.map(o => o.label).join(', ');
    text.classList.toggle('is-ph', !sel.length && !summary);
  }

  function paintList() {
    if (!opts.length && emptyText) {
      setHtml(list, html`<li class="row-dd-empty">${emptyText}</li>`);
      return;
    }
    setHtml(
      list,
      html`${opts.map(o =>
        o.group != null
          ? html`<li class="row-dd-group" role="presentation">${o.group}</li>`
          : html`<li role="option" data-val="${o.value}" aria-selected="${String(chosen.has(String(o.value)))}">${o.label}</li>`,
      )}`,
    );
    items().forEach(li => {
      li.tabIndex = -1;
    });
  }

  function paint() {
    paintList();
    paintButton();
  }

  let active = -1;
  let open_ = false;
  /* Scoped to the open state. A listener that outlives the list holds the
     detached row it closes over, and the admin rewires on every render. */
  let outside = null;

  function place() {
    const r = btn.getBoundingClientRect();
    const pr = list.getBoundingClientRect();
    /* Not the layout viewport. iOS grows the visible area past it. */
    const vh = visualViewport?.height ?? window.innerHeight;
    const vw = visualViewport?.width ?? window.innerWidth;
    const gap = 4;
    let top = r.bottom + gap;
    if (top + pr.height > vh - 8) top = Math.max(8, r.top - gap - pr.height);
    const rtl = (document.documentElement.getAttribute('dir') || 'ltr') === 'rtl';
    let left = rtl ? r.left : r.right - pr.width;
    left = Math.min(Math.max(8, left), vw - pr.width - 8);
    list.style.top = `${Math.round(top)}px`;
    list.style.left = `${Math.round(left)}px`;
  }

  const setActive = i => {
    const o = items();
    if (!o.length || i == null) return;
    active = i;
    o.forEach((li, n) => {
      li.tabIndex = n === active ? 0 : -1;
      li.classList.toggle('kb-active', n === active);
    });
    o[active].focus();
    fluidHoverKb(o[active]);
  };

  const open = () => {
    if (open_) return;
    list.hidden = false;
    open_ = true;
    btn.setAttribute('aria-expanded', 'true');
    place();
    outside = new AbortController();
    /* The visible area resizes a frame after the menu opens. */
    visualViewport?.addEventListener('resize', place, { signal: outside.signal });
    visualViewport?.addEventListener('scroll', place, { signal: outside.signal });
    document.addEventListener(
      'scroll',
      e => {
        if (!list.contains(/** @type {Node} */ (e.target))) close();
      },
      { capture: true, signal: outside.signal },
    );
    document.addEventListener(
      'click',
      e => {
        const t = /** @type {Node} */ (e.target);
        if (!dd.contains(t) && !list.contains(t)) close();
      },
      { signal: outside.signal },
    );
    const o = items();
    const first = o.findIndex(li => li.getAttribute('aria-selected') === 'true');
    setActive(first >= 0 ? first : 0);
  };

  const close = ({ focusBtn = false } = {}) => {
    outside?.abort();
    outside = null;
    list.hidden = true;
    open_ = false;
    btn.setAttribute('aria-expanded', 'false');
    items().forEach(li => li.classList.remove('kb-active'));
    fluidHoverClear(list);
    if (focusBtn) btn.focus();
  };

  function commit(li) {
    const val = li.dataset.val;
    if (val == null) return;
    if (multiple) {
      if (chosen.has(val)) chosen.delete(val);
      else chosen.add(val);
      const keep = active;
      paint();
      setActive(keep);
    } else {
      chosen = new Set([val]);
      paint();
      close({ focusBtn: true });
    }
    onChange?.(getValue());
  }

  let typed = '';
  let typedAt = 0;
  function typeahead(key) {
    const now = Date.now();
    typed = now - typedAt > TYPEAHEAD_MS ? key : typed + key;
    typedAt = now;
    const o = items();
    const from = typed.length === 1 ? active + 1 : active;
    for (let n = 0; n < o.length; n++) {
      const i = (from + n + o.length) % o.length;
      if ((o[i].textContent || '').trim().toLowerCase().startsWith(typed.toLowerCase())) {
        setActive(i);
        return true;
      }
    }
    return false;
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (open_) close();
    else open();
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (!open_) {
        e.preventDefault();
        open();
      }
    }
  });

  list.addEventListener('click', e => {
    const li = /** @type {HTMLElement} */ (e.target).closest('li[role="option"]');
    if (li) commit(/** @type {HTMLElement} */ (li));
  });
  list.addEventListener('keydown', e => {
    const o = items();
    if (!o.length) return;
    const moved = nextActiveIndex(e.key, active, o.length);
    if (moved != null) {
      e.preventDefault();
      setActive(moved);
      return;
    }
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (o[active]) commit(o[active]);
        break;
      case 'Escape':
        e.preventDefault();
        close({ focusBtn: true });
        break;
      case 'Tab':
        e.preventDefault();
        close();
        focusBeside(btn, e.shiftKey ? -1 : 1);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && typeahead(e.key)) e.preventDefault();
        break;
    }
  });

  const getValue = () =>
    multiple
      ? opts
          .filter(o => o.group == null)
          .map(o => String(o.value))
          .filter(v => chosen.has(v))
      : [...chosen][0];

  paint();

  return {
    el: dd,
    button: btn,
    list,
    getValue,
    setValue(v) {
      chosen = multiple
        ? new Set((Array.isArray(v) ? v : []).map(String))
        : new Set(v == null || v === '' ? [] : [String(v)]);
      paint();
    },
    setOptions(next, v) {
      opts = (next || []).slice();
      if (v !== undefined) {
        chosen = multiple
          ? new Set((Array.isArray(v) ? v : []).map(String))
          : new Set(v == null || v === '' ? [] : [String(v)]);
      } else if (!multiple) {
        /* A refreshed list may no longer carry what was chosen. */
        const still = [...chosen].filter(c => opts.some(o => String(o.value) === c));
        chosen = new Set(still);
      }
      paint();
    },
    setLabel(next) {
      list.setAttribute('aria-label', next);
    },
    close: () => close(),
  };
}
