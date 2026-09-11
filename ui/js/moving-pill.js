/* One element moved between the rows of a list, instead of a fill redrawn on
   each row. Shared by the hover highlight and the navigation selection.

   The pill is prepended, so it paints before its siblings and they cover it.
   Give it no z-index: one on a row makes that row a stacking context, and an
   overlay inside the row is then trapped behind every row that follows. */

/** @param {Element} container @returns {HTMLElement|null} */
export function pillOf(container) {
  const first = container.firstElementChild;
  return first && first.classList.contains('mp') ? /** @type {HTMLElement} */ (first) : null;
}

/* Created on demand, never restored after a re-render: a child that is always
   there makes `:empty` false, which keeps an empty list on screen. */
export function ensurePill(container, variant) {
  let p = pillOf(container);
  if (!p) {
    p = document.createElement('div');
    p.classList.add('mp', variant);
    p.setAttribute('aria-hidden', 'true');
    container.prepend(p);
  }
  return p;
}

/** Measurable means laid out: a nav hidden for the other layout reports zeroes,
    and placing against those puts the pill in the corner.
    @param {Element} el */
export function measurable(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** @param {Element} container @param {HTMLElement} pill @param {Element} item */
export function placePill(container, pill, item) {
  if (!measurable(container) || !measurable(item)) return false;
  const cr = container.getBoundingClientRect();
  const ir = item.getBoundingClientRect();
  const cs = getComputedStyle(item);
  pill.style.borderRadius = [
    cs.borderTopLeftRadius,
    cs.borderTopRightRadius,
    cs.borderBottomRightRadius,
    cs.borderBottomLeftRadius,
  ].join(' ');
  pill.style.width = ir.width + 'px';
  pill.style.height = ir.height + 'px';
  /* The pill is anchored at the inline start, so right-to-left measures from
     the right edge and travels the other way. None of these lists scroll
     sideways, so the rect difference is the whole inline offset. */
  const rtl = cs.direction === 'rtl';
  const inline = (rtl ? cr.right - ir.right : ir.left - cr.left) - container.clientLeft;
  const block = ir.top - cr.top - container.clientTop + container.scrollTop;
  pill.style.transform = 'translate3d(' + (rtl ? -inline : inline) + 'px,' + block + 'px,0)';
  if (!pill.classList.contains('on')) {
    /* `.on` carries the transform transition, so it has to land in a later
       style pass or the pill slides in from the corner. */
    pill.getBoundingClientRect();
    pill.classList.add('on');
  }
  return true;
}

/** @param {HTMLElement|null} pill */
export function restPill(pill) {
  if (pill) pill.classList.remove('on');
}
