// @ts-check
/* Escape-by-default HTML building. Deliberately dependency-free: this is a
   primitive, and anything that renders markup should be able to reach it without
   dragging in a peer. utils.js re-exports esc so existing importers are
   unaffected.

   esc() is opt-in, so every interpolation has to be remembered individually.
   html`` inverts that, making the safe path the one you get by doing nothing.
   Interpolated values are escaped unless wrapped in raw(), which is a single
   greppable token for auditing every place the default is bypassed.

   Nested html`` results and arrays of them pass through unescaped, so lists need
   no manual join and no raw() escape hatch:
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

/* The sanctioned way to write markup into an element. Rejects plain strings, so
   `setHtml(el, userInput)` cannot become an XSS hole the way
   `el.innerHTML = userInput` silently does: the value has to have come from
   html`` or an explicit raw(). That is a runtime guarantee rather than a lint
   heuristic, so it holds for variables and ternaries too.

   The innerHTML write below is the only sanctioned one in the codebase, which is
   why ui/test/innerhtml-ratchet.test.mjs exempts this file and no other.

   Clearing (`el.innerHTML = ''`) writes no markup and needs none of this. */
export function setHtml(el, tpl) {
  if (!(tpl instanceof RawHtml)) {
    throw new TypeError('setHtml expects an html`` or raw() result, not a string');
  }
  el.innerHTML = tpl.value;
}
