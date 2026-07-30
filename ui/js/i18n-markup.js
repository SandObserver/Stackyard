// @ts-check
/* The tiny subset of markup a translation may contain.

   Most translated strings are plain text and are written with textContent. A few
   need emphasis inside a sentence, and splitting those into separate keys is the
   wrong answer: word order differs between languages, and a translator has to be
   able to move the emphasis. So `data-i18n-html` exists.

   It used to pass the whole value through raw(), which switches escaping off
   entirely, so a translation could contain a script tag or an event handler.
   Locale files are static assets with no runtime mechanism to add one, so the
   realistic path was a careless or malicious translation contribution rather than
   an attacker; this is hardening, not a live hole.

   The rule: these four tags, no attributes at all, everything else escaped.
   Output is rebuilt rather than filtered, the same direction as the SVG
   sanitizer, so anything unrecognised becomes visible text rather than markup
   that slipped through.

   No attributes are permitted, which is what keeps this twenty lines instead of
   two hundred: with no attributes there is no URL to validate, no style to scrub
   and no event handler to strip. If a future string needs one, that is a
   deliberate decision to make here, not a gap to widen accidentally. */

import { esc, raw } from '/js/html.js?v=1';

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

    /* Anything not on the list is shown as text, not dropped: a translator who
       writes <b> should see it in the UI and fix it, rather than silently lose
       the word inside it. */
    if (!ALLOWED_TAGS.includes(name)) { out += esc(m[0]); continue; }

    if (VOID_TAGS.includes(name)) {
      /* A closing tag for a void element is meaningless; drop it silently. */
      if (!closing) out += `<${name}>`;
      continue;
    }
    if (selfClosing) { out += esc(m[0]); continue; }  /* <strong/> is not meaningful */

    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue;               /* closes nothing; drop it */
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
