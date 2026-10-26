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

import { collapsedFolders, filter, state } from '/js/admin-state.js?v=064b9b85';
import { snapshotItems } from '/js/admin-save-logic.js?v=b83791fb';
import { isShownChild, reorderItems, shownChildren, topLevelRows } from '/js/admin-logic.js?v=28471483';
import { listGroup } from '/js/admin-drag-logic.js?v=4aae5094';
import { initDrag, redrawHeld, wireDockZone, wireRowDrag } from '/js/admin-drag.js?v=1c4004a0';
import { DOCK_MAX } from '/js/limits.js?v=ea61a441';
import { formatNumber } from '/js/format-number.js?v=abcd4ae4';
import { paintIcon, toast } from '/js/admin-shared.js?v=f4752f33';
import { clr, el, focusFirst, initial, qa, setUserText } from '/js/utils.js?v=ab3cac1d';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { t } from '/js/i18n.js?v=ed7c5565';
import { sizeLabel } from '/js/admin-widget-form.js?v=a5539971';
import { widgetGlyph } from '/js/widget-glyphs.js?v=479a53ee';
import { iconSvg } from '/js/icon-set.js?v=26655aca';

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
  initDrag(page.save, () => toast(t('app.dockFull', { max: formatNumber(DOCK_MAX) })), render);
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
  const tpl = document.createElement('template');
  setHtml(tpl, raw(markup));
  return tpl.content.firstElementChild;
}

function moveRow(item, dir, opts = {}) {
  const before = snapshotItems(state.items);
  if (reorderItems(state.items, item, dir, opts)) _page.save(before);
}

/** @param {HTMLElement|null} chevron @param {string} from */
function turnFrom(chevron, from) {
  if (!chevron) return;
  const to = chevron.style.transform;
  chevron.style.transform = from;
  void chevron.offsetWidth;
  chevron.style.transform = to;
}

export function mkRow(item, idx, { indent = false, childIdx = null, folderId = null } = {}) {
  const row = document.createElement('div');
  row.className = 'row drow';
  const _filtering = !!(filter.q || filter.type !== 'all');
  row.draggable = !_filtering;
  row.dataset.itemId = item.id;
  row.dataset.group = indent ? 'home' : listGroup(item);
  if (item.type === 'folder') row.dataset.isFolder = '1';
  if (indent) {
    row.dataset.indent = '1';
    row.dataset.folderId = folderId;
    row.dataset.childIdx = String(childIdx);
  }
  let canUp = false,
    canDown = false;
  if (folderId != null) {
    const shown = shownChildren(
      state.items,
      state.items.find(i => i.id === folderId),
    );
    const p = shown.indexOf(item);
    canUp = p > 0;
    canDown = p < shown.length - 1;
  } else {
    const top = topLevelRows(state.items, listGroup(item) === 'dock');
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
  ico.style.background = clr(item.color);
  if (item.type === 'folder') {
    ico.appendChild(svgNode(FOLDER_ICON));
  } else if (item.type === 'widget') {
    /* The type when the widget declares one, the size otherwise. */
    const glyph = widgetGlyph(state._widgetReg?.[item.widgetType]?.glyph);
    ico.appendChild(svgNode(glyph || SIZE_ICONS[item.widgetSize] || SIZE_ICONS.medium));
  } else if (item.iconUrl) {
    paintIcon(ico, item.iconUrl, initial(item.label), 'width:28px;height:28px;object-fit:contain;');
  } else ico.textContent = initial(item.label || item.id);
  const inf = document.createElement('div');
  inf.className = 'rinf';
  const isFolderRow = item.type === 'folder';
  const nm = document.createElement(isFolderRow ? 'button' : 'div');
  nm.className = 'rnm';
  if (isFolderRow) {
    const collapsed = collapsedFolders.has(item.id);
    nm.setAttribute('type', 'button');
    nm.dataset.act = 'toggle';
    nm.style.cssText = 'display:flex;align-items:center;gap:6px;';
    nm.setAttribute('aria-expanded', String(!collapsed));
    nm.setAttribute('aria-label', t(collapsed ? 'folder.expandAria' : 'folder.collapseAria', { name: item.label }));
    const chevron = document.createElement('span');
    chevron.style.cssText = 'font-size:10px;color:var(--dm);transition:transform .15s;flex-shrink:0;';
    chevron.textContent = '▼';
    chevron.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    chevron.id = 'chev-' + item.id;
    nm.append(chevron, setUserText(document.createElement('span'), item.label));
    nm.onclick = e => {
      e.stopPropagation();
      if (collapsedFolders.has(item.id)) {
        collapsedFolders.delete(item.id);
      } else {
        collapsedFolders.add(item.id);
      }
      render();
      turnFrom(document.getElementById('chev-' + item.id), chevron.style.transform);
    };
  } else {
    setUserText(nm, item.label || item.id);
  }
  const mt = document.createElement('div');
  mt.className = 'rmt';
  if (item.type === 'widget') {
    const wt = item.widgetType || 'custom';
    const wtLabel = state._widgetReg?.[wt]?.label || t('widgetCfg.typeCustom');
    mt.textContent = t('widgetCfg.meta', { type: wtLabel, size: sizeLabel(item.widgetSize || 'medium') });
  } else if (item.type === 'folder')
    mt.textContent = t('folder.appsCount', { count: shownChildren(state.items, item).length });
  else if (item.system === 'settings') mt.textContent = t('home.opensSettings');
  else if (item.href) {
    mt.textContent = item.href;
    mt.classList.add('rmt-url');
  }
  inf.append(nm, mt);
  const pb = document.createElement('div');
  pb.className = 'rpills';
  const pills = [];
  if (item.dock && _filtering) pills.push(html`<span class="pill p-dk">${t('app.dockPill')}</span>`);
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
    b.dataset.act = dir < 0 ? 'up' : 'down';
    b.disabled = !can;
    b.onclick = () => moveRow(item, dir, { folderId, childIdx });
    return b;
  };
  if (!_filtering) ac.append(mkMove(-1, canUp), mkMove(1, canDown));
  const ed = document.createElement('button');
  ed.className = 'btn bg sm';
  ed.textContent = t('common.edit');
  ed.dataset.act = 'edit';
  ed.onclick = () => _page.openModal(idx);
  ac.append(ed);
  row.append(handle, ico, inf, pb, ac);
  wireRowDrag(row, handle, { item, indent, folderId, childIdx });
  return row;
}

