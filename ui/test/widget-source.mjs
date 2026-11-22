/* Reads code out of a widget page and its own script, so a test can run one of
   its functions. A function that cannot be found throws, so a renamed function
   fails the test instead of passing it. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_SCRIPT = /<script( type="module")? src="([\w-][\w.-]*\.js)(?:\?v=[0-9a-zA-Z]+)?"><\/script>/g;

/** A page with each script it loads from its own folder put back inline, so a
    test reads the page and its code as one text. Any other file as it is.
    @param {string | URL} file */
export function pageWithScripts(file) {
  const page = file instanceof URL ? fileURLToPath(file) : file;
  const text = readFileSync(page, 'utf8');
  if (!page.endsWith('.html')) return text;
  return text.replace(
    PAGE_SCRIPT,
    (_tag, type, name) =>
      `<script${type || ''}>\n${readFileSync(path.join(path.dirname(page), name), 'utf8')}</script>`,
  );
}

/** The text of a file under ui/widgets/. A page comes with its own script inline.
    @param {string} widget the folder @param {string} [file] */
export function widgetPage(widget, file = 'index.html') {
  const url = new URL(`../widgets/${widget}/${file}`, import.meta.url);
  return file.endsWith('.html') ? pageWithScripts(url) : readFileSync(url, 'utf8');
}

/** The file a widget page loads its script from: widget.js for index.html,
    otherwise the page's own name.
    @param {string} page a file name ending in .html */
export function pageScriptName(page) {
  const stem = path.basename(page, '.html');
  return stem === 'index' ? 'widget.js' : `${stem}.js`;
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
