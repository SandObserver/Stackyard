// @ts-check
/* Reordering rows in the item list, by pointer and by touch.

   It came out of admin.js because it is self-contained: seven helpers used by
   nothing else, and the handlers only need the row, its item, and where the row
   sits. What it cannot own is saving, so the caller injects that.

   The arrangement itself is admin-drag-logic.js, which is pure and tested
   directly. This module is the DOM half: what the pointer is doing, which edge
   it is near, and which classes say so. */

import { applyDrop, canDropInGroup, canJoinFolder, folderRowZone } from '/js/admin-drag-logic.js?v=1d1d553e';
import { DOCK_MAX } from '/js/limits.js?v=31048a24';
import { state } from '/js/admin-state.js?v=064b9b85';
import { snapshotItems } from '/js/admin-save-logic.js?v=32cb6aeb';
import { qa } from '/js/utils.js?v=705ca896';

/** @type {(before: unknown) => void} */
let _save = () => {};
/** @type {() => void} */
let _dockFull = () => {};

/** The list writes the config and shows notices, not this module. Call once
    at start-up.
    @param {(before: unknown) => void} save @param {() => void} dockFull
    @returns {void} */
export function initDrag(save, dockFull) {
  _save = save;
  _dockFull = dockFull;
  /* Capture runs before the row handlers, which set it again over a refusing
     row. So it describes the element under the pointer now. */
  document.addEventListener('dragover', () => (_refused = false), true);
  document.addEventListener('drop', () => (_dropped = true), true);
}

/* Applies the arrangement and saves it, or leaves the list untouched. */
function commit(opts) {
  const before = snapshotItems(state.items);
  if (applyDrop(state.items, { ...opts, dockMax: DOCK_MAX })) _save(before);
}

/* dataTransfer is not readable during dragover. */
let _dragType = null;
let _dragId = null;
/* The last target under the pointer refused the dragged row. */
let _refused = false;
let _dropped = false;

/** @param {string|null} srcId @param {string|undefined} group @returns {boolean} */
function accepts(srcId, group) {
  const src = state.items.find(i => i.id === srcId);
  return canDropInGroup(state.items, src, group === 'dock' ? 'dock' : 'home', DOCK_MAX);
}

/* Only an app is refused for a full dock. Other types never join it. */
function isApp(srcId) {
  return state.items.find(i => i.id === srcId)?.type === 'app';
}

function clearDragClasses(target) {
  const rows = target ? [target] : qa('.row');
  rows.forEach(r => {
    r.classList.remove('drag-above', 'drag-below', 'drag-into', 'drag-over');
  });
}

/* At most one row shows a drop marker, so moving it is a two-row edit. Sweeping
   every row instead runs a query and four class removals per row on every
   pointer event, which is what made dragging a long list feel heavy. The sweep
   is still used once a drag ends, where its cost does not repeat. */
let _marked = null;

function mark(row, cls) {
  if (_marked && _marked !== row) clearDragClasses(_marked);
  clearDragClasses(row);
  row.classList.add(cls);
  _marked = row;
}

function unmark() {
  if (_marked) clearDragClasses(_marked);
  _marked = null;
}

/* Drag data formats: "top:itemId" or "child:folderId:itemId". */
function parseDragData(raw) {
  if (raw.startsWith('child:')) {
    const [, sfId, sItemId] = raw.split(':');
    return { srcId: sItemId, srcFolderId: sfId };
  }
  if (raw.startsWith('top:')) return { srcId: raw.slice(4), srcFolderId: null };
  return null;
}

function itemType(id) {
  return state.items.find(i => i.id === id)?.type || null;
}

function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}
function scrollByPx(scroller, dy) {
  if (scroller === document.scrollingElement) window.scrollBy(0, dy);
  else scroller.scrollTop += dy;
}

/* Native HTML5 drag does not fire from touch on mobile WebKit. The handle needs
   touch-action:none (see admin.css) or starting on it scrolls the list. */
