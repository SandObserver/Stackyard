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

/** A widget field that holds a link: marked `link: true`, or a text field
    named `href` or ending in `Href`.
    @param {any} f @returns {boolean} */
export function isLinkField(f) {
  if (!f || typeof f.key !== 'string') return false;
  return f.link === true || (f.type === 'text' && /^href$|Href$/.test(f.key));
}

/** @param {unknown} fields @returns {string[]} */
function linkFieldKeys(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.filter(isLinkField).map(f => f.key);
}

/** @param {any} wc @param {unknown} fields
    @returns {{ holder: any, key: string, path: string }[]} */
function widgetLinks(wc, fields) {
  const out = [];
  if (!wc || typeof wc !== 'object' || !Array.isArray(fields)) return out;
  for (const key of linkFieldKeys(fields)) if (Object.hasOwn(wc, key)) out.push({ holder: wc, key, path: key });
  for (const group of fields) {
    if (typeof group?.key !== 'string' || !Object.hasOwn(wc, group.key)) continue;
    const keys = linkFieldKeys(group.fields);
    const value = wc[group.key];
    if (!keys.length || !value || typeof value !== 'object') continue;
    if (group.type === 'object' && !Array.isArray(value)) {
      for (const key of keys)
        if (Object.hasOwn(value, key)) out.push({ holder: value, key, path: `${group.key}.${key}` });
      continue;
    }
    if (group.type !== 'group' || !Array.isArray(value)) continue;
    value.forEach((row, i) => {
      if (!row || typeof row !== 'object') return;
      for (const key of keys)
        if (Object.hasOwn(row, key)) out.push({ holder: row, key, path: `${group.key}.${i}.${key}` });
    });
  }
  return out;
}

/** Blank any unsafe link on the items, in place.
    @param {Array<any>} items
    @param {(widgetType: string) => unknown} [fieldsFor] a widget type's manifest fields */
export function sanitizeItemLinks(items, fieldsFor) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    for (const f of LINK_FIELDS) {
      if (f in item && !isSafeLinkUrl(item[f])) item[f] = '';
    }
    if (!fieldsFor || typeof item.widgetType !== 'string') continue;
    for (const { holder, key } of widgetLinks(item.widgetConfig, fieldsFor(item.widgetType)))
      if (!isSafeLinkUrl(holder[key])) holder[key] = '';
  }
  return items;
}

/** The first unsafe link on an item, or null.
    @param {any} item
    @param {(widgetType: string) => unknown} [fieldsFor] a widget type's manifest fields
    @returns {{ field:string, value:string }|null} */
export function firstUnsafeLink(item, fieldsFor) {
  if (!item || typeof item !== 'object') return null;
  for (const f of LINK_FIELDS) {
    if (f in item && !isSafeLinkUrl(item[f])) return { field: f, value: String(item[f]) };
  }
  if (!fieldsFor || typeof item.widgetType !== 'string') return null;
  for (const { holder, key, path } of widgetLinks(item.widgetConfig, fieldsFor(item.widgetType)))
    if (!isSafeLinkUrl(holder[key])) return { field: `widgetConfig.${path}`, value: String(holder[key]) };
  return null;
}
