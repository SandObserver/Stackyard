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

import { initDrag, redrawHeld, wireDockZone, wireRowDrag } from '/js/admin-drag.js?v=690d7425';
import { listGroup } from '/js/admin-drag-logic.js?v=127f18c9';
import {
  filterActive,
  folderChildren,
  isShownChild,
  itemMatchesFilter,
  reorderItems,
  shownChildren,
  topLevelRows,
} from '/js/admin-logic.js?v=c1ed16c7';
import { snapshotItems } from '/js/admin-save-logic.js?v=81636161';
import { announce, paintIcon, toast } from '/js/admin-shared.js?v=bb375b32';
import { collapsedFolders, filter, state } from '/js/admin-state.js?v=064b9b85';
import { sizeLabel } from '/js/admin-widget-form.js?v=b6f96409';
import { formatNumber } from '/js/format-number.js?v=9dcba1ce';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { t } from '/js/i18n.js?v=ec60b9bd';
import { iconSvg } from '/js/icon-set.js?v=b7e5d7d1';
import { DOCK_MAX } from '/js/limits.js?v=4b70a7dd';
import { EASE_IOS } from '/js/motion-curve.js?v=43439f5c';
import { pageTheme } from '/js/palette.js?v=3fb8ae43';
import { SETTINGS_ICON, SETTINGS_ICON_LIGHT } from '/js/settings-icon.js?v=4079b66a';
import { clr, el, focusFirst, initial, isolate, qa, setUserText } from '/js/utils.js?v=ff7e1e5f';
import { widgetGlyph } from '/js/widget-glyphs.js?v=ffd906d5';

/** @type {{ openModal: (idx: number|null) => void,
             openFolderPicker: (folderId: string) => void,
             save: (before: unknown, done?: string|false) => Promise<boolean>|boolean }} */
let _page = {
  openModal: () => {},
  openFolderPicker: () => {},
  save: () => false,
};

/** What the page owns and the list only triggers. Call once at start-up.
    @param {typeof _page} page @returns {void} */
export function initList(page) {
  _page = page;
  initDrag(
    page.save,
    () => toast(t('app.dockFull', { max: formatNumber(DOCK_MAX) })),
    render,
    id => {
      _slideNext = true;
      _slideSkip = id;
    },
  );
}

/* Constant markup only. No user data reaches these. */
const FOLDER_ICON = iconSvg('folder', 26);
const CHEVRON =
  '<svg class="ract-chev" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true" focusable="false"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_UP =
  '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="M7 12V2M2.5 6.5 7 2l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_DOWN =
  '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="M7 2v10M2.5 7.5 7 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  if (!reorderItems(state.items, item, dir, opts)) return;
  _slideNext = true;
  _slideSkip = null;
  render();
  announceSpot(item, opts.folderId);
  _page.save(before, false);
}

/** @param {any} item @param {string|null|undefined} folderId */
function announceSpot(item, folderId) {
  const peers =
    folderId != null
      ? shownChildren(
          state.items,
          state.items.find(i => i.id === folderId),
        )
      : topLevelRows(state.items, listGroup(item) === 'dock');
  announce(
    t('list.movedTo', {
      name: isolate(item.label || item.id),
      pos: formatNumber(peers.indexOf(item) + 1),
      total: formatNumber(peers.length),
    }),
  );
}

let _slideNext = false;
let _fadeNewRows = false;
/** @type {string|null} */
let _slideSkip = null;
let _reordering = false;

/** @returns {boolean} */
export function isReordering() {
  return _reordering;
}

/** @param {boolean} on @returns {void} */
export function setReordering(on) {
  if (_reordering === on) return;
  _reordering = on;
  if (on && (filter.q || filter.type !== 'all')) {
    filter.q = '';
    filter.type = 'all';
    syncFilterUI();
    render();
  }
  el('btn-reorder')?.classList.toggle('on', on);
  el('al')?.classList.toggle('reordering', on);
  el('al-filter')?.classList.toggle('is-disabled', on);
  for (const c of [el('al-search'), ...qa('#al-filter .chip'), el('btn-add')])
    if (c) /** @type {HTMLButtonElement} */ (c).disabled = on;
}

/** @param {HTMLElement} l @returns {Map<string, number>} */
function rowTops(l) {
  const tops = new Map();
  for (const r of qa('.drow', l)) tops.set(r.dataset.itemId, r.getBoundingClientRect().top);
  return tops;
}

/** @param {HTMLElement} l @param {Map<string, number>} tops @param {string|null} skip */
function slideRows(l, tops, skip) {
  for (const r of qa('.drow', l)) {
    if (r.dataset.itemId === skip) continue;
    const was = tops.get(r.dataset.itemId);
    if (was == null && _fadeNewRows) fadeNewRow(r);
    if (was == null) continue;
    const dy = was - r.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
      duration: 200,
      easing: EASE_IOS,
    });
  }
}

