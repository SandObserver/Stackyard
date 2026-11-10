import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/dashboard.css').replace(/\/\*[\s\S]*?\*\//g, '');
const dashboard = read('js/dashboard.js');
const ui = read('js/ui.js');
const spotlight = read('js/spotlight.js');
const popover = read('js/badge-popover.js');
const labels = read('js/label-contrast.js');

const rule = selector => {
  const at = css.indexOf(selector);
  assert.ok(at > -1, `${selector} is not declared`);
  return css.slice(at, css.indexOf('}', at));
};

test('a layout build leaves the Search pill alone and marks the restored page', () => {
  assert.match(dashboard, /function goTo\(n, dotEls, announce = true, bump = true\)/);
  assert.match(dashboard, /if \(MOB && bump && CB\.mobPillBump\) CB\.mobPillBump\(pg\);/);
  assert.match(
    dashboard,
    /syncMobPages\(\);\s*goTo\(restorePage\(storeGet\(PAGE_STORE\), totalPages\), null, false, false\);\s*CB\.mobPillSync\?\.\(pg\);/,
  );
});

test('the pill stays on Search on a one-page dashboard', () => {
  assert.match(ui, /function pillBump\(newPg\) \{\s*if \(pillNewDots\.children\.length < 2\) return;/);
});

test('the desktop build stops the mobile pill sync', () => {
  const reset = ui.slice(ui.indexOf('export function resetMobileChrome('));
  assert.match(reset, /CB\(\)\.mobPillSync = null;/);
});

test('a config change does not reload over Search, a folder or a swipe', () => {
  assert.match(
    dashboard,
    /if \(differs\(await res\.json\(\)\) && !overlayOpen\(\) && !strip\.classList\.contains\('dragging'\)\) location\.reload\(\);/,
  );
  assert.match(dashboard, /const overlayOpen = \(\) =>\s*el\('spot'\)\.hasAttribute\('open'\)/);
});

test('a returning tab polls the config at once', () => {
  assert.match(dashboard, /pollBadges\(\);\s*pollHealth\(\);\s*pollConfig\(\);\s*startPolling\(\);/);
});

test('a mouse drag inside an open overlay turns no page', () => {
  assert.match(
    dashboard,
    /addEventListener\('mouseup', e => \{\s*if \(overlayOpen\(\)\) \{\s*_dDragging = false;\s*return;/,
  );
});

test('typing inside an open folder does not open Search over it', () => {
  assert.match(
    spotlight,
    /e => \{\s*if \(document\.querySelector\('dialog\[open\]:not\(#spot\)'\)\) return;\s*if \(ov\.open/,
  );
});

test('a folder tile uses the shared tap handling and can show its press', () => {
  const tile = ui.slice(ui.indexOf('function mFolder('), ui.indexOf('let folderOverlayMob'));
  assert.match(tile, /onTap\(a, _openFolder\);/);
  assert.doesNotMatch(tile, /preventDefault/);
});

test('only keyboard focus opens the badge popover', () => {
  assert.match(
    popover,
    /tile\.addEventListener\('focus', \(\) => \{\s*if \(tile\.matches\(':focus-visible'\)\) open\(badge\);/,
  );
});

test('a folder fades out late on an ease-out curve', () => {
  const motion = ui.slice(ui.indexOf('function folderMotion('), ui.indexOf('let folderOverlay = null;'));
  assert.match(motion, /\{ duration: 160, delay: 90, easing: 'ease-out' \}/);
  assert.doesNotMatch(motion, /cubic-bezier\(\.6,0,1,1\)/);
  assert.match(motion, /timing\('opacity', false\), fill: 'both'/, 'the panel would be see-through during the delay');
});

test('the phone folder title cannot leave the top edge', () => {
  assert.match(ui, /top: 'max\(var\(--sa-top\), ' \+ \(boxTop - titleRendH/);
});

test('the Search pill keeps a readable label on a small phone', () => {
  assert.match(css, /#mob-search-pill \.msp-label \{\s*font-size:max\(11px, calc\(12px \* var\(--sc,1\)\)\)/);
  assert.match(ui, /const pillSearchW = Math\.max\(Math\.round\(96 \* sc\), 92\);/);
});

test('the Search pill is toned from the wallpaper in the dark theme', () => {
  assert.match(labels, /const LABEL_SELECTOR =[^;]*#mob-search-pill/);
  assert.match(
    css,
    /html:not\(\[data-theme="light"\]\) #mob-search-pill\[data-tone="dark"\] \{[^}]*rgba\(255,255,255,\.72\)/,
  );
});

test('a search address is isolated from a right-to-left page', () => {
  assert.match(spotlight, /setUserText\(ht, \(app\.href \|\| ''\)/);
  assert.doesNotMatch(spotlight, /a\.style\.cssText =\s*'[^']*padding/, 'an inline padding hides the phone row size');
  assert.match(css, /\n\s*\.sr \{[^}]*gap:18px; padding:14px 20px/);
});

test('focus adds a ring and leaves the control shape alone', () => {
  const generic = css.slice(css.indexOf('a:focus-visible, button:focus-visible'), css.indexOf('#sin:focus-visible'));
  const first = generic.slice(0, generic.indexOf('}'));
  assert.doesNotMatch(first, /border-radius/);
  assert.match(generic, /\.folder-icon-link\):focus-visible \{ border-radius:8px; \}/);
});

test('the ring carries a dark line that reads on a bright wallpaper', () => {
  assert.match(css, /\.dot, [^{]*\):focus-visible \{\s*outline-offset:2px; box-shadow:0 0 0 2px rgba\(0,0,0,\.72\);/);
});

test('the contrast setting keeps the page dots hollow against filled', () => {
  const block = css.slice(css.indexOf('@media (prefers-contrast: more)'));
  assert.match(block, /\.dot \{ border-width:2px; \}/);
  assert.doesNotMatch(block.slice(0, block.indexOf('forced-colors')), /\.dot \{ background/);
});

test('folder dots are hollow against filled', () => {
  assert.match(rule('.folder-dot {'), /background:transparent; box-shadow:inset 0 0 0 1\.5px/);
  assert.match(css, /\.folder-dot\.on \{[^}]*box-shadow:none/);
});

test('the controls without a press state now have one', () => {
  assert.match(css, /#spot-cancel:active \{ opacity:\.6;/);
  assert.match(
    css,
    /:is\(\.empty-state-btn, \.api-error-btn, \.setup-btn\):not\(:disabled\):active \{ transform: scale\(\.97\)/,
  );
  assert.match(css, /\.dot:active \{ opacity:\.7; transition-duration:\.1s \}/);
});

test('reduced motion drops the press scale', () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*:is\(\.empty-state-btn, \.api-error-btn, \.setup-btn\):not\(:disabled\):active \{ transform: none; opacity: \.7;/,
  );
  assert.match(css, /\.dot\.on \{ transform: none !important; \}/);
});

test('hover effects need a real pointer', () => {
  assert.doesNotMatch(css, /@media \(hover:hover\) \{/);
  for (const sel of ['.sr:hover', '#photo-credit a:hover', '.empty-state-hint:hover', '.setup-reveal:hover']) {
    const at = css.indexOf(sel);
    assert.ok(at > -1, sel);
    assert.ok(css.slice(css.lastIndexOf('@media', at), at).startsWith('@media (hover:hover) and (pointer:fine)'), sel);
  }
  assert.match(css, /\.sr:active, \.sr\.sel \{/, 'a press must not depend on hover');
});

test('a held tile is neither selected nor previewed', () => {
  assert.match(css, /\.dyn-dock-icon\) \{ -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; \}/);
});

test('the setup prompt scrolls and its reveal button is full size', () => {
  assert.match(rule('.setup-prompt {'), /align-items: safe center;[^;]*;\s*overflow-y: auto|overflow-y: auto/);
  assert.match(rule('.setup-reveal {'), /width: 44px; height: 44px/);
  assert.match(css, /\.setup-field \.setup-pw \{ padding-inline-end: 52px; \}/);
});

test('the error pill never shows a link underline', () => {
  assert.match(rule('.api-error-btn   {'), /text-decoration: none/);
});

test('a badge value is clipped inside its pill', () => {
  assert.match(rule('.badge-txt {'), /min-width:0; overflow:hidden; text-overflow:ellipsis/);
});

test('the search arrow mirrors in a right-to-left page', () => {
  assert.match(css, /\.sra:dir\(rtl\) \{ transform:scaleX\(-1\) \}/);
});

test('an opaque translucent card only blurs when it is see-through', () => {
  const contrast = css.slice(css.indexOf('@media (prefers-contrast: more)'));
  assert.doesNotMatch(rule('.widget[data-card="translucent"],'), /backdrop-filter/);
  assert.match(
    contrast,
    /\.mob-widget-card\[data-card="translucent"\] \{\s*background:rgba\(0,0,0,\.62\);\s*-webkit-backdrop-filter:blur\(22px\)/,
  );
});

test('reduced transparency gets solid surfaces after the theme rules', () => {
  const at = css.lastIndexOf('@media (prefers-reduced-transparency: reduce)');
  assert.ok(
    at > css.indexOf('html[data-theme="light"] #spot { background:rgba(242,242,247,.9)'),
    'the light theme would win',
  );
  const block = css.slice(at);
  assert.match(block, /:root \{ --glass-surface-blur: none; --glass-surface-bg:rgba\(44,44,46,\.94\); \}/);
  assert.match(block, /html\[data-theme="light"\] #mob-search-pill \{ background:rgba\(255,255,255,\.94\); \}/);
});

test('no blur is stacked on a blurred parent, and the phone search blur is halved', () => {
  assert.doesNotMatch(rule('body:not(.is-mob) #sbox {'), /backdrop-filter/);
  assert.doesNotMatch(rule('body:not(.is-mob) #sres {'), /backdrop-filter/);
  assert.match(
    css,
    /:is\(\.folder-overlay, \.folder-overlay-mobile\) \.glass-surface \{ -webkit-backdrop-filter:none; backdrop-filter:none \}/,
  );
  assert.doesNotMatch(css, /blur\(40px\)/);
});

test('the tap highlight and the double-tap wait are off for the whole shell', () => {
  assert.match(rule('html {'), /-webkit-tap-highlight-color:transparent/);
  assert.match(
    css,
    /:is\(#dock, #dots, #mob-search-pill, #spot, \.folder-overlay, \.folder-overlay-mobile\) \{ touch-action:manipulation; \}/,
  );
});

test('each page is contained, and never skipped from drawing', () => {
  assert.match(rule('.page {'), /contain:layout paint/);
  assert.match(rule('.mob-page {'), /contain:layout paint/);
  assert.doesNotMatch(css, /content-visibility/);
});
