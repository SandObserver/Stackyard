// @ts-check
/* The list of apps, widgets and folders on the Settings dashboard page: one
   row, the whole list, and the filter chips above it.

   It came out of admin.js because that file is the largest in the project and
   this is the largest thing in it. Unlike the drag module it does not stand
   alone: opening the editor, opening the folder picker and writing the config
   all belong to the page, so the page injects them once. What lives here is
   everything about how a row is drawn and when the list is rebuilt.

   The filter and the collapsed folders are in admin-state.js, because the page
   reads and writes them too. */

import { collapsedFolders, filter, state } from '/js/admin-state.js?v=7d68e98e';
import { snapshotItems } from '/js/admin-save-logic.js?v=48a9e055';
import { reorderItems } from '/js/admin-logic.js?v=d17394da';
import { initDrag, wireRowDrag } from '/js/admin-drag.js?v=e1ffd5ea';
import { paintIcon } from '/js/admin-shared.js?v=76c76594';
import { clr as rc, el, qa, setUserText } from '/js/utils.js?v=d949e985';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { t } from '/js/i18n.js?v=e644a5c5';
import { sizeLabel } from '/js/admin-widget-form.js?v=a28e476c';
import { widgetGlyph } from '/js/widget-glyphs.js?v=12b0a947';

/** @type {{ openModal: (idx: number|null) => void,
             openFolderPicker: (appId: string|null, targetFolderId?: string|null) => void,
             save: (before: unknown) => Promise<boolean>|boolean }} */
let _page = {
  openModal: () => {},
  openFolderPicker: () => {},
  save: () => false,
};

/** What the page owns and the list only triggers. Call once at start-up.
    @param {typeof _page} page @returns {void} */
export function initList(page) {
  _page = page;
  initDrag(page.save);
}

/* Constant markup only. No user data reaches these. */
const FOLDER_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.7"></rect><circle cx="9.7" cy="9.7" r="1.25" fill="currentColor"></circle><circle cx="14.3" cy="9.7" r="1.25" fill="currentColor"></circle><circle cx="9.7" cy="14.3" r="1.25" fill="currentColor"></circle><circle cx="14.3" cy="14.3" r="1.25" fill="currentColor"></circle></svg>';
const SIZE_ICONS = {
  small:
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="9.7" cy="9.7" r="1" fill="currentColor"></circle><line x1="9" y1="13.4" x2="13" y2="13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></line></svg>',
  medium:
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="7.6" cy="11.4" r="1.1" fill="currentColor"></circle><line x1="10.2" y1="11.4" x2="16.5" y2="11.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="7" y1="14.3" x2="16.5" y2="14.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line></svg>',
  large:
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5.5" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="9" cy="9" r="1.2" fill="currentColor"></circle><line x1="8" y1="12.6" x2="16" y2="12.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="8" y1="14.8" x2="16" y2="14.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line></svg>',
  xlarge:
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><circle cx="9.7" cy="7" r="1.1" fill="currentColor"></circle><line x1="9" y1="10.5" x2="15" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="9" y1="12.7" x2="15" y2="12.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="9" y1="14.9" x2="15" y2="14.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line><line x1="9" y1="17.1" x2="13" y2="17.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></line></svg>',
};
function svgNode(markup) {
  const t = document.createElement('template');
  setHtml(t, raw(markup));
  return t.content.firstElementChild;
}

function moveRow(item, dir, opts = {}) {
  const before = snapshotItems(state.items);
  if (reorderItems(state.items, item, dir, opts)) _page.save(before);
}

