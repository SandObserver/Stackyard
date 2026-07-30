/* Server-side copy of the link-URL rule. See ui/js/link-url.js for why this is a
   denylist rather than an allowlist, and note that api/test/link-url.test.js
   fails if the two lists drift apart.

   Two copies exist because the rule is enforced at two moments in two module
   systems: here on save, so an unsafe value is never stored, and in the browser
   on render, so a config written before this existed or arriving by import
   cannot fire either. */

const UNSAFE_LINK_SCHEMES = Object.freeze([
  'javascript',
  'data',
  'vbscript',
  'blob',
  'filesystem',
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
function isSafeLinkUrl(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;

  const cleaned = stripBlanks(value);
  const colon = cleaned.indexOf(':');
  if (colon === -1) return true;

  const scheme = cleaned.slice(0, colon).toLowerCase();
  if (/[/?#]/.test(scheme)) return true;
  return !UNSAFE_LINK_SCHEMES.includes(scheme);
}

const LINK_FIELDS = Object.freeze(['href', 'url']);
const WIDGET_LINK_FIELDS = Object.freeze(['scrutinyHref', 'linkUrl']);

/** The first unsafe link on an item, or null. Used to reject a save with a
    message naming the field, rather than silently blanking it.
    @param {any} item @returns {{ field:string, value:string }|null} */
function firstUnsafeLink(item) {
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

module.exports = { UNSAFE_LINK_SCHEMES, isSafeLinkUrl, LINK_FIELDS, WIDGET_LINK_FIELDS, firstUnsafeLink };
