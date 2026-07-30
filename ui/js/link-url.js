/* Which URLs are safe to put in a link the user can click.

   A denylist, not an allowlist, and the distinction is deliberate. The outbound
   fetch guard allowlists http and https because the server makes those requests
   itself, so anything it does not understand is a risk it is taking. A tile link
   is the opposite: the browser hands the URL to the OS or to a protocol handler,
   and homelab dashboards legitimately link to ssh://, vnc://, rdp://, smb://,
   steam:// and whatever else the user has registered. Allowlisting http and
   https here would break those for no security gain.

   What must be refused is the small set of schemes that execute script in our
   own origin when the link is clicked. `rel="noopener noreferrer"` does nothing
   about those; the scheme has to be rejected.

   This is the only copy of the rule. The server requires this file directly
   (Node has supported require() of an ES module since 22.12, and the image runs
   24), so there is one definition to change rather than two to keep in step.

   It is enforced at two moments: on save, so a bad value cannot be stored, and on
   render, so a config written before this existed or arriving by import cannot
   fire either.

   Because the server loads it, this file must stay free of anything only a
   browser has: no DOM, no window, no imports. api/test/link-url.test.js checks
   that by loading it in Node. */

export const UNSAFE_LINK_SCHEMES = Object.freeze([
  'javascript', /* executes in our origin */
  'data',       /* data:text/html runs script in our origin */
  'vbscript',   /* legacy equivalent of javascript: */
  'blob',       /* can reference a document in our origin */
  'filesystem', /* likewise */
]);

/* Browsers discard control characters and whitespace anywhere in the scheme
   before reading it, so "java\nscript:alert(1)" navigates as javascript:. The
   same characters are removed here, or the check reads a scheme the browser will
   not. Written as a scan rather than a character-class range because a control
   character inside a regular expression is almost always a mistake, and the lint
   rule that says so is worth keeping. */
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
  if (colon === -1) return true;   /* relative, no scheme to worry about */

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
