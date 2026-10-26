/* Settings on a touch screen: no hover state left behind by a tap, a press
   state of its own, no grey tap flash, no zoom on focus, and no capitals in an
   address. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/admin.css').replace(/\/\*[\s\S]*?\*\//g, '');
const FINE = '@media (hover:hover) and (pointer:fine){';

/* Each rule whose selector holds :hover, with the at-rules around it. */
function hoverRules(src) {
  const out = [];
  const stack = [];
  let prelude = '';
  for (const ch of src) {
    if (ch === '{') {
      const p = prelude.trim();
      if (!p.startsWith('@') && p.includes(':hover')) out.push({ sel: p, within: [...stack] });
      stack.push(p);
      prelude = '';
    } else if (ch === '}') {
      stack.pop();
      prelude = '';
    } else if (ch === ';' && !stack.length) prelude = '';
    else prelude += ch;
  }
  return out.map(r => ({
    sel: r.sel,
    inside: r.within.includes(FINE.slice(0, -1)),
    touchOnly: r.within.some(w => w.startsWith('@media not ((hover:hover)')),
  }));
}

test('the scan tells a gated hover from a bare one', () => {
  const sample = `.a:hover{x:1}${FINE}.b:hover{x:1}}.c{y:1}${FINE}.d:hover,.d.on{x:1}}.e:hover{x:1}`;
  assert.deepEqual(
    hoverRules(sample).map(r => [r.sel, r.inside]),
    [
      ['.a:hover', false],
      ['.b:hover', true],
      ['.d:hover,.d.on', true],
      ['.e:hover', false],
    ],
  );
});

test('every hover rule in Settings needs a fine pointer', () => {
  const rules = hoverRules(css);
  assert.ok(rules.length >= 20, `found only ${rules.length} hover rules, the scan is probably broken`);
  const bare = rules.filter(r => !r.inside && !r.touchOnly).map(r => r.sel);
  assert.deepEqual(bare, [], 'a tap leaves this hover state on until the next tap elsewhere');
});

test('a selected or keyboard state is not tied to the hover gate', () => {
  assert.match(css, /(^|\n)\.nl\.active \.ni\{color:var\(--ac\)\}/);
  assert.match(css, /(^|\n)\.row-dd-list li\.kb-active\{background:var\(--ov-strong\)\}/);
  assert.match(css, /(^|\n)\.tile-opt\.on\{color:var\(--tx\)\}/);
  assert.match(css, /(^|\n)\.nl\.active \.sy-icon,\.mtab\.active \.sy-icon,\.tile-opt\.on \.sy-icon\{/);
});

test('rows, pencils, pickers and tabs press differently from how they hover', () => {
  assert.match(css, /\.nl:not\(\.active\):active\{background:var\(--fill-tertiary\)\}/);
  assert.match(css, /\.row-link:active\{background:var\(--fill-tertiary\)\}/);
  assert.match(css, /\.pe:active\{[^}]*background:var\(--fill-tertiary\)/);
  assert.match(css, /\.row-dd-btn:active\{opacity:\.55\}/);
  assert.match(css, /html\.is-mobile \.mtab:not\(\.active\):active\{background:var\(--fill-tertiary\)\}/);
});

/* Each rule as { sels, body }, at any depth. */
function cssRules(src) {
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
    sels: m[1]
      .split(',')
      .map(x => x.trim())
      .filter(Boolean),
    body: m[2],
  }));
}

/* `.chip:active` and `.row-btn:active:not(:disabled)` press .chip and .row-btn.
   `.chip-x:active` and `.chip .x:active` do not. */
