// @ts-check
/* Keep this module free of imports. Both entry points load it first.
   Why the test has two halves: docs/frontend.md, Layout. */

export const MOBILE_QUERY = '(max-width:768px)';
const PORTRAIT_QUERY = '(orientation:portrait)';
const PHONE_UA = /iPhone|iPod|Android/i;

/** @param {string} query */
function matches(query) {
  try {
    return !!window.matchMedia?.(query).matches;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function isMobileLayout() {
  return matches(MOBILE_QUERY) || (matches(PORTRAIT_QUERY) && PHONE_UA.test(navigator.userAgent || ''));
}

/** Call `onChange` when, and only when, the answer flips.

    `applied` is what the caller has already rendered. Pass it: the window can
    change between this module loading and the page finishing its first build,
    and a baseline read here would treat that change as already handled and
    never report it.

    @param {(mobile: boolean) => void} onChange
    @param {boolean} [applied] the layout the caller currently shows
    @returns {() => void} a function that detaches the listeners */
export function onLayoutChange(onChange, applied) {
  let last = applied === undefined ? isMobileLayout() : applied;
  const check = () => {
    const now = isMobileLayout();
    if (now === last) return;
    last = now;
    onChange(now);
  };
  /* Both queries, so a rotation is noticed as well as a resize. A media query
     fires once when it flips, where a resize handler fires for every pixel and
     for a phone keyboard opening. */
  const lists = [MOBILE_QUERY, PORTRAIT_QUERY]
    .map(q => {
      try {
        return window.matchMedia?.(q) || null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  for (const list of lists) list.addEventListener('change', check);
  /* The window may already have moved past the caller's baseline. */
  check();
  return () => {
    for (const list of lists) list.removeEventListener('change', check);
  };
}