export function mkRow(item, idx, { indent = false, childIdx = null, folderId = null } = {}) {
  const row = document.createElement('div');
  row.className = 'row drow';
  if (indent)
    row.style.cssText =
      'padding-left:28px;background:rgba(255,255,255,.02);border-left:2px solid var(--bd);margin-left:8px;border-radius:0 var(--rs) var(--rs) 0;';
  const _filtering = !!(filter.q || filter.type !== 'all');
  row.draggable = !_filtering;
  row.dataset.itemId = item.id;
  if (item.type === 'folder') row.dataset.isFolder = '1';
  if (indent) {
    row.dataset.indent = '1';
    row.dataset.folderId = folderId;
    row.dataset.childIdx = String(childIdx);
  }
  let canUp = false,
    canDown = false;
  if (folderId != null) {
    const cf = state.items.find(i => i.id === folderId);
    const n = (cf?.children || []).length;
    canUp = childIdx > 0;
    canDown = childIdx < n - 1;
  } else {
    const inF = new Set(state.items.filter(i => i.type === 'folder').flatMap(ff => ff.children || []));
    const top = state.items.filter(it => it.type === 'folder' || !inF.has(it.id));
    const p = top.indexOf(item);
    canUp = p > 0;
    canDown = p < top.length - 1;
  }
  const handle = document.createElement('div');
  handle.className = 'rord';
  handle.textContent = '⠿';
  handle.setAttribute('aria-hidden', 'true');
  if (_filtering) handle.style.visibility = 'hidden';
  const ico = document.createElement('div');
  ico.className = 'rico';
  ico.style.background = rc(item.color);
  if (item.type === 'folder') {
    ico.appendChild(svgNode(FOLDER_ICON));
  } else if (item.type === 'widget') {
    /* The type when the widget declares one, the size otherwise. */
    const glyph = widgetGlyph(state._widgetReg?.[item.widgetType]?.glyph);
    ico.appendChild(svgNode(glyph || SIZE_ICONS[item.widgetSize] || SIZE_ICONS.medium));
  } else if (item.iconUrl) {
    paintIcon(ico, item.iconUrl, (item.label || '?')[0].toUpperCase(), 'width:28px;height:28px;object-fit:contain;');
  } else ico.textContent = (item.label || item.id || '?')[0].toUpperCase();
  const inf = document.createElement('div');
  inf.className = 'rinf';
  const isFolderRow = item.type === 'folder';
  const nm = document.createElement(isFolderRow ? 'button' : 'div');
  nm.className = 'rnm';
  if (isFolderRow) {
    const collapsed = collapsedFolders.has(item.id);
    nm.setAttribute('type', 'button');
    nm.style.cssText = 'display:flex;align-items:center;gap:6px;';
    nm.setAttribute('aria-expanded', String(!collapsed));
    nm.setAttribute('aria-label', t(collapsed ? 'folder.expandAria' : 'folder.collapseAria', { name: item.label }));
    const chevron = document.createElement('span');
    chevron.style.cssText = 'font-size:10px;color:var(--dm);transition:transform .15s;flex-shrink:0;';
    chevron.textContent = '▼';
    chevron.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    chevron.id = 'chev-' + item.id;
    nm.append(chevron, document.createTextNode(item.label));
    nm.onclick = e => {
      e.stopPropagation();
      if (collapsedFolders.has(item.id)) {
        collapsedFolders.delete(item.id);
      } else {
        collapsedFolders.add(item.id);
      }
      render();
    };
  } else {
    setUserText(nm, item.label || item.id);
  }
  const mt = document.createElement('div');
  mt.className = 'rmt';
  if (item.type === 'widget') {
    const wt = item.widgetType || 'custom';
    const wtLabel = state._widgetReg?.[wt]?.label || 'Custom';
    mt.textContent = t('widgetCfg.meta', { type: wtLabel, size: sizeLabel(item.widgetSize || 'medium') });
  } else if (item.type === 'folder') mt.textContent = t('folder.appsCount', { count: (item.children || []).length });
  else if (item.system === 'settings') mt.textContent = t('home.opensSettings');
  else mt.textContent = item.href || '';
  inf.append(nm, mt);
  const pb = document.createElement('div');
  pb.className = 'rpills';
  const pills = [];
  if (item.dock) pills.push(html`<span class="pill p-dk">${t('app.dockPill')}</span>`);
  if (item.type === 'widget') pills.push(html`<span class="pill p-wg">${t('type.widget')}</span>`);
  if (item.type === 'folder') pills.push(html`<span class="pill p-fl">${t('type.folder')}</span>`);
  if (item.monitoring?.healthcheck?.enabled || item.container)
    pills.push(html`<span class="pill p-hl">${t('app.healthPill')}</span>`);
  if (item.monitoring?.activity?.enabled || item.badge?.enabled)
    pills.push(html`<span class="pill p-bg">${t('app.badgePill')}</span>`);
  if (item.system === 'settings') pills.push(html`<span class="pill p-sy">${t('pill.system')}</span>`);
  if (item.hidden) pills.push(html`<span class="pill p-hd">${t('pill.hidden')}</span>`);
  setHtml(pb, html`${pills}`);
  const ac = document.createElement('div');
  ac.className = 'ract';
  const mkMove = (dir, can) => {
    const b = document.createElement('button');
    b.className = 'btn bg sm ic';
    const lbl = t(dir < 0 ? 'common.moveUp' : 'common.moveDown');
    b.title = lbl;
    b.setAttribute('aria-label', lbl + ': ' + (item.label || item.id || t('type.app')));
    b.textContent = dir < 0 ? '↑' : '↓';
    b.disabled = !can;
    b.onclick = () => moveRow(item, dir, { folderId, childIdx });
    return b;
  };
  if (!_filtering) ac.append(mkMove(-1, canUp), mkMove(1, canDown));
  if (item.system === 'settings') {
    const hb = document.createElement('button');
    hb.className = 'btn bg sm';
    hb.textContent = t(item.hidden ? 'common.show' : 'common.hide');
    const lbl = t(item.hidden ? 'general.showSettingsAria' : 'general.hideSettingsAria');
    hb.title = lbl;
    hb.setAttribute('aria-label', lbl);
    hb.onclick = () => {
      const before = snapshotItems(state.items);
      item.hidden = !item.hidden;
      _page.save(before);
    };
    ac.append(hb);
  } else {
    const ed = document.createElement('button');
    ed.className = 'btn bg sm';
    ed.textContent = t('common.edit');
    ed.onclick = () => _page.openModal(idx);
    ac.append(ed);
  }
  row.append(handle, ico, inf, pb, ac);
  wireRowDrag(row, handle, { item, indent, folderId, childIdx });
  return row;
}

