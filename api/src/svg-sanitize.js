/* Defense-in-depth sanitizer for uploaded SVG icons, split out from the icons
   route so it can be unit-tested. The primary XSS control is that uploaded SVGs
   render only through <img src> (a non-executing context). See the SECURITY
   INVARIANT note in ui/js/icons.js. This is the second layer. Pure: string in,
   sanitized string out.

   It works by rebuilding, not by stripping. The input is tokenized, and the
   output is written fresh from the allowlist: an element or attribute that is
   not recognised is never copied across, and every value emitted is escaped on
   the way out.

   That direction matters more than any individual rule. The previous version
   removed what it recognised as dangerous and passed the rest through, so a
   construct it failed to parse survived intact. `<path/onload="alert(1)">` was
   one: browsers accept `/` as an attribute separator, the attribute pattern
   required whitespace, so it matched nothing and the handler was copied out
   verbatim. Rebuilding turns that class of bug from a bypass into dropped
   markup, because anything the tokenizer misreads fails to be emitted. */

const SAFE_ELEMENTS = new Set(['svg','g','path','circle','ellipse','rect','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','clipPath','mask','symbol','use','title','desc','style']);
const SAFE_ATTRS    = new Set(['viewBox','xmlns','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','transform','d','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','points','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','patternUnits','patternTransform','clip-path','mask','id','class','style','preserveAspectRatio','text-anchor','font-size','font-family','font-weight']);
const SAFE_ELEMENTS_LC = new Set([...SAFE_ELEMENTS].map(s => s.toLowerCase()));
const SAFE_ATTRS_LC    = new Set([...SAFE_ATTRS].map(s => s.toLowerCase()));

/* Attributes that take a URL or a payload, none of which an icon needs. */
const UNSAFE_ATTR_RE = /^(href|xlink:href|src|action|formaction|data)$/i;
/* Any on* attribute is an event handler (onload, onerror, onclick, ...). */
const EVENT_ATTR_RE = /^on/i;

/* Characters that end a tag or attribute name. `/` is here because browsers
   accept it as a separator, which is what the old pattern missed. */
const NAME_END = /[\s/>=]/;
const WS_OR_SLASH = /[\s/]/;

function scrubCss(css) {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(?!#)[^)]*\)/gi, '')
    .replace(/(javascript|behavior|vbscript)\s*:/gi, '');
}

const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/* ── Tokenizer ─────────────────────────────────────────────────────────────
   Permissive about malformed input and deliberately lossy: it reports what it
   understood, and anything it did not understand is not reported, so it cannot
   reach the output. */

/** @param {string} src @param {number} i
    @returns {{ attrs:Array<{name:string,value:string}>, i:number, selfClose:boolean }} */
function readAttributes(src, i) {
  /** @type {Array<{name:string,value:string}>} */
  const attrs = [];
  let selfClose = false;
  while (i < src.length) {
    /* Whitespace and slashes both separate attributes. A slash immediately
       before '>' is the self-closing marker; one anywhere else is a separator. */
    while (i < src.length && WS_OR_SLASH.test(src[i])) {
      selfClose = src[i] === '/';
      i++;
    }
    if (i >= src.length) break;
    if (src[i] === '>') { i++; break; }

    const nameStart = i;
    while (i < src.length && !NAME_END.test(src[i])) i++;
    const name = src.slice(nameStart, i);
    if (!name) { i++; continue; }   /* nothing consumable here, keep moving */
    selfClose = false;

    let j = i;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '=') { attrs.push({ name, value: '' }); continue; }

    j++;
    while (j < src.length && /\s/.test(src[j])) j++;
    const q = src[j];
    if (q === '"' || q === "'") {
      const end = src.indexOf(q, j + 1);
      if (end === -1) { attrs.push({ name, value: src.slice(j + 1) }); i = src.length; break; }
      attrs.push({ name, value: src.slice(j + 1, end) });
      i = end + 1;
    } else {
      /* An unquoted value runs to whitespace or '>'. A '/' immediately before
         '>' ends it too: HTML would keep that slash in the value, but in SVG it
         is the self-closing marker, and swallowing it would turn <rect width=5/>
         into width="5/" and lose the close. */
      const start = j;
      while (j < src.length && !/[\s>]/.test(src[j]) && !(src[j] === '/' && src[j + 1] === '>')) j++;
      attrs.push({ name, value: src.slice(start, j) });
      i = j;
    }
  }
  return { attrs, i, selfClose };
}

