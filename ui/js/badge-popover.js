// @ts-check
/* One element for the whole dashboard. A per-tile popover outlives the tiles
   the grid rebuilds on every resize. */

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
let describedEl = null;
let openTimer = 0;
let closeTimer = 0;
let openedAt = 0;

const ROWS = new WeakMap();

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'badge-pop';
  pop.id = 'badge-pop';
  pop.setAttribute('role', 'tooltip');
  /* auto, so the browser gives the top layer, dismissal on a click outside and
     Escape. It cannot position it: anchor positioning is Safari 26, well above
     the support floor, so place() stays. */
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
  let top = r.bottom + gap;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - gap - pr.height);
  /* Aligned with the badge's trailing edge, which is the other side of the
     screen in a right-to-left language. */
  const rtl = (document.documentElement.getAttribute('dir') || 'ltr') === 'rtl';
  let left = rtl ? r.left : r.right - pr.width;
  left = Math.min(Math.max(8, left), window.innerWidth - pr.width - 8);
  p.style.top = Math.round(top) + 'px';
  p.style.left = Math.round(left) + 'px';
}

/** @param {HTMLElement} badge */
function open(badge) {
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
    val.textContent = row.unit ? `${row.value} ${row.unit}` : String(row.value);
    line.append(dot, name, val);
    p.appendChild(line);
  }
  p.showPopover();
  openFor = badge;
  openedAt = Date.now();
  place(badge);
  const tile = tileOf(badge);
  if (tile) {
    tile.setAttribute('aria-describedby', 'badge-pop');
    describedEl = tile;
  }
}

export function closeBadgePopover() {
  clearTimeout(openTimer);
  openTimer = 0;
  clearTimeout(closeTimer);
  closeTimer = 0;
  if (pop?.matches(':popover-open')) pop.hidePopover();
  openFor = null;
  if (describedEl) {
    describedEl.removeAttribute('aria-describedby');
    describedEl = null;
  }
}

/** @param {HTMLElement} badge */
function schedule(badge, delay) {
  clearTimeout(closeTimer);
  closeTimer = 0;
  clearTimeout(openTimer);
  openTimer = window.setTimeout(() => open(badge), delay);
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
  ensurePop().addEventListener('toggle', e => {
    if (/** @type {any} */ (e).newState === 'closed' && openFor) closeBadgePopover();
  });
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

  const tile = tileOf(badge);
  if (tile) {
    tile.addEventListener('focus', () => open(badge));
    tile.addEventListener('blur', () => closeBadgePopover());
  }
}