export function render() {
  const l = el('al');
  const bar = el('al-filter');
  const grp = el('al-grp');
  if (bar) {
    if (state.items.length >= 6) bar.style.display = '';
    else {
      bar.style.display = 'none';
      if (filter.q || filter.type !== 'all') {
        filter.q = '';
        filter.type = 'all';
        syncFilterUI();
      }
    }
  }
  if (grp) grp.style.display = state.items.length ? '' : 'none';
  if (!state.items.length) {
    setHtml(l, html`<div class="empty"><p class="empty-msg">${t('list.empty')}</p></div>`);
    return;
  }
  l.replaceChildren();
  if (filter.q || filter.type !== 'all') {
    const q = filter.q.toLowerCase();
    const matches = state.items.filter(it => {
      if (filter.type !== 'all' && it.type !== filter.type) return false;
      if (q) {
        const hay = ((it.label || '') + ' ' + (it.href || '') + ' ' + (it.widgetType || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (!matches.length) {
      setHtml(l, html`<div class="empty"><p class="empty-msg">${t('list.noMatches')}</p></div>`);
      return;
    }
    matches.forEach(item => l.appendChild(mkRow(item, state.items.indexOf(item))));
    return;
  }
  const inFolder = new Set(state.items.filter(i => i.type === 'folder').flatMap(f => f.children || []));
  state.items.forEach((item, idx) => {
    if (item.type !== 'folder' && inFolder.has(item.id)) return;
    l.appendChild(mkRow(item, idx));
    if (item.type === 'folder' && !collapsedFolders.has(item.id)) {
      (item.children || []).forEach((childId, ci) => {
        const childItem = state.items.find(i => i.id === childId);
        if (!childItem) return;
        l.appendChild(
          mkRow(childItem, state.items.indexOf(childItem), { indent: true, childIdx: ci, folderId: item.id }),
        );
      });
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'fp-add';
      setHtml(addRow, html`<span>+</span> ${t('folder.addAppToFolder')}`);
      addRow.onclick = () => _page.openFolderPicker(null, item.id);
      l.appendChild(addRow);
    }
  });
}
export function syncFilterUI() {
  const s = /** @type {HTMLInputElement} */ (el('al-search'));
  if (s) s.value = filter.q;
  qa('#al-filter .chip').forEach(c => {
    const on = c.dataset.flt === filter.type;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  });
}