/* Two typedefs rather than one with a 'text'|'css' type: a union discriminant
   cannot be narrowed away member by member, so the serializer's guards would not
   tell the checker what it is holding. */
/** @typedef {{ type:'text', value:string }} SvgTextToken */
/** @typedef {{ type:'css', value:string }} SvgCssToken */
/** @typedef {{ type:'open', name:string, attrs:Array<{name:string,value:string}>, selfClose:boolean }} SvgOpenToken */
/** @typedef {{ type:'close', name:string }} SvgCloseToken */
/** @typedef {SvgTextToken|SvgCssToken|SvgOpenToken|SvgCloseToken} SvgToken */

/** @param {string} src @returns {SvgToken[]} */
function tokenize(src) {
  /** @type {SvgToken[]} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out.push({ type: 'text', value: src.slice(i) }); break; }
    if (lt > i) out.push({ type: 'text', value: src.slice(i, lt) });

    const rest = src.slice(lt, lt + 9);
    /* Comments, CDATA, DOCTYPE and processing instructions are dropped whole.
       An unterminated one swallows the remainder, which is the safe direction. */
    if (rest.startsWith('<!--')) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (rest.startsWith('<![CDATA[')) {
      const end = src.indexOf(']]>', lt + 9);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      const end = src.indexOf('>', lt + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const isClose = src[lt + 1] === '/';
    const nameAt = lt + (isClose ? 2 : 1);
    if (!/[a-zA-Z]/.test(src[nameAt] || '')) {
      /* A '<' that does not start a tag is literal text, escaped on output. */
      out.push({ type: 'text', value: '<' });
      i = lt + 1;
      continue;
    }

    let j = nameAt;
    while (j < src.length && !NAME_END.test(src[j])) j++;
    const name = src.slice(nameAt, j);

    if (isClose) {
      const gt = src.indexOf('>', j);
      out.push({ type: 'close', name });
      i = gt === -1 ? src.length : gt + 1;
      continue;
    }

    const { attrs, i: next, selfClose } = readAttributes(src, j);
    out.push({ type: 'open', name, attrs, selfClose });
    i = next;

    /* <style> holds CSS, not markup, so its body is taken raw up to the closing
       tag exactly as a browser does. Tokenizing it as markup would let a '<'
       inside a selector or a string derail the parse. */
    if (name.toLowerCase() === 'style' && !selfClose) {
      const at = src.slice(i).search(/<\/\s*style\b/i);
      const end = at === -1 ? src.length : i + at;
      out.push({ type: 'css', value: src.slice(i, end) });
      i = end;
    }
  }
  return out;
}

/* ── Serializer ───────────────────────────────────────────────────────────── */

function keepAttr(name) {
  const lname = name.toLowerCase();
  if (UNSAFE_ATTR_RE.test(lname) || EVENT_ATTR_RE.test(lname)) return false;
  return SAFE_ATTRS_LC.has(lname) || lname.startsWith('aria-') || lname.startsWith('data-');
}

/** Rebuild the document from the allowlist.
    @param {string} input @returns {string} */
function sanitizeSvg(input) {
  let out = '';
  for (const tok of tokenize(String(input))) {
    if (tok.type === 'text') { out += escText(tok.value); continue; }

    /* CSS is emitted without entity escaping, which would break selectors, so
       any '<' is removed instead: nothing in valid CSS needs one, and leaving it
       is what would let markup be reassembled inside a style body. */
    if (tok.type === 'css') { out += scrubCss(tok.value).replace(/</g, ''); continue; }

    /* Drop any namespace prefix, so <svg:script> is matched as 'script'. */
    const local = tok.name.replace(/^.*:/, '').toLowerCase();
    if (!SAFE_ELEMENTS_LC.has(local)) continue;   /* dropped, never copied */

    if (tok.type === 'close') { out += `</${tok.name}>`; continue; }

    let attrs = '';
    for (const { name, value } of tok.attrs) {
      if (!keepAttr(name)) continue;
      const v = name.toLowerCase() === 'style' ? scrubCss(value) : value;
      attrs += ` ${name}="${escAttr(v)}"`;
    }
    out += `<${tok.name}${attrs}${tok.selfClose ? '/' : ''}>`;
  }
  return out;
}

module.exports = { sanitizeSvg };
