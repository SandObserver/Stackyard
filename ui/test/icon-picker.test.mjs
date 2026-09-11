/* The icon picker is a combobox over four catalogues. The parts that are easy
   to lose are the ones a pointer never exercises: the keyboard cursor, the
   announcement of how many icons were found, and the fallback when no
   catalogue has the name.

   The module owns a live DOM, so these are assertions about the source, in the
   same shape as the other tests for this file. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const form = read('js/admin-app-form.js');
const css = read('css/admin.css');
const en = JSON.parse(read('i18n/en.json'));
const LOCALES = ['en', 'de', 'es', 'fr', 'fa', 'zh-Hans'];

/* The group header above it is not tied to the field, so without this the
   placeholder is the only label and it disappears as soon as you type. */
test('the search field has a name of its own', () => {
  assert.match(form, /id="ip-in"[^>]*aria-label="\$\{t\('app\.icon'\)\}"/);
});

test('the input and the results are a combobox and its listbox', () => {
  assert.match(form, /id="ip-in"[^>]*role="combobox"/, 'the input is not a combobox');
  assert.match(form, /id="ip-in"[^>]*aria-controls="iprs"/);
  assert.match(form, /id="ip-in"[^>]*aria-autocomplete="list"/);
  assert.match(form, /id="iprs"[^>]*role="listbox"/, 'the results are not a listbox');
  assert.match(form, /id="iprs"[^>]*aria-label=/, 'the listbox has no name');
  assert.match(form, /r\.setAttribute\('role', 'option'\)/, 'the rows are not options');
});

/* A listbox with no active option and no way to say which one is active tells
   a screen reader nothing about where the cursor is. */
test('the active option is published, not only styled', () => {
  assert.match(form, /aria-activedescendant/, 'the cursor is never announced');
  assert.match(form, /r\.id = /, 'the options have no ids to point at');
  assert.match(form, /aria-selected/, 'the active option is not marked selected');
  assert.match(form, /aria-expanded/, 'the open state is not announced');
});

/* The cursor itself is nextActiveIndex, which admin-logic.test covers. What
   this file has to keep true is that the picker uses it rather than a second
   implementation that behaves differently in the same admin. */
test('the cursor is the one the admin already has', () => {
  const kd = form.slice(form.indexOf('inp.onkeydown'), form.indexOf('const upInput'));
  assert.match(kd, /nextActiveIndex\(e\.key, ipActive, ipList\.length\)/);
  assert.doesNotMatch(kd, /ArrowDown/, 'the arrows are handled twice, in two ways');
  for (const key of ['Enter', 'Escape', 'Tab']) assert.ok(kd.includes(`'${key}'`), `${key} does nothing`);
});

test('Escape closes the list without closing the form behind it', () => {
  const kd = form.slice(form.indexOf('inp.onkeydown'), form.indexOf('const upInput'));
  const esc = kd.slice(kd.indexOf("'Escape'"));
  assert.match(esc, /stopPropagation/, 'Escape reaches the dialog and closes the whole form');
});

