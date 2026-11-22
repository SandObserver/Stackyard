// @ts-check
/* One element for the whole dashboard. A per-tile popover outlives the tiles
   the grid rebuilds on every resize. */

import { formatList, formatNumber } from '/js/format-number.js?v=263fa390';
import { EASE_IOS, EASE_OUT } from '/js/motion-curve.js?v=7fea8800';

const HOVER_IN_MS = 320;
const COMPAT_CLICK_MS = 500;
/* SC 1.4.13 asks that hover content be hoverable. The pointer has to cross the
   gap between the badge and the popover without it closing underneath. */
const HOVER_OUT_MS = 200;

/** @type {HTMLElement|null} */
let pop = null;
/** @type {HTMLElement|null} */
let openFor = null;
/** @type {HTMLElement|null} */
let shownFrom = null;
let openTimer = 0;
let closeTimer = 0;
let openedAt = 0;
let byFocus = false;
let holdSeq = 0;
let held = false;
/** @type {HTMLElement|null} */
let heldFocus = null;

const ROWS = new WeakMap();
/** @type {WeakMap<HTMLElement, HTMLElement>} */
const DESC = new WeakMap();
let descSeq = 0;

/** @param {{ value: number|string, unit: string }} row */
function valueText(row) {
  const value = typeof row.value === 'number' ? formatNumber(row.value) : row.value;
  return row.unit ? `${value} ${row.unit}` : String(value);
}

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'badge-pop';
  pop.id = 'badge-pop';
  pop.setAttribute('role', 'tooltip');
  /* auto, so the browser gives the top layer, dismissal on a click outside and
     Escape. */
  pop.setAttribute('popover', 'auto');
  /* Interactive now, so a click on it must not reach the tile underneath. */
  pop.addEventListener('pointerenter', cancelClose);
  pop.addEventListener('pointerleave', scheduleClose);
  pop.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(pop);
  return pop;
}

/** The focusable tile a badge belongs to. Never make the badge focusable: a
    control nested in a link is unreachable.
    @param {HTMLElement} badge @returns {HTMLElement|null} */
function tileOf(badge) {
  return /** @type {HTMLElement|null} */ (badge.closest('a, button, [role="button"]'));
}

/** @param {HTMLElement} badge */
function place(badge) {
  const p = ensurePop();
  const r = badge.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  const gap = 8;
  let top = r.top - gap - pr.height;
  if (top < 8) {
    const tile = (tileOf(badge) || badge).getBoundingClientRect();
    top = Math.min(tile.bottom + gap, window.innerHeight - 8 - pr.height);
  }
  /* Aligned with the badge's trailing edge, which is the other side of the
     screen in a right-to-left language. */
  const rtl = (document.documentElement.getAttribute('dir') || 'ltr') === 'rtl';
  let left = rtl ? r.left : r.right - pr.width;
  left = Math.min(Math.max(8, left), window.innerWidth - pr.width - 8);
  p.style.top = Math.round(top) + 'px';
  p.style.left = Math.round(left) + 'px';
}

/** @param {HTMLElement} p @param {HTMLElement} badge @param {boolean} opening
    @returns {Animation|null} */
function grow(p, badge, opening) {
  if (typeof p.animate !== 'function') return null;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const b = badge.getBoundingClientRect();
  const r = p.getBoundingClientRect();
  const x = Math.round(b.left + b.width / 2 - r.left);
  const y = Math.round(b.top + b.height / 2 - r.top);
  p.style.transformOrigin = String(x) + 'px ' + String(y) + 'px';
  const shut = still ? { opacity: 0 } : { opacity: 0, transform: 'scale(.9)' };
  const full = still ? { opacity: 1 } : { opacity: 1, transform: 'none' };
  return p.animate(opening ? [shut, full] : [full, shut], {
    duration: opening ? 200 : 120,
    easing: opening ? EASE_IOS : EASE_OUT,
    fill: opening ? 'none' : 'forwards',
  });
}

