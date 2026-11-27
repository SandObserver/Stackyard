import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../css');

const blank = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

/** Every declaration in a stylesheet, nested rules included.
    @returns {Generator<{prop: string, value: string, start: number, end: number, line: number, context: string[]}>}
    `start` and `end` bound the value in the source. `context` lists the
    enclosing preludes, outermost first. */
export function* declarations(css) {
  const src = blank(css);
  const stack = [];
  let buf = '';
  let bufStart = 0;
  let depth = 0;
  let quote = '';
  function* flush(at) {
    const i = buf.indexOf(':');
    const prop = i > 0 ? buf.slice(0, i).trim() : '';
    if (/^-?-?[a-zA-Z][\w-]*$/.test(prop)) {
      const raw = buf.slice(i + 1);
      const value = raw.trim();
      const start = bufStart + i + 1 + (raw.length - raw.trimStart().length);
      const line = src.slice(0, start).split('\n').length;
      yield { prop, value, start, end: start + value.length, line, context: [...stack] };
    }
    buf = '';
    bufStart = at + 1;
  }
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (quote) {
      buf += c;
      if (c === '\\') buf += src[++k] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
      bufStart = k + 1;
      continue;
    } else if (depth === 0 && (c === ';' || c === '}')) {
      yield* flush(k);
      if (c === '}') stack.pop();
      continue;
    }
    if (!buf) bufStart = k;
    buf += c;
  }
}

/** Custom properties declared once across `sources`, in a top-level :root,
    with a value that names no other property. */
function literalTokens(sources) {
  const seen = new Map();
  for (const src of sources) {
    for (const d of declarations(src)) {
      if (!d.prop.startsWith('--')) continue;
      const once = !seen.has(d.prop);
      const plain = d.context.length === 1 && d.context[0] === ':root' && !d.value.includes('var(');
      seen.set(d.prop, once && plain ? d.value : null);
    }
  }
  return new Map([...seen].filter(([, v]) => v !== null));
}

/** A stylesheet with each spacing step written back as its value, so a check
    that reads a literal reads the same text whether a rule names the value or
    the step. `colours` also writes back each token the page declares once, as
    a literal, in its own :root. */
export function inlineTokens(css, { colours = false } = {}) {
  const tokens = fs.readFileSync(path.join(cssDir, 'tokens.css'), 'utf8');
  const steps = new Map([...literalTokens([tokens])].filter(([k]) => k.startsWith('--sp-')));
  const own = [...literalTokens([tokens, css])].filter(([k]) => !k.startsWith('--sp-') && !tokens.includes(`${k}:`));
  let out = css.replace(/calc\(var\((--sp-\d+)\) \* -1\)/g, (m, k) => (steps.has(k) ? `-${steps.get(k)}` : m));
  for (const [k, v] of [...steps, ...(colours ? own : [])]) out = out.split(`var(${k})`).join(v);
  return out;
}

/** A stylesheet from ui/css, read through inlineTokens. */
export const readInlined = (name, options) => inlineTokens(fs.readFileSync(path.join(cssDir, name), 'utf8'), options);