function wireTouchDrag(row, handle, { indent, folderId }) {
  handle.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (row.draggable === false) return; /* hidden while filtering */
    e.preventDefault();
    const srcId = row.dataset.itemId;
    const startRect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.className = 'row drow drag-ghost';
    ghost.style.width = startRect.width + 'px';
    ghost.style.left = startRect.left + 'px';
    ghost.style.top = startRect.top + 'px';
    document.body.appendChild(ghost);
    row.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    const offY = e.clientY - startRect.top;
    let hovered = null,
      dropAbove = false,
      dropInto = false,
      scrollTimer = null;
    const scroller = scrollParent(row);

    const place = (x, y) => {
      ghost.style.top = y - offY + 'px';
      const under = /** @type {HTMLElement} */ (document.elementFromPoint(x, y));
      const tr = /** @type {HTMLElement} */ (under && under.closest('.drow, .al-dock-empty'));
      if (!tr || tr === row || tr === ghost) {
        unmark();
        hovered = null;
        _refused = false;
        return;
      }
      if (!accepts(srcId, tr.dataset.group)) {
        unmark();
        hovered = null;
        _refused = isApp(srcId);
        return;
      }
      _refused = false;
      hovered = tr;
      if (tr.classList.contains('al-dock-empty')) {
        mark(tr, 'drag-into');
        return;
      }
      const r = tr.getBoundingClientRect();
      if (tr.dataset.isFolder && canJoinFolder(itemType(srcId))) {
        const zone = folderRowZone(y, r);
        dropInto = zone === 'into';
        dropAbove = zone === 'above';
        mark(tr, dropInto ? 'drag-into' : dropAbove ? 'drag-above' : 'drag-below');
      } else {
        dropInto = false;
        dropAbove = y < r.top + r.height / 2;
        mark(tr, dropAbove ? 'drag-above' : 'drag-below');
      }
    };
    /* Scaled by elapsed time, not by frame. A frame is 16ms at 60Hz and 8ms at
       120Hz, so a fixed step per frame scrolls twice as fast on the faster
       display. */
    const SCROLL_PX_PER_MS = 12 / 16;
    const autoscroll = y => {
      if (scrollTimer) {
        cancelAnimationFrame(scrollTimer);
        scrollTimer = null;
      }
      const rect =
        scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : scroller.getBoundingClientRect();
      const M = 52;
      const up = y < rect.top + M,
        dn = y > rect.bottom - M;
      if (!up && !dn) return;
      let last = performance.now();
      const step = now => {
        scrollByPx(scroller, (up ? -1 : 1) * (now - last) * SCROLL_PX_PER_MS);
        last = now;
        scrollTimer = requestAnimationFrame(step);
      };
      scrollTimer = requestAnimationFrame(step);
    };
    const move = ev => {
      place(ev.clientX, ev.clientY);
      autoscroll(ev.clientY);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      if (scrollTimer) cancelAnimationFrame(scrollTimer);
      ghost.remove();
      row.classList.remove('dragging');
      _refused = false;
      _marked = null;
      clearDragClasses();
    };
    const up = () => {
      const tr = hovered;
      const refused = _refused;
      end();
      if (!tr) {
        if (refused) _dockFull();
        return;
      }
      if (tr.classList.contains('al-dock-empty')) {
        commit({ srcId, srcFolderId: indent ? folderId : null, targetId: null, targetGroup: 'dock' });
        return;
      }
      const into = !!tr.dataset.isFolder && canJoinFolder(itemType(srcId)) && dropInto;
      commit({
        srcId,
        srcFolderId: indent ? folderId : null,
        targetId: tr.dataset.itemId,
        targetFolderId: tr.dataset.folderId || null,
        targetIsFolder: into,
        indent: !!tr.dataset.indent,
        childIdx: tr.dataset.childIdx != null ? Number(tr.dataset.childIdx) : null,
        dropAbove: into ? false : dropAbove,
        targetGroup: tr.dataset.group,
      });
    };
    const cancel = () => end();
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
  });
}

/** Every drag affordance for one row: the pointer handlers and the touch
    fallback.

    @param {HTMLElement} row @param {HTMLElement} handle
    @param {{ item: any, indent: boolean, folderId: string|null, childIdx: number|null }} at
    @returns {void} */
export function wireRowDrag(row, handle, { item, indent, folderId, childIdx }) {
  const dragData = indent ? 'child:' + folderId + ':' + item.id : 'top:' + item.id;

  let frame = 0;
  row.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragData);
    _dragType = item.type;
    _dragId = item.id;
    _refused = false;
    _dropped = false;
    frame = requestAnimationFrame(() => row.classList.add('dragging'));
  });
  row.addEventListener('dragend', () => {
    cancelAnimationFrame(frame);
    row.classList.remove('dragging');
    if (_refused && !_dropped) _dockFull();
    _refused = false;
    _dragId = null;
    _dragType = null;
    _marked = null;
    clearDragClasses();
  });
  row.addEventListener('dragover', e => {
    if (!accepts(_dragId, row.dataset.group)) {
      _refused = isApp(_dragId);
      unmark();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    if (row.dataset.isFolder && canJoinFolder(_dragType)) {
      const zone = folderRowZone(e.clientY, rect);
      mark(row, zone === 'into' ? 'drag-into' : zone === 'above' ? 'drag-above' : 'drag-below');
    } else {
      mark(row, e.clientY < rect.top + rect.height / 2 ? 'drag-above' : 'drag-below');
    }
  });
  row.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !row.contains(/** @type {Node} */ (e.relatedTarget))) clearDragClasses(row);
  });

  row.addEventListener('drop', e => {
    e.preventDefault();
    const dropAbove = row.classList.contains('drag-above');
    const dropInto = row.classList.contains('drag-into');
    clearDragClasses();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    const drop = parseDragData(raw);
    if (!drop) return;
    commit({
      ...drop,
      targetId: item.id,
      targetFolderId: folderId,
      targetIsFolder: item.type === 'folder' && dropInto,
      indent,
      childIdx,
      dropAbove,
      targetGroup: row.dataset.group,
    });
  });

  wireTouchDrag(row, handle, { indent, folderId });
}

/** The drop target shown in place of rows while the dock is empty.
    @param {HTMLElement} zone @returns {void} */
export function wireDockZone(zone) {
  zone.dataset.group = 'dock';
  zone.addEventListener('dragover', e => {
    if (!accepts(_dragId, 'dock')) {
      _refused = isApp(_dragId);
      unmark();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    mark(zone, 'drag-into');
  });
  zone.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !zone.contains(/** @type {Node} */ (e.relatedTarget))) clearDragClasses(zone);
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    clearDragClasses();
    const drop = parseDragData(e.dataTransfer.getData('text/plain') || '');
    if (drop) commit({ ...drop, targetId: null, targetGroup: 'dock' });
  });
}
