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

import { collapsedFolders, filter, state } from '/js/admin-state.js?v=831e219e';
import { snapshotItems } from '/js/admin-save-logic.js?v=60a82419';
import { reorderItems } from '/js/admin-logic.js?v=5356a1b3';
import { initDrag, wireRowDrag } from '/js/admin-drag.js?v=c731b6aa';
import { paintIcon } from '/js/admin-shared.js?v=7c3b99fa';
import { clr as rc, el, qa, setUserText } from '/js/utils.js?v=843b7c2b';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { t } from '/js/i18n.js?v=1f1ea9c1';
import { sizeLabel } from '/js/admin-widget-form.js?v=31294103';
import { widgetGlyph } from '/js/widget-glyphs.js?v=3adb57ad';
import { iconSvg } from '/js/icon-set.js?v=606a68c6';

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
const FOLDER_ICON = iconSvg('folder', 26);
const SIZE_ICONS = {
  small: iconSvg('small', 26),
  medium: iconSvg('medium', 26),
  large: iconSvg('large', 26),
  xlarge: iconSvg('xlarge', 26),
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
    if (state.items.length >= 6) bar.classList.remove('d-none');
    else {
      bar.classList.add('d-none');
      if (filter.q || filter.type !== 'all') {
        filter.q = '';
        filter.type = 'all';
        syncFilterUI();
      }
    }
  }
  if (grp) grp.classList.toggle('d-none', !state.items.length);
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
