import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Vendor prefixes are hand-written here: no build step, no autoprefixer. So
   they accumulate, and nothing said which were still doing anything.

   P12-1: there were 177, of which 97 were dead at the support floor written at the top
   of tokens.css (WebKit 16.2+, current Chrome, Edge and
   Firefox). The tempting test, "does an unprefixed equivalent sit beside
   it", is wrong and would have removed -webkit-backdrop-filter, which WebKit
   needed well past 16.2 and which is paired with the unprefixed property in all
   26 places. Membership of this list is a per-property judgement, so the list is
   explicit rather than derived.

   Adding a prefix that is not here fails. If it genuinely belongs, add it with
   a reason in tokens.css and a line here. */
const ALLOWED = new Set([
  '-webkit-backdrop-filter' /* WebKit needed it well past 16.2 */,
  '-webkit-text-size-adjust' /* WebKit supports only the prefixed form */,
  '-webkit-line-clamp' /* the line-clamp idiom, with the two below */,
  '-webkit-box-orient',
  '-webkit-box' /* as a display value, not the old flexbox */,
  '-webkit-tap-highlight-color' /* WebKit-only, no standard equivalent */,
  '-webkit-touch-callout' /* WebKit-only. Stops iOS answering a press on the badge with its own callout */,
  '-webkit-font-smoothing' /* non-standard */,
  '-moz-osx-font-smoothing' /* non-standard */,
  '-webkit-appearance' /* required inside ::-webkit-slider-thumb */,
  '-webkit-slider-thumb' /* pseudo-element, no standard equivalent */,
  '-moz-range-thumb' /* the Firefox counterpart */,
  '-webkit-user-select' /* WebKit only dropped the prefix at 17 */,
]);

/* Removed by P12-1. Named so a reintroduction is reported as a regression
   rather than only as an unlisted prefix. */
const REMOVED = [
  '-webkit-flex',
  '-webkit-align-items',
  '-webkit-justify-content',
  '-webkit-flex-direction',
  '-webkit-flex-shrink',
  '-webkit-transform',
  '-webkit-transition',
  '-webkit-transition-duration',
  '-webkit-animation-duration',
  '-webkit-animation-iteration-count',
  '-webkit-overflow-scrolling',
];

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = /-(?:webkit|moz|ms|o)-[a-z-]+/g;

function styleFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'test' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...styleFiles(p));
    else if (/\.(css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const found = new Map(); /* prefix -> Set of files */
for (const f of styleFiles(uiDir)) {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(TOKEN)) {
    if (!found.has(m[0])) found.set(m[0], new Set());
    found.get(m[0]).add(path.relative(uiDir, f));
  }
}

test('the scan finds the prefixes that are supposed to still be here', () => {
  assert.ok(found.size > 5, `found only ${found.size} distinct prefixes, the scan is probably broken`);
  assert.ok(found.has('-webkit-backdrop-filter'), 'the glass effect must still be prefixed');
});

test('no vendor prefix outside the allowed list', () => {
  const unlisted = [...found.keys()]
    .filter(p => !ALLOWED.has(p))
    .sort()
    .map(p => `${p} (${[...found.get(p)].join(', ')})`);
  assert.deepEqual(
    unlisted,
    [],
    `Unlisted vendor prefix. See the support floor at the top of ui/css/tokens.css; add it there with a reason if it is needed:\n${unlisted.join('\n')}`,
  );
});

test('the prefixes P12-1 removed have not come back', () => {
  const back = REMOVED.filter(p => found.has(p) && !ALLOWED.has(p));
  assert.deepEqual(back, [], `Removed as dead at the stated support floor: ${back.join(', ')}`);
});

/* -webkit-box is allowed only as the display value the line-clamp idiom needs.
   The old flexbox spec used the same token, so allowing it by name alone would
   quietly readmit `display:-webkit-box` as a flex container. */
test('-webkit-box appears only alongside line clamping', () => {
  for (const f of styleFiles(uiDir)) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of src.split(/[{}]/)) {
      if (!/display\s*:\s*-webkit-box\b/.test(block)) continue;
      assert.match(
        block,
        /-webkit-line-clamp/,
        `display:-webkit-box without -webkit-line-clamp in ${path.relative(uiDir, f)}: that is the old flexbox spec, not the clamp idiom`,
      );
    }
  }
});