function pressRuleFor(all, sel) {
  return all.some(r =>
    r.sels.some(it => {
      if (!it.startsWith(sel)) return false;
      const rest = it.slice(sel.length);
      const at = rest.indexOf(':active');
      return at >= 0 && /^[.:[]/.test(rest) && !/[\s>+~]/.test(rest.slice(0, at));
    }),
  );
}

/* The tap highlight is off, so a control without a press state shows nothing
   under a finger. */
test('every control a finger can press has a press state', () => {
  const all = cssRules(css);
  const exempt = new Set([
    /* The thumb moves under the finger. */
    '.adm-range',
    '.hsb-range',
    /* The tap opens the field in place. */
    '.ie-row .rv',
    /* Only ever on a .btn. */
    '.cursor-ptr',
  ]);
  const pressable = new Set(['.sb-brand', '.upd-link']);
  for (const r of all) {
    if (!/cursor:\s*pointer/.test(r.body)) continue;
    for (const sel of r.sels) if (!sel.includes('::') && !exempt.has(sel)) pressable.add(sel);
  }
  assert.ok(pressable.size >= 30, `found only ${pressable.size} controls, the scan is probably broken`);
  const missing = [...pressable].filter(sel => !pressRuleFor(all, sel));
  assert.deepEqual(missing, [], 'no press state under a finger');
  const recovery = cssRules(read('css/config-recovery.css').replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.ok(pressRuleFor(recovery, '.cfg-recovery-btn'), '.cfg-recovery-btn has no press state');
});

test('the press scan tells a control of its own from a descendant', () => {
  const all = cssRules('.a:active{x:1}.b .c:active{x:1}.d:active:not(:disabled){x:1}.e-f:active{x:1}.g:active h{x:1}');
  assert.equal(pressRuleFor(all, '.a'), true);
  assert.equal(pressRuleFor(all, '.b'), false);
  assert.equal(pressRuleFor(all, '.d'), true);
  assert.equal(pressRuleFor(all, '.e'), false);
  assert.equal(pressRuleFor(all, '.g'), true);
});

test('the tap highlight is cleared once, on the document', () => {
  assert.match(css, /(^|\n)html\{[^}]*-webkit-tap-highlight-color:transparent/);
  assert.equal(css.match(/-webkit-tap-highlight-color/g).length, 1, 'it inherits; a second copy is redundant');
});

test('the header fields are body size on a phone, so focusing one does not zoom', () => {
  assert.match(css, /html\.is-mobile \.kv-k,html\.is-mobile \.kv-v\{font-size:var\(--fs-body\)/);
});

test('a long title wraps and the header buttons keep their size', () => {
  assert.match(css, /(^|\n)\.sec-title\{[^}]*min-width:0;overflow-wrap:anywhere/);
  assert.match(css, /(^|\n)\.sec-hdr-actions\{[^}]*flex-shrink:0/);
});

test('an address in the list keeps its scheme and host in a right-to-left page', () => {
  assert.match(read('js/admin-list.js'), /mt\.textContent = item\.href;\s*mt\.classList\.add\('rmt-url'\)/);
  assert.match(css, /\.rmt-url\{direction:ltr;unicode-bidi:isolate;align-self:flex-start;max-width:100%\}/);
});

/* iOS capitalises the first letter. A capitalised username fails to log in. */
test('address, host, username and header fields take no capitals or correction', () => {
  const shared = read('js/admin-shared.js');
  assert.match(shared, /setAttribute\('autocapitalize', 'none'\)/);
  assert.match(shared, /setAttribute\('autocorrect', 'off'\)/);
  assert.match(shared, /spellcheck = false/);
  assert.match(shared, /if \(plain\) plainInput\(inp\)/);
  const wired = {
    'js/admin.js': ['srv-ip', 'srv-socket', 'srv-pve-url', 'srv-pve-token', 'srv-hosts', 'bg-col-inp', 'bg-url-inp'],
    'js/admin-app-form.js': ['f-href', 'hc-con', 'hc-ping', 'f-burl', 'f-buser'],
    'js/admin-widget-form.js': ['f-url', 'if-allow'],
  };
  for (const [file, ids] of Object.entries(wired)) {
    const src = read(file);
    for (const id of ids) {
      const at = src.indexOf(`'${id}', {`);
      assert.ok(at >= 0, `${id} is not wired in ${file}`);
      const call = src.slice(at, src.indexOf('});', at));
      assert.match(call, /plain: true/, `${id} in ${file} still capitalises`);
    }
  }
  const form = read('js/admin-app-form.js');
  for (const cls of ['kv-k', 'kv-v', 'icon-srch']) {
    const tag = form.match(new RegExp(`<input class="${cls}"[^>]*>`));
    assert.ok(tag, `${cls} is not built`);
    assert.match(tag[0], /autocapitalize="none" autocorrect="off" spellcheck="false"/, cls);
  }
  assert.match(read('js/widget-config-form.js'), /plain: isPlainField\(field\)/);
});

test('a touch drag moves its copy by transform and settles it on release', () => {
  const drag = read('js/admin-drag.js');
  const place = drag.slice(drag.indexOf('const place = (x, y) => {'), drag.indexOf('const SCROLL_PX_PER_MS'));
  assert.match(place, /ghost\.style\.transform = `translateY\(/);
  assert.doesNotMatch(place, /style\.top/, 'a top write forces a layout on every move');
  assert.match(drag, /if \(!pastLiftSlop\(ev\.clientX - x0, ev\.clientY - y0\)\) return;/);
  assert.match(drag, /transition = 'transform var\(--t-reveal\) var\(--ease-reveal\)/);
  assert.match(drag, /prefers-reduced-motion: reduce\)'\)\.matches\) \{\s*ghost\.remove\(\);/);
  assert.match(drag, /timer = setTimeout\(done, 400\)/, 'without it a dropped transition strands the copy');
  assert.match(
    drag,
    /if \(moved \|\| held\) _redraw\(\);\s*if \(!ghost\) return;\s*settle\(ghost, startRect, rowOf\(srcId\)\);/,
  );
});

test('a folder chevron turns from its old angle after the list is rebuilt', () => {
  const list = read('js/admin-list.js');
  assert.match(
    list,
    /render\(\);\s*turnFrom\(document\.getElementById\('chev-' \+ item\.id\), chevron\.style\.transform\);/,
  );
  assert.match(
    list,
    /chevron\.style\.transform = from;\s*void chevron\.offsetWidth;\s*chevron\.style\.transform = to;/,
  );
});