/** @param {HTMLElement} badge @param {boolean} [focus] shown at once, with no motion */
function open(badge, focus = false) {
  const rows = ROWS.get(badge);
  if (!rows || !rows.length) return;
  const p = ensurePop();
  p.textContent = '';
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'badge-pop-row';
    const dot = document.createElement('span');
    dot.className = 'badge-pop-dot';
    if (row.color) dot.style.setProperty('background-color', row.color);
    const name = document.createElement('span');
    name.className = 'badge-pop-name';
    /* User text. Assigned, never interpolated. */
    name.textContent = row.name;
    const val = document.createElement('span');
    val.className = 'badge-pop-val';
    val.textContent = valueText(row);
    line.append(dot, name, val);
    p.appendChild(line);
  }
  const was = openFor;
  p.getAnimations?.().forEach(a => a.cancel());
  /* A modal folder makes everything outside it inert, a top-layer popover too. */
  const host = badge.closest('dialog[open]') || document.body;
  const shown = p.matches(':popover-open');
  if (shown && (shownFrom !== badge || p.parentElement !== host)) p.hidePopover();
  if (p.parentElement !== host) host.appendChild(p);
  /* Keep the source. Without it a second tap on the badge closes and reopens the popover. */
  if (!p.matches(':popover-open')) p.showPopover({ source: badge });
  shownFrom = badge;
  openFor = badge;
  openedAt = Date.now();
  byFocus = focus;
  place(badge);
  if (!was && !focus) grow(p, badge, true);
}

export function closeBadgePopover() {
  clearTimeout(openTimer);
  openTimer = 0;
  clearTimeout(closeTimer);
  closeTimer = 0;
  const from = openFor;
  if (pop?.matches(':popover-open')) {
    const p = pop;
    const a = from && !byFocus ? grow(p, from, false) : null;
    if (a)
      a.onfinish = () => {
        if (!openFor && p.matches(':popover-open')) p.hidePopover();
      };
    else p.hidePopover();
  }
  openFor = null;
  byFocus = false;
}

/** @param {HTMLElement} badge */
function schedule(badge, delay) {
  clearTimeout(closeTimer);
  closeTimer = 0;
  clearTimeout(openTimer);
  openTimer = window.setTimeout(() => open(badge), openFor ? 0 : delay);
}

/* Cancelled when the pointer arrives on the popover. */
function scheduleClose() {
  clearTimeout(openTimer);
  openTimer = 0;
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(closeBadgePopover, HOVER_OUT_MS);
}

function cancelClose() {
  clearTimeout(closeTimer);
  closeTimer = 0;
}

/* Escape and a click outside are the browser's now. Scrolling and resizing are
   not: light dismiss does not cover them, and the popover is positioned by hand
   against a badge that has moved. */
let globalsWired = false;
function wireGlobals() {
  if (globalsWired) return;
  globalsWired = true;
  window.addEventListener('scroll', () => closeBadgePopover(), { capture: true, passive: true });
  window.addEventListener('resize', () => closeBadgePopover());
  /* The browser dismisses it without telling this module, which would then
     think it is still open. */
  const p = ensurePop();
  /* Not while it is shown again. The event is queued behind a hide and a show. */
  p.addEventListener('toggle', e => {
    if (/** @type {any} */ (e).newState === 'closed' && openFor && !p.matches(':popover-open')) closeBadgePopover();
  });
  /* A folder removes its dialog when it closes, and the popover with it. */
  document.addEventListener(
    'close',
    e => {
      if (p.parentElement !== e.target) return;
      closeBadgePopover();
      p.getAnimations?.().forEach(a => a.cancel());
      if (p.matches(':popover-open')) p.hidePopover();
      document.body.appendChild(p);
    },
    true,
  );
  /* Resolve the tile at focus time. A badge is wired before it joins its tile. */
  document.addEventListener('focusin', e => {
    const badge = badgeIn(e.target);
    if (badge && /** @type {HTMLElement} */ (e.target).matches(':focus-visible')) {
      if (held) heldFocus = badge;
      else open(badge, true);
    } else if (byFocus && openFor) closeBadgePopover();
  });
  document.addEventListener('focusout', e => {
    if (!badgeIn(e.target)) return;
    if (byFocus && badgeIn(/** @type {FocusEvent} */ (e).relatedTarget)) return;
    closeBadgePopover();
  });
}

