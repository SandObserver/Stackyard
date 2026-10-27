// @ts-check

/** The narrowest bottom slot that still fits a short name. */
const MIN_SLOT = 120;

/** Where the desktop credit goes: beside the Dock while it fits, else the top
    corner. Keep the credit off the Dock. It is fixed at the same bottom edge.

    @param {number} vw the viewport width
    @param {{left:number, right:number}|null} dock the Dock's box, or null with no Dock
    @param {boolean} rtl
    @param {number} edge the gap kept from the screen edge and from the Dock
    @returns {{ place: 'bottom'|'top', maxWidth: number }} */
export function creditPlacement(vw, dock, rtl, edge) {
  const room = dock ? (rtl ? vw - dock.right : dock.left) - 2 * edge : vw / 2 - edge;
  return room >= MIN_SLOT
    ? { place: 'bottom', maxWidth: Math.floor(room) }
    : { place: 'top', maxWidth: Math.floor(vw / 2 - edge) };
}

/** @param {string} text @param {string} href @returns {HTMLAnchorElement} */
function creditLink(text, href) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** Shows the photographer and Unsplash links, or hides the element.

    @param {HTMLElement|null} el
    @param {{ name: string, profile: string, site: string }|null} credit
    @returns {void} */
export function showPhotoCredit(el, credit) {
  if (!el) return;
  el.replaceChildren();
  el.hidden = !credit;
  if (credit) el.append(creditLink(credit.name, credit.profile), ' / ', creditLink('Unsplash', credit.site));
}
