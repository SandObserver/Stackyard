import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* docs/widgets.md against the contract it describes.

   The guide is the whole specification of what a widget author may rely on, and
   the two halves that had drifted are the ones nothing was checking: the iframe
   URL grew `size`, `mobile` and `lang` while the guide still described only
   `id`, and the widget page's Content-Security-Policy, which decides what a
   frontend is allowed to load, was never written down at all.

   Pinned by the value, not by the sentence, for the same reason as
   api/test/security-doc.test.js: a test that matches wording turns every edit
   into a test edit. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const doc = read('docs/widgets.md');
const widgetTypes = read('ui/js/widget-types.js');
const nginx = read('nginx/dashboard.conf');

/* The table under the heading, so a parameter named in passing elsewhere in the
   guide does not count as documented. */
function documentedParams() {
  const at = doc.indexOf('### What the iframe is given');
  assert.notEqual(at, -1, 'the iframe URL section is gone from docs/widgets.md');
  const section = doc.slice(at, doc.indexOf('\n### ', at + 5));
  return [...section.matchAll(/^\| `(\w+)` \|/gm)].map(m => m[1]).sort();
}

/* Every parameter widgetSrc puts on the URL. */
function codeParams() {
  const fn = /export function widgetSrc[\s\S]*?\n}/.exec(widgetTypes);
  assert.ok(fn, 'widgetSrc not found in widget-types.js');
  return [...fn[0].matchAll(/parts\.push\('(\w+)=/g)].map(m => m[1]).sort();
}

test('the scan finds both sides', () => {
  assert.ok(doc.length > 5000, 'docs/widgets.md looks truncated');
  assert.ok(codeParams().length >= 3, 'widgetSrc appears to build no URL parameters');
});

test('every iframe URL parameter is documented, and no others', () => {
  assert.deepEqual(documentedParams(), codeParams(),
    'the iframe parameter table in docs/widgets.md is out of date');
});

test('the design canvas sizes are the ones the code uses', () => {
  const inCode = [...widgetTypes.matchAll(/(\w+):\s*\[(\d+),\s*(\d+)\]/g)]
    .map(m => `${m[1]} ${m[2]} ${m[3]}`).sort();
  assert.ok(inCode.length >= 4, `only ${inCode.length} canvas sizes found in the code`);

  const at = doc.indexOf('### Design canvas sizes');
  assert.notEqual(at, -1, 'the canvas size section is gone');
  const section = doc.slice(at, doc.indexOf('\n## ', at));
  const documented = [...section.matchAll(/^\| (\w+) \| (\d+) × (\d+) \|/gm)]
    .map(m => `${m[1]} ${m[2]} ${m[3]}`).sort();
  assert.deepEqual(documented, inCode,
    'the canvas size table in docs/widgets.md is out of date');
});

/* What a widget may load is enforced by nginx and is invisible from the widget
   source, so the guide is the only place an author can learn it. */
test('the widget CSP the guide describes is the one nginx sends', () => {
  const block = nginx.slice(nginx.indexOf('location ^~ /widgets/'));
  const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(block);
  assert.ok(csp, 'the widget location no longer sets its own CSP');

  const at = doc.indexOf('### What a widget page may load');
  assert.notEqual(at, -1, 'the CSP section is gone from docs/widgets.md');
  const section = doc.slice(at, doc.indexOf('\n### ', at + 5));

  /* Anchored on the delimiter: a widened list still contains "connect-src
     'self'" as a prefix, so a loose match would pass while the guide's claim
     that Stackyard is the only reachable host had stopped being true. */
  assert.match(csp[1], /connect-src 'self';/,
    'connect-src widened; the guide says a widget can only call Stackyard');
  assert.match(section, /`connect-src` is `'self'`/);
});
