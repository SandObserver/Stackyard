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

/* The only sanctioned innerHTML write in the codebase. Plain strings are
   rejected at runtime, so the value must have come from html`` or raw(). */
export function setHtml(el, tpl) {
  if (!(tpl instanceof RawHtml)) {
    throw new TypeError('setHtml expects an html`` or raw() result, not a string');
  }
  el.innerHTML = tpl.value;
}