test('the count and the empty result are announced', () => {
  assert.match(form, /role="status" aria-live="polite"/, 'nothing is announced');
  assert.match(form, /ipSay\(t\('app\.iconResultCount'/);
  assert.match(form, /ipSay\(t\('app\.iconNoMatch'/);
  assert.match(form, /ipSay\(t\('app\.iconSearchFailed'/);
  assert.match(form, /aria-describedby="ip-status"/, 'the input is not tied to the status line');
});

/* Which catalogue an icon came from decides whether it is a colour logo or a
   silhouette, so the row says. */
test('each result names its catalogue', () => {
  assert.match(form, /src\.className = 'ipr-src'/);
  assert.match(form, /t\('app\.iconFrom', \{ source: SOURCE_LABEL\[source\] \|\| source \}\)/);
  for (const id of ['di', 'selfhst', 'simple', 'lobe']) {
    assert.match(form, new RegExp(`${id}: '[^']+'`), `${id} has no readable name`);
  }
  assert.match(css, /\.ipr-src\{/, 'the source label is unstyled');
});

/* A name no catalogue lists may still be a file one of them holds, so the
   typed name stays selectable instead of the list just closing. */
test('a name nothing matched is still offered', () => {
  const branch = form.slice(form.indexOf('if (!list.length)'), form.indexOf('ipList = list;'));
  assert.match(branch, /ipRow\(0, typed, typed/, 'the typed name is not offered');
  assert.match(branch, /t\('app\.iconTryUpload'\)/, 'no hint about uploading or leaving it empty');
});

/* Storing the catalogue URL pinned the config to one CDN path and skipped the
   caching proxy on every dashboard load. */
test('a chosen icon is stored as a catalogue reference, not a URL', () => {
  const choose = form.slice(form.indexOf('function ipChoose'), form.indexOf('/* The light and dark files'));
  assert.match(choose, /setIconRef\(pick\.ref\)/);
  assert.match(form, /function setIconRef\(ref\) \{[\s\S]*?state\.siurl = ref/);
  assert.doesNotMatch(choose, /svgUrl/, 'the stored value is a CDN URL again');
});

/* A catalogue lists names it holds no file for, so the row and the stored
   value must land on a file that is really there. */
test('a name the catalogue holds no file for resolves to one of its variants', () => {
  const load = form.slice(form.indexOf('async function loadIconVariants'), form.indexOf('function wireIcon'));
  assert.match(load, /!variants\.some\(v => v\.ref === ref\)/, 'a missing base file is left selected');
  assert.match(load, /setIconRef\(variants\[0\]\.ref\)/);
  const row = form.slice(form.indexOf('function ipRow'), form.indexOf('function showIPRes'));
  assert.match(row, /variants\.flatMap\(v => v\.urls \|\| \[\]\)/, 'the row cannot fall back to a variant');
});

test('the variant control comes from the catalogue, not from a guess', () => {
  const choose = form.slice(form.indexOf('function ipChoose'), form.indexOf('function setIconRef'));
  assert.match(choose, /loadIconVariants\(pick\.ref\)/);
});

/* The variant is a design choice about the dashboard, not the admin theme, so
   it is a control and never follows prefers-color-scheme. */
test('the light and dark choice is the user’s, not the theme’s', () => {
  const vr = form.slice(form.indexOf('function renderIconVariants'), form.indexOf('async function loadIconVariants'));
  assert.match(vr, /role="group"/);
  assert.match(vr, /type="radio"/);
  assert.doesNotMatch(form, /prefers-color-scheme[^)]*\)\s*\.matches/, 'the variant follows the theme');
  assert.match(vr, /if \(!variants\.length\) return void slot\.replaceChildren\(\)/, 'one file still shows a chooser');
});

/* The list draws its own hover background only where the glide highlight is
   not available, or a pointer shows two highlights at once. */
test('the results list uses the shared highlight', () => {
  assert.match(read('js/fluid-hover.js'), /container: '#iprs', item: '\.ipr'/);
  assert.match(form, /fluidHoverKb\(act\)/, 'the keyboard cursor does not move the highlight');
  assert.match(form, /fluidHoverClear\(rs\)/, 'the highlight outlives the closed list');
  assert.match(css, /@media not \(\(hover:hover\) and \(pointer:fine\)\)\{\.ipr:hover/);
});

test('every string the picker shows is translated', () => {
  const keys = [
    'iconSearching',
    'iconNoMatch',
    'iconTryUpload',
    'iconSearchFailed',
    'iconFrom',
    'iconResults',
    'iconVariant',
    'iconVariantBase',
    'iconVariantLight',
    'iconVariantDark',
  ];
  for (const loc of LOCALES) {
    const app = JSON.parse(read(`i18n/${loc}.json`)).app;
    for (const k of keys) assert.ok(app[k], `${loc}.json is missing app.${k}`);
    assert.ok(app.iconResultCount_other, `${loc}.json is missing a plural form of the count`);
  }
  assert.ok(en.app.iconNoMatch.includes('{q}'), 'the failed query is not shown back');
});

/* The catalogue names are product names and stay in Latin in every language. */
test('the catalogue names are not translated', () => {
  const labels = form.slice(form.indexOf('const SOURCE_LABEL'), form.indexOf('const VARIANT_LABEL'));
  assert.doesNotMatch(labels, /\bt\(/, 'a catalogue name goes through translation');
});

/* The Icon group also holds the colour controls, so a list measured from the
   group opened below the sliders instead of below the field, and moved further
   down when the custom colour picker was open. */
test('the list is measured from the field, not from the panel', () => {
  const markup = form.slice(form.indexOf('<div class="grp" id="ipw">'), form.indexOf('icon-variant-slot'));
  const anchor = markup.indexOf('icon-src-anchor');
  assert.ok(anchor >= 0, 'the field row has no positioned anchor');
  assert.ok(anchor < markup.indexOf('id="iprs"'), 'the list is outside the anchor');
  assert.match(css, /\.icon-src-anchor\{position:relative\}/);
  assert.match(css, /\.iprs\{position:absolute;top:calc\(100% \+ 4px\)/);
  assert.doesNotMatch(css, /\.ipw\{/, 'the rule for the old markup is still there');
  assert.doesNotMatch(css, /\.iprs\.open\{display:block;padding/, 'the in-flow rule can still win');
});

/* Asking for a format the catalogue does not hold logs a failed request for
   every one of those icons. The catalogue's declared order arrives with the
   result, so the row does not guess. */
test('a result row asks for the format its catalogue declares', () => {
  const row = form.slice(form.indexOf('function ipRow'), form.indexOf('function showIPRes'));
  assert.doesNotMatch(row, /svgUrl|pngUrl|'\.svg'|'\.png'/, 'the row picks a format itself');
});

/* Every keystroke used to redraw the tile with the half-typed name, so typing
   "stackyard" asked the server for "st", "sta" and the rest. Each miss is
   remembered for a day in a cache of 300 entries, which evicts icons that do
   exist. */
test('a half-typed name is never requested', () => {
  const oninput = form.slice(form.indexOf('inp.oninput'), form.indexOf('inp.onkeydown'));
  const guard = oninput.slice(0, oninput.indexOf('ipMessage'));
  assert.match(guard, /updPrev\(\)/, 'the tile never redraws, not even for an address');
  const afterGuard = oninput.slice(oninput.indexOf('ipMessage'));
  assert.doesNotMatch(afterGuard, /updPrev/, 'the tile still redraws per keystroke');
});

/* An address, an upload and an empty field need no catalogue, so those still
   redraw at once. */
test('a pasted address and a local file still preview immediately', () => {
  const oninput = form.slice(form.indexOf('inp.oninput'), form.indexOf('inp.onkeydown'));
  assert.match(oninput, /resolveIcon\(v\)/, 'an uploaded file waits for a catalogue that will not list it');
  assert.match(oninput, /v\.startsWith\('https:\/\/'\)/);
});

test('the tile follows the result that matches what was typed', () => {
  const show = form.slice(form.indexOf('function showIPRes'), form.length);
  assert.match(show, /updPrev\(match\.urls\)/, 'the preview does not use the confirmed file');
  assert.match(show, /else if \(!list\.length\) updPrev\(\)/, 'an unlisted name is never tried');
  assert.match(show, /sameIconName\(/, 'the typed name is compared exactly');
});

/* With no catalogue to confirm against, the typed name is the only thing left
   to try, or the field would go quiet whenever the catalogues are down. */
test('a search that fails still previews the typed name', () => {
  const search = form.slice(form.indexOf('const search = async'), form.indexOf('inp.oninput'));
  const fail = search.slice(search.indexOf('} catch {'));
  assert.match(fail, /updPrev\(\)/);
});

/* A Latin icon name in a right-to-left locale truncates at the wrong end
   without this, and the CSS-only route does not work in WebKit. */
test('a truncated icon name reads correctly right to left', () => {
  const row = form.slice(form.indexOf('function ipRow'), form.indexOf('function showIPRes'));
  assert.match(row, /sp\.dir = 'auto'/);
  assert.match(css, /\.ipr-name\{[^}]*text-align:match-parent/);
});
