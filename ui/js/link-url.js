/* Which URLs are safe to put in a link the user can click.

   A denylist on purpose: a tile link is handed to the OS, and a homelab links
   to ssh://, vnc:// and whatever else the user registered, so only the schemes
   that execute script in our own origin are refused. Enforced on save and again
   on render, since a config can arrive by import.

   The server requires this file directly, so it must stay free of anything only
   a browser has: no DOM, no window, no imports. */

export const UNSAFE_LINK_SCHEMES = Object.freeze([
  'javascript' /* executes in our origin */,
  'data' /* data:text/html runs script in our origin */,
  'vbscript' /* legacy equivalent of javascript: */,
  'blob' /* can reference a document in our origin */,
  'filesystem' /* likewise */,
]);

/* Browsers strip control characters and whitespace from the scheme before
   reading it, so "java\nscript:alert(1)" navigates as javascript:. Strip the
   same ones, or this reads a scheme the browser will not. */
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
  /* A colon that appears after a path or query separator is not a scheme:
     "/go?to=a:b" is relative. A real scheme cannot contain those characters. */
  if (/[/?#]/.test(scheme)) return true;
  return !UNSAFE_LINK_SCHEMES.includes(scheme);
}

/* The link-bearing fields on a config item. Kept in one place so a new one is
   added here rather than in each of the nine places an item is rendered. */
export const LINK_FIELDS = Object.freeze(['href', 'url']);
export const WIDGET_LINK_FIELDS = Object.freeze(['scrutinyHref', 'linkUrl']);

/** Blank any unsafe link on the items, in place. Returns the same array so it
    can be used inline where a config response is unpacked.
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

/** The first unsafe link on an item, or null. Used by the server to reject a save
    with a message naming the field, rather than silently blanking it.
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
