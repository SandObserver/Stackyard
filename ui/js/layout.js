// @ts-check
/* Whether to show the mobile layout, as one rule for the dashboard and Admin.

   The width test is a media query, not a stored innerWidth, so it answers the
   same question the stylesheets ask. The user-agent test covers phones that
   report a wider CSS viewport than 768px, where a width query alone leaves a
   phone on the desktop layout; it is qualified by portrait so a phone held
   sideways gets the wider layout it has room for.

   Keep this module free of imports: both entry points load it before anything
   else has run. */

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

/** Call `onChange` when, and only when, the answer flips. Returns a function
    that detaches the listeners.

    @param {(mobile: boolean) => void} onChange @returns {() => void} */
export function onLayoutChange(onChange) {
  let last = isMobileLayout();
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
  return () => {
    for (const list of lists) list.removeEventListener('change', check);
  };
}