/** Keep keyboard focus from opening the popover until the returned function
    runs. A later hold voids an earlier one.
    @returns {() => void} */
export function holdBadgePopover() {
  const seq = ++holdSeq;
  held = true;
  heldFocus = null;
  return () => {
    if (seq !== holdSeq) return;
    held = false;
    const badge = heldFocus;
    heldFocus = null;
    if (badge && tileOf(badge) === document.activeElement && ROWS.get(badge)) open(badge, true);
  };
}

/** The wired badge of a focused tile, or null. @param {EventTarget|null} target */
function badgeIn(target) {
  if (!(target instanceof HTMLElement)) return null;
  for (const badge of target.querySelectorAll('.badge')) {
    if (ROWS.get(/** @type {HTMLElement} */ (badge)) && tileOf(/** @type {HTMLElement} */ (badge)) === target)
      return /** @type {HTMLElement} */ (badge);
  }
  return null;
}

/** Describe a tile by its badge's popover rows. Null rows remove it.
    @param {HTMLElement} tile @param {HTMLElement} badge
    @param {Array<{ name: string, value: number|string, unit: string }>|null} rows */
export function describeBadgeTile(tile, badge, rows) {
  let desc = DESC.get(badge);
  if (!rows || !rows.length) {
    if (desc && tile.getAttribute('aria-describedby') === desc.id) tile.removeAttribute('aria-describedby');
    desc?.remove();
    DESC.delete(badge);
    return;
  }
  if (!desc) {
    desc = document.createElement('span');
    desc.id = `badge-desc-${++descSeq}`;
    desc.hidden = true;
    DESC.set(badge, desc);
  }
  const parent = badge.parentElement;
  if (parent && desc.previousElementSibling !== badge) parent.insertBefore(desc, badge.nextElementSibling);
  /* User text. Assigned, never interpolated. */
  desc.textContent = formatList(
    rows.map(row => (row.value === '' ? row.name : `${row.name}: ${valueText(row)}`)),
    'plain',
  );
  tile.setAttribute('aria-describedby', desc.id);
}

/** Attach or remove the popover on one badge. Null rows remove it.
    @param {HTMLElement} badge
    @param {Array<{ name: string, value: number|string, unit: string, color: string }>|null} rows */
export function wireBadgePopover(badge, rows) {
  if (!rows || !rows.length) {
    ROWS.delete(badge);
    if (openFor === badge) closeBadgePopover();
    return;
  }
  wireGlobals();
  ROWS.set(badge, rows);
  if (openFor === badge) open(badge);
  if (badge.dataset.popWired === '1') return;
  badge.dataset.popWired = '1';

  badge.addEventListener('pointerenter', e => {
    if (/** @type {PointerEvent} */ (e).pointerType === 'touch') return;
    schedule(badge, HOVER_IN_MS);
  });
  badge.addEventListener('pointerleave', e => {
    if (/** @type {PointerEvent} */ (e).pointerType === 'touch') return;
    scheduleClose();
  });

  /* Keep the tap. iOS answers a long press on a link with its own callout and
     cancels the touch, leaving no other way in on Safari. */
  badge.addEventListener('click', e => {
    if (!ROWS.get(badge)) return;
    e.preventDefault();
    e.stopPropagation();
    /* One tap can arrive twice: the touch click, then the compatibility mouse
       click. Toggling on both opens and shuts it again. */
    if (Date.now() - openedAt < COMPAT_CLICK_MS) return;
    if (openFor === badge) closeBadgePopover();
    else open(badge);
  });
}