/** @param {Element|undefined} node */
function fadeNewRow(node) {
  node?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
}

/** @param {HTMLElement|null} chevron @param {string} from */
function turnFrom(chevron, from) {
  if (!chevron) return;
  const to = chevron.style.transform;
  chevron.style.transform = from;
  void chevron.offsetWidth;
  chevron.style.transform = to;
}

export function mkRow(
  item,
  idx,
  { indent = false, childIdx = null, folderId = null, top = { dock: [], home: [] } } = {},
) {
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
    const peers = top[listGroup(item) === 'dock' ? 'dock' : 'home'];
    const p = peers.indexOf(item);
    canUp = p > 0;
    canDown = p < peers.length - 1;
  }
  const name = item.label || item.id || t('type.app');
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'rord';
  handle.dataset.act = 'move';
  handle.textContent = '⠿';
  handle.setAttribute('aria-label', t('list.moveNamed', { name }));
  handle.setAttribute('aria-describedby', 'al-move-hint');
  if (_filtering) handle.style.visibility = 'hidden';
  handle.addEventListener('keydown', e => {
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (dir < 0 ? canUp : canDown) moveRow(item, dir, { folderId, childIdx });
  });
  const ico = document.createElement('div');
  ico.className = 'rico';
  ico.style.background = clr(item.color);
  if (item.type === 'folder') {
    ico.appendChild(svgNode(FOLDER_ICON));
  } else if (item.type === 'widget') {
    /* The type when the widget declares one, the size otherwise. */
    const glyph = widgetGlyph(state._widgetReg?.[item.widgetType]?.glyph);
    ico.appendChild(svgNode(glyph || SIZE_ICONS[item.widgetSize] || SIZE_ICONS.medium));
  } else if (item.system === 'settings') {
    ico.style.background = clr('auto');
    const img = document.createElement('img');
    img.src = pageTheme() === 'light' ? SETTINGS_ICON_LIGHT : SETTINGS_ICON;
    img.alt = '';
    img.className = 'rico-settings';
    ico.appendChild(img);
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
    chevron.style.transform = collapsed
      ? document.dir === 'rtl'
        ? 'rotate(90deg)'
        : 'rotate(-90deg)'
      : 'rotate(0deg)';
    chevron.id = 'chev-' + item.id;
    nm.append(chevron, setUserText(document.createElement('span'), item.label));
    nm.onclick = e => {
      e.stopPropagation();
      if (collapsedFolders.has(item.id)) {
        collapsedFolders.delete(item.id);
      } else {
        collapsedFolders.add(item.id);
      }
      const animate = e.detail !== 0;
      _slideNext = animate;
      _fadeNewRows = animate;
      render();
      _fadeNewRows = false;
      if (animate && !collapsedFolders.has(item.id) && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        fadeNewRow(qa('.fp-add', el('al')).find(b => b.dataset.folderId === item.id));
      if (animate) turnFrom(document.getElementById('chev-' + item.id), chevron.style.transform);
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
  if (item.type === 'widget') pills.push(html`<span class="pill p-wg p-type">${t('type.widget')}</span>`);
  if (item.type === 'folder') pills.push(html`<span class="pill p-fl p-type">${t('type.folder')}</span>`);
  if (item.monitoring?.healthcheck?.enabled || item.container)
    pills.push(html`<span class="pill p-hl">${t('app.healthPill')}</span>`);
  if (item.monitoring?.activity?.enabled || item.badge?.enabled)
    pills.push(html`<span class="pill p-bg">${t('app.badgePill')}</span>`);
  if (item.system === 'settings') pills.push(html`<span class="pill p-sy">${t('pill.system')}</span>`);
  if (item.hidden) pills.push(html`<span class="pill p-hd">${t('pill.hidden')}</span>`);
  setHtml(pb, html`${pills}`);
  const ac = document.createElement('div');
  ac.className = 'ract';
  const ed = document.createElement('button');
  ed.type = 'button';
  ed.className = 'ract-edit';
  ed.dataset.act = 'edit';
  ed.setAttribute('aria-label', t('common.editNamed', { name }));
  setHtml(ed, raw(CHEVRON));
  ed.onclick = () => _page.openModal(idx);
  if (!_filtering) {
    const mv = document.createElement('span');
    mv.className = 'rmove';
    const mkMove = (dir, can) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rmove-btn';
      b.dataset.act = dir < 0 ? 'up' : 'down';
      b.setAttribute('aria-label', t(dir < 0 ? 'list.moveUpNamed' : 'list.moveDownNamed', { name: isolate(name) }));
      setHtml(b, raw(dir < 0 ? ARROW_UP : ARROW_DOWN));
      b.disabled = !can;
      b.onclick = () => moveRow(item, dir, { folderId, childIdx });
      return b;
    };
    mv.append(mkMove(-1, canUp), mkMove(1, canDown));
    ac.append(mv);
  }
  ac.append(ed);
  row.addEventListener('click', e => {
    if (_reordering) return;
    if (/** @type {HTMLElement} */ (e.target).closest('button, a, input')) return;
    _page.openModal(idx);
  });
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
  const slide = _slideNext && !!l && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  _slideNext = false;
  const skip = _slideSkip;
  _slideSkip = null;
  const tops = slide ? rowTops(l) : null;
  const was = /** @type {HTMLElement|null} */ (document.activeElement);
  const inList = !!was && !!l?.contains(was);
  const row = /** @type {HTMLElement|null} */ (inList ? was.closest('.drow') : null);
  const act = inList ? was.dataset.act : undefined;
  const id = row ? row.dataset.itemId : was?.dataset.folderId;
  const icons = tops ? new Map(qa('.drow', l).map(r => [r.dataset.itemId, r.querySelector('.rico')])) : null;
  draw(l);
  if (icons)
    for (const r of qa('.drow', l)) {
      const old = icons.get(r.dataset.itemId);
      if (old) r.querySelector('.rico')?.replaceWith(old);
    }
  if (tops) slideRows(l, tops, skip);
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
  const top = { dock: topLevelRows(state.items, true), home: topLevelRows(state.items, false) };
  if (filterActive(filter)) {
    drawFiltered(l, top);
    return;
  }
  const docked = top.dock;
  const dockGrp = listSection(l, 'dock', t('home.dock'), `${formatNumber(docked.length)}/${formatNumber(DOCK_MAX)}`);
  docked.forEach(item => dockGrp.appendChild(mkRow(item, state.items.indexOf(item), { top })));
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
  top.home.forEach(item => {
    homeGrp.appendChild(mkRow(item, state.items.indexOf(item), { top }));
    if (item.type === 'folder' && !collapsedFolders.has(item.id)) {
      folderChildren(item).forEach((childId, ci) => {
        if (!isShownChild(state.items, childId)) return;
        const childItem = state.items.find(i => i.id === childId);
        homeGrp.appendChild(
          mkRow(childItem, state.items.indexOf(childItem), { indent: true, childIdx: ci, folderId: item.id, top }),
        );
      });
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'fp-add';
      addRow.dataset.act = 'add-to';
      addRow.dataset.folderId = item.id;
      setHtml(addRow, html`<span>+</span> ${t('folder.addAppToFolder')}`);
      addRow.onclick = () => _page.openFolderPicker(item.id);
      homeGrp.appendChild(addRow);
    }
  });
}

/** @param {HTMLElement} g @param {HTMLElement} empty */
function showMatches(g, empty) {
  const byId = new Map(state.items.map(i => [i.id, i]));
  let shown = 0;
  for (const r of /** @type {any} */ (g.children)) {
    const it = byId.get(r.dataset.itemId);
    const on = !!it && itemMatchesFilter(it, filter);
    r.classList.toggle('d-none', !on);
    if (on) shown++;
  }
  g.classList.toggle('d-none', !shown);
  empty.classList.toggle('d-none', !!shown);
}

/** @param {HTMLElement} l @param {{ dock: any[], home: any[] }} top */
function drawFiltered(l, top) {
  const g = document.createElement('div');
  g.className = 'grp';
  g.dataset.flat = '1';
  state.items.forEach((item, i) => g.appendChild(mkRow(item, i, { top })));
  const empty = document.createElement('div');
  empty.className = 'empty d-none';
  empty.dataset.flat = '1';
  const p = document.createElement('p');
  p.className = 'empty-msg';
  p.textContent = t('list.noMatches');
  empty.appendChild(p);
  l.append(g, empty);
  showMatches(g, empty);
}

/** Shows the rows that match the filter. Rows already drawn are only hidden or shown.
    @returns {void} */
export function applyFilter() {
  const l = el('al');
  const g = /** @type {HTMLElement|null} */ (l?.querySelector(':scope > .grp[data-flat]') ?? null);
  const empty = /** @type {HTMLElement|null} */ (l?.querySelector(':scope > .empty[data-flat]') ?? null);
  if (!filterActive(filter) || !g || !empty) {
    render();
    return;
  }
  showMatches(g, empty);
}

/** @returns {number} */
export function filterMatchCount() {
  return state.items.filter(it => itemMatchesFilter(it, filter)).length;
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
