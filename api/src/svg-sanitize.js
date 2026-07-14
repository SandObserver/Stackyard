/* Defense-in-depth sanitizer for uploaded SVG icons, split out from the icons
   route so it can be unit-tested. The primary XSS control is that uploaded SVGs
   render only through <img src> (a non-executing context). See the SECURITY
   INVARIANT note in ui/js/icons.js. This strips script-capable elements and
   attributes as a second layer. Pure: string in, sanitized string out. */

const SAFE_ELEMENTS = new Set(['svg','g','path','circle','ellipse','rect','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','clipPath','mask','symbol','use','title','desc','style']);
const SAFE_ATTRS    = new Set(['viewBox','xmlns','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','transform','d','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','points','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','patternUnits','patternTransform','clip-path','mask','id','class','style','preserveAspectRatio','text-anchor','font-size','font-family','font-weight']);
const SAFE_ELEMENTS_LC = new Set([...SAFE_ELEMENTS].map(s => s.toLowerCase()));
const SAFE_ATTRS_LC    = new Set([...SAFE_ATTRS].map(s => s.toLowerCase()));
const UNSAFE_ATTR_RE = /^(on\w|href|xlink:href|src|action|formaction|data)$/i;

function scrubCss(css) {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(?!#)[^)]*\)/gi, '')
    .replace(/(javascript|behavior|vbscript)\s*:/gi, '');
}

function sanitizeSvg(input) {
  /* Run the strip passes until the string stops changing. A single pass can
     leave a reconstructed token behind (e.g. `<scr<script>ipt>` collapses to
     `<script>`, `<!--<!-- -->` to `<!-- -->`), so repeat to a fixed point.
     Each pass only removes, so length is non-increasing and this terminates. */
  let svg = String(input), prev, guard = 0;
  do {
    prev = svg;
    svg = svg
      .replace(/<\?[\s\S]*?(?:\?>|$)/g, '')
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<!DOCTYPE[^>]*(?:>|$)/gi, '');
    svg = svg.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, body, cl) => open + scrubCss(body) + cl);
    svg = svg.replace(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9:]*)([\s\S]*?)(\/?)?>/g, (_match, close, tag, attrs, selfClose) => {
      const localTag = tag.split(':').pop().toLowerCase();
      if (!SAFE_ELEMENTS_LC.has(localTag)) return '';
      const safeAttrs = attrs.replace(/\s([a-zA-Z:_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g, (m, name, dq, sq, uq) => {
        const lname = name.toLowerCase();
        if (UNSAFE_ATTR_RE.test(lname)) return '';
        if (!SAFE_ATTRS_LC.has(lname) && !lname.startsWith('aria-') && !lname.startsWith('data-')) return '';
        if (lname === 'style') {
          const q = dq != null ? '"' : (sq != null ? "'" : '"');
          return ` ${name}=${q}${scrubCss(dq != null ? dq : (sq != null ? sq : (uq || '')))}${q}`;
        }
        return m;
      });
      return `<${close}${tag}${safeAttrs}${selfClose || ''}>`;
    });
  } while (svg !== prev && ++guard < 50);
  return svg;
}

module.exports = { sanitizeSvg };
