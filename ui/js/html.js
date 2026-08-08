// @ts-check
/* Escape-by-default HTML building, and deliberately dependency-free: anything
   that renders markup must be able to reach it.

   Interpolated values are escaped unless wrapped in raw(), which is one
   greppable token for auditing every place the default is bypassed. Nested
   html`` results and arrays of them pass through, so lists need no join:
     html`<ul>${items.map(i => html`<li>${i.label}</li>`)}</ul>` */

export const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

class RawHtml {
  constructor(v) { this.value = String(v); }
  toString() { return this.value; }
}

export const raw = v => new RawHtml(v);

/* null/undefined/false render as nothing so `${cond && html`...`}` and
   `${maybe ?? ''}` behave. Everything else is escaped, including numbers. */
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

/* The only sanctioned way to write markup into an element, and the only
   sanctioned innerHTML write in the codebase, which is why
   ui/test/innerhtml-ratchet.test.mjs exempts this file alone. Plain strings are
   rejected at runtime, so the value must have come from html`` or raw(). */
export function setHtml(el, tpl) {
  if (!(tpl instanceof RawHtml)) {
    throw new TypeError('setHtml expects an html`` or raw() result, not a string');
  }
  el.innerHTML = tpl.value;
}
