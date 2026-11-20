/* Reads code out of a widget page's inline scripts, so a test can run one of
   its functions. Widget code stays in the page. A function that cannot be found
   throws, so a renamed function fails the test instead of passing it. */

import { readFileSync } from 'node:fs';

/** The text of a file under ui/widgets/.
    @param {string} widget the folder @param {string} [file] */
export function widgetPage(widget, file = 'index.html') {
  return readFileSync(new URL(`../widgets/${widget}/${file}`, import.meta.url), 'utf8');
}

/** The source of the top-level `function name(` in `src`, through its closing brace.
    @param {string} src @param {string} name */
export function functionSource(src, name) {
  const at = src.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  if (at < 0) throw new Error(`function ${name} is gone from the widget`);
  let depth = 0;
  let quote = '';
  for (let i = src.indexOf('{', src.indexOf(')', at)); i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i) + 1;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`function ${name} has no closing brace`);
}

/** Build the named functions from a widget page, with `scope` as the names they
    read from the rest of the page.
    @param {string} src @param {string[]} names @param {Record<string, unknown>} [scope] */
export function widgetFunctions(src, names, scope = {}) {
  const body = `${names.map(n => functionSource(src, n)).join('\n')}\nreturn { ${names.join(', ')} };`;
  return new Function(...Object.keys(scope), body)(...Object.values(scope));
}
