// @ts-check
/* Escape-by-default HTML building. Keep it dependency-free: anything that
   renders markup must be able to reach it. Interpolated values are escaped
   unless wrapped in raw(), which is the one greppable token for auditing every
   bypass. */

export const esc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

class RawHtml {
  constructor(v) {
    this.value = String(v);
  }
  toString() {
    return this.value;
  }
}

export const raw = v => new RawHtml(v);

const interpolate = v => {
  if (v instanceof RawHtml) return v.value;
  if (Array.isArray(v)) return v.map(interpolate).join('');
  if (v == null || v === false) return '';
  return esc(v);
};

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1];
  return new RawHtml(out);
}

/* The page's Content-Security-Policy names this policy in trusted-types. A
   rename here without the same rename in nginx/dashboard.conf blocks every
   markup write once that rule is enforced. */
export const POLICY_NAME = 'stackyard-html';

/** @type {{ createHTML: (s: string) => unknown } | null} */
let policy = null;
try {
  policy = /** @type {any} */ (globalThis).trustedTypes?.createPolicy(POLICY_NAME, { createHTML: s => s }) ?? null;
} catch {
  policy = null;
}

/** @param {RawHtml} tpl @param {string} caller @returns {string} */
function trusted(tpl, caller) {
  if (!(tpl instanceof RawHtml)) {
    throw new TypeError(`${caller} expects an html\`\` or raw() result, not a string`);
  }
  return /** @type {string} */ (policy ? policy.createHTML(tpl.value) : tpl.value);
}

/* The only sanctioned innerHTML write in the codebase. Plain strings are
   rejected at runtime, so the value must have come from html`` or raw(). */
export function setHtml(el, tpl) {
  el.innerHTML = trusted(tpl, 'setHtml');
}

/** Parse markup built in code. Like setHtml, it takes only an html`` or raw()
    result. `Parser` is the DOMParser of the document the result is for.
    @param {RawHtml} tpl @param {DOMParserSupportedType} type
    @param {typeof DOMParser} [Parser] @returns {Document} */
export function parseMarkup(tpl, type, Parser = globalThis.DOMParser) {
  return new Parser().parseFromString(trusted(tpl, 'parseMarkup'), type);
}
