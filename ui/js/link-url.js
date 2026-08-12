/* Which URLs are safe to put in a link the user can click. A denylist: a tile
   link is handed to the OS, so only the schemes that execute script in this
   origin are refused. Enforced on save and again on render.

   The server requires this file directly. Keep it free of the DOM, of window
   and of imports. */

export const UNSAFE_LINK_SCHEMES = Object.freeze([
  'javascript' /* executes in our origin */,
  'data' /* data:text/html runs script in our origin */,
  'vbscript' /* legacy equivalent of javascript: */,
  'blob' /* can reference a document in our origin */,
  'filesystem' /* likewise */,
]);

/* Browsers strip control characters and whitespace from the scheme before
   reading it, so "java\nscript:alert(1)" navigates as javascript:. Strip the
   same ones. */
const stripBlanks = s => {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x20) out += s[i];
  }
  return out;
};

/** @param {unknown} value @returns {boolean} */
export function isSafeLinkUrl(value) {
  if (value === null || value === undefined || value === '') return true; /* no link */
  if (typeof value !== 'string') return false;

  const cleaned = stripBlanks(value);
  const colon = cleaned.indexOf(':');
  if (colon === -1) return true; /* relative, no scheme to worry about */

  const scheme = cleaned.slice(0, colon).toLowerCase();
  /* A colon after a path or query separator is not a scheme. */
  if (/[/?#]/.test(scheme)) return true;
  return !UNSAFE_LINK_SCHEMES.includes(scheme);
}

/* The link-bearing fields on a config item. Add a new one here. */
export const LINK_FIELDS = Object.freeze(['href', 'url']);
export const WIDGET_LINK_FIELDS = Object.freeze(['scrutinyHref', 'linkUrl']);

/** Blank any unsafe link on the items, in place.
    @param {Array<any>} items */
export function sanitizeItemLinks(items) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    for (const f of LINK_FIELDS) {
      if (f in item && !isSafeLinkUrl(item[f])) item[f] = '';
    }
    const wc = item.widgetConfig;
    if (wc && typeof wc === 'object') {
      for (const f of WIDGET_LINK_FIELDS) {
        if (f in wc && !isSafeLinkUrl(wc[f])) wc[f] = '';
      }
    }
  }
  return items;
}

/** The first unsafe link on an item, or null.
    @param {any} item @returns {{ field:string, value:string }|null} */
export function firstUnsafeLink(item) {
  if (!item || typeof item !== 'object') return null;
  for (const f of LINK_FIELDS) {
    if (f in item && !isSafeLinkUrl(item[f])) return { field: f, value: String(item[f]) };
  }
  const wc = item.widgetConfig;
  if (wc && typeof wc === 'object') {
    for (const f of WIDGET_LINK_FIELDS) {
      if (f in wc && !isSafeLinkUrl(wc[f])) return { field: `widgetConfig.${f}`, value: String(wc[f]) };
    }
  }
  return null;
}
