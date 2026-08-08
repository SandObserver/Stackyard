// @ts-check
/* The subset of markup a translation may contain: these four tags, no attributes
   at all, everything else escaped. Output is rebuilt rather than filtered, so
   anything unrecognised becomes visible text.

   Permitting no attributes is what keeps this short: no URL to validate, no
   style to scrub, no event handler to strip. Widening that is a decision to make
   here, deliberately. */

import { esc, raw } from '/js/html.js?v=ccec347c';

export const ALLOWED_TAGS = Object.freeze(['strong', 'em', 'code', 'br']);
/* br is void: it never has a closing tag and never wraps anything. */
export const VOID_TAGS = Object.freeze(['br']);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*(\/?)>/g;

/** Escape a translated string, keeping only the allowed tags.
    @param {string} value
    @returns {string} */
export function sanitizeI18nMarkup(value) {
  const src = String(value == null ? '' : value);
  let out = '';
  let last = 0;
  /* Tags opened and not yet closed, so a stray or mismatched closing tag cannot
     unbalance the result and leak into surrounding markup. */
  const open = [];

  TAG.lastIndex = 0;
  for (let m = TAG.exec(src); m !== null; m = TAG.exec(src)) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;

    const [, closing, rawName, selfClosing] = m;
    const name = rawName.toLowerCase();

    /* Shown as text, not dropped, so a translator sees the mistake rather than
       losing the word inside it. */
    if (!ALLOWED_TAGS.includes(name)) {
      out += esc(m[0]);
      continue;
    }

    if (VOID_TAGS.includes(name)) {
      /* A closing tag for a void element is meaningless; drop it silently. */
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
      /* Close anything still open inside it, so the output stays well-formed. */
      while (open.length > at) out += `</${open.pop()}>`;
    } else {
      open.push(name);
      out += `<${name}>`;
    }
  }
  out += esc(src.slice(last));

  /* Close whatever the string left open. */
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** The same, wrapped so it can go straight into setHtml.
    @param {string} value */
export const i18nMarkup = value => raw(sanitizeI18nMarkup(value));