const FALLBACK = { up: ['up', 'down'], down: ['down', 'up'] };

/** @param {string|null|undefined} itemId @param {string} [act] @returns {boolean} */
export function focusRow(itemId, act = 'edit') {
  const row = qa('.drow', el('al')).find(r => r.dataset.itemId === itemId);
  if (!row) return false;
  const order = [...(FALLBACK[act] || [act]), 'edit', 'toggle'];
  return focusFirst(...order.map(a => row.querySelector(`[data-act="${a}"]`)));
}

export function render() {
  if (redrawHeld()) return;
  const l = el('al');
  const was = /** @type {HTMLElement|null} */ (document.activeElement);
  const inList = !!was && !!l?.contains(was);
  const row = /** @type {HTMLElement|null} */ (inList ? was.closest('.drow') : null);
  const act = inList ? was.dataset.act : undefined;
  const id = row ? row.dataset.itemId : was?.dataset.folderId;
  draw(l);
  if (act === 'add-to') focusFirst(qa('.fp-add', l).find(b => b.dataset.folderId === id));
  else if (act) focusRow(id, act);
}

/** A heading and an empty group under it, added to the list.
    @param {HTMLElement} l @param {'dock'|'home'} group @param {string} title @param {string} [count]
    @returns {HTMLElement} the group */
function listSection(l, group, title, count) {
  const hdr = document.createElement('div');
  hdr.className = 'grp-hdr-row al-hdr';
  const h = document.createElement('p');
  h.className = 'grp-hdr';
  h.id = 'al-h-' + group;
  h.setAttribute('role', 'heading');
  h.setAttribute('aria-level', '2');
  h.textContent = title;
  hdr.appendChild(h);
  if (count) {
    const c = document.createElement('span');
    c.className = 'al-count';
    c.textContent = count;
    hdr.appendChild(c);
  }
  const g = document.createElement('div');
  g.className = 'grp';
  g.dataset.group = group;
  g.setAttribute('role', 'group');
  g.setAttribute('aria-labelledby', h.id);
  l.append(hdr, g);
  return g;
}

function draw(l) {
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
    const g = document.createElement('div');
    g.className = 'grp';
    matches.forEach(item => g.appendChild(mkRow(item, state.items.indexOf(item))));
    l.appendChild(g);
    return;
  }
  const docked = topLevelRows(state.items, true);
  const dockGrp = listSection(l, 'dock', t('home.dock'), `${formatNumber(docked.length)}/${formatNumber(DOCK_MAX)}`);
  docked.forEach(item => dockGrp.appendChild(mkRow(item, state.items.indexOf(item))));
  if (!docked.length) {
    const zone = document.createElement('div');
    zone.className = 'row al-dock-empty';
    zone.textContent = t('list.dockEmpty');
    dockGrp.appendChild(zone);
    wireDockZone(zone);
  }
  const tip = document.createElement('p');
  tip.className = 'grp-tip';
  tip.textContent = t('list.dockTip');
  l.appendChild(tip);
  const homeGrp = listSection(l, 'home', t('home.homeScreen'));
  topLevelRows(state.items, false).forEach(item => {
    homeGrp.appendChild(mkRow(item, state.items.indexOf(item)));
    if (item.type === 'folder' && !collapsedFolders.has(item.id)) {
      (item.children || []).forEach((childId, ci) => {
        if (!isShownChild(state.items, childId)) return;
        const childItem = state.items.find(i => i.id === childId);
        homeGrp.appendChild(
          mkRow(childItem, state.items.indexOf(childItem), { indent: true, childIdx: ci, folderId: item.id }),
        );
      });
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'fp-add';
      addRow.dataset.act = 'add-to';
      addRow.dataset.folderId = item.id;
      setHtml(addRow, html`<span>+</span> ${t('folder.addAppToFolder')}`);
      addRow.onclick = () => _page.openFolderPicker(null, item.id);
      homeGrp.appendChild(addRow);
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
