import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Raw `el.innerHTML = `, `el.outerHTML = ` and `el.insertAdjacentHTML(...)` string-building is
   safe only while every interpolation remembers esc(). setHtml() + html`` from
   html.js remove that requirement, and pass the markup through the page's
   Trusted Types policy.

   Under Trusted Types a string written to one of these sinks is refused, an
   empty one included. So a clear counts as a write here: a clear is
   `replaceChildren()`. Reads (`if (el.innerHTML)`) do not write markup. */

/* setHtml's own write. It is the single sanctioned innerHTML in the codebase and
   the reason every other file can be held to zero. */
const IMPLEMENTATION = 'html.js';
/* The two modules that hold a Trusted Types policy, and so may parse markup. */
const PARSERS = new Set(['html.js', 'icon-set.js']);

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(uiDir, 'js');
const widgetsDir = path.join(uiDir, 'widgets');
/* Matches `= ` and `+= `, not `==`. */
const ASSIGN = /\.(?:inner|outer)HTML\s*\+?=(?!=)/g;
const INSERT = /\.insertAdjacentHTML\s*\(/g;
const OTHER_SINKS =
  /\.(?:setHTMLUnsafe|createContextualFragment)\s*\(|\bdocument\.write(?:ln)?\s*\(|\.srcdoc\s*=(?!=)/g;
const PARSE = /\bparseFromString\s*\(/g;

const count = (src, re) => (src.match(re) || []).length;
const countWrites = src => count(src, ASSIGN) + count(src, INSERT) + count(src, OTHER_SINKS);

/* Widget markup lives in the .html entry files, the code in each page's own
   script and in any frontend module a widget ships, so both are read. Keyed by
   a path relative to ui/ because two widgets can have an index.html and a bare
   filename would collide. */
function widgetFiles() {
  const out = [];
  for (const d of fs.readdirSync(widgetsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(widgetsDir, d.name))) {
      if (f.endsWith('.html') || f.endsWith('.js')) {
        out.push([`widgets/${d.name}/${f}`, path.join(widgetsDir, d.name, f)]);
      }
    }
  }
  return out;
}

const scanned = [
  ...fs
    .readdirSync(jsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => [f, path.join(jsDir, f)]),
  ...widgetFiles(),
].map(([key, full]) => [key, fs.readFileSync(full, 'utf8')]);

test('the scan sees the modules and the widget page scripts', () => {
  const keys = scanned.map(([key]) => key);
  assert.ok(keys.includes('widget-toolbox.js'));
  assert.ok(keys.includes('widgets/weather/widget.js'));
  assert.ok(keys.includes('widgets/clock/analog.js'));
});

test('an outerHTML write counts like an innerHTML one, a clear included', () => {
  assert.equal(countWrites('el.outerHTML = `<b>${v}</b>`;'), 1);
  assert.equal(countWrites("el.innerHTML = '';"), 1);
  assert.equal(countWrites('el.innerHTML += s;'), 1);
  assert.equal(countWrites('if (el.innerHTML === s) x();'), 0);
  assert.equal(countWrites('const s = el.outerHTML;'), 0);
  assert.equal(countWrites("el.insertAdjacentHTML('beforeend', s);"), 1);
});

test('no file writes markup to an HTML sink outside setHtml', () => {
  const offenders = scanned
    .filter(([key]) => key !== IMPLEMENTATION)
    .map(([key, src]) => [key, countWrites(src)])
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${key}: ${n}`);
  assert.deepEqual(
    offenders,
    [],
    `Use setHtml(el, html\`...\`) from the toolbox to write, or replaceChildren() to clear:\n${offenders.join('\n')}`,
  );
});

test('markup is parsed only where a Trusted Types policy is held', () => {
  const offenders = scanned.filter(([key, src]) => !PARSERS.has(key) && count(src, PARSE) > 0).map(([key]) => key);
  assert.deepEqual(
    offenders,
    [],
    `Use parseMarkup(raw(src), type) from html.js or the toolbox: ${offenders.join(', ')}`,
  );
});

/* The check above asks what is being assigned. This asks nothing: outside its
   one implementation, ui/js does not name the property at all. That is only
   enforceable because every clear is replaceChildren(), and it is what stops a
   safe clear being edited into an unsafe write. */
test('no module outside html.js names innerHTML at all', () => {
  const offenders = [];
  for (const file of fs.readdirSync(jsDir).sort()) {
    if (!file.endsWith('.js') || file === IMPLEMENTATION) continue;
    const text = fs.readFileSync(path.join(jsDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = (text.match(/(?:inner|outer)HTML/g) || []).length;
    if (hits) offenders.push(`js/${file}: ${hits}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `Use setHtml(el, html\`...\`) to write, or replaceChildren() to clear:\n${offenders.join('\n')}`,
  );
});
