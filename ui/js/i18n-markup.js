// @ts-check
/* The subset of markup a translation may contain: these four tags, no
   attributes, everything else escaped. The output is rebuilt, not filtered.
   Permitting an attribute means validating a URL, scrubbing a style and
   stripping an event handler. */

import { esc, raw } from '/js/html.js?v=ccec347c';

export const ALLOWED_TAGS = Object.freeze(['strong', 'em', 'code', 'br']);
/* br is void. It never has a closing tag and never wraps anything. */
export const VOID_TAGS = Object.freeze(['br']);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*(\/?)>/g;

/** Escape a translated string, keeping only the allowed tags.
    @param {string} value
    @returns {string} */
export function sanitizeI18nMarkup(value) {
  const src = String(value == null ? '' : value);
  let out = '';
  let last = 0;
  /* Tags opened and not yet closed. A stray closing tag must not unbalance the
     result and leak into the surrounding markup. */
  const open = [];

  TAG.lastIndex = 0;
  for (let m = TAG.exec(src); m !== null; m = TAG.exec(src)) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;

    const [, closing, rawName, selfClosing] = m;
    const name = rawName.toLowerCase();

    if (!ALLOWED_TAGS.includes(name)) {
      out += esc(m[0]);
      continue;
    }

    if (VOID_TAGS.includes(name)) {
      if (!closing) out += `<${name}>`;
      continue;
    }
    if (selfClosing) {
      out += esc(m[0]);
      continue;
    } /* <strong/> is not meaningful */

    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue; /* closes nothing; drop it */
      /* Close anything still open inside it. The output must stay well-formed. */
      while (open.length > at) out += `</${open.pop()}>`;
    } else {
      open.push(name);
      out += `<${name}>`;
    }
  }
  out += esc(src.slice(last));

  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** The same, wrapped so it can go straight into setHtml.
    @param {string} value */
export const i18nMarkup = value => raw(sanitizeI18nMarkup(value));
