/* Every control the settings page ships has to say what it is.

   aria-label is prohibited on an element with no role, so a name written on a
   label wrapping a bare checkbox is discarded and the control reaches a screen
   reader as "checkbox, not checked".

   Point at the visible label with aria-labelledby. The catalog already
   translates it, so the control stays in step with the language. A second
   aria-label is a second string to translate and a second one to forget. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const admin = read('admin/index.html');

const { uniqueTitle } = await import('../js/widget-types.js');

/* ── the toggles ──────────────────────────────────────────────────────────── */

const TOGGLES = [...admin.matchAll(/<label class="tog"[^>]*>\s*<input type="checkbox"([^>]*)>/g)].map(m => m[1]);

test('every toggle is found', () => {
  assert.equal(TOGGLES.length, 9, 'the toggle markup changed shape');
});

test('every toggle is named by the row label beside it', () => {
  const unnamed = [];
  for (const attrs of TOGGLES) {
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1] || '(no id)';
    const points = /\baria-labelledby="([^"]+)"/.exec(attrs)?.[1];
    if (!points) {
      unnamed.push(`${id} has no aria-labelledby`);
      continue;
    }
    const target = new RegExp(`<span class="rl" id="${points}"([^>]*)>`).exec(admin);
    if (!target) unnamed.push(`${id} points at ${points}, which is not a row label`);
    else if (!/data-i18n="/.test(target[1])) unnamed.push(`${id} is named by an untranslated label`);
  }
  assert.deepEqual(unnamed, [], `Toggles a screen reader cannot name:\n  ${unnamed.join('\n  ')}`);
});

/* aria-label on an element with no role is discarded, so a name written there
   is not a name at all. */
test('no toggle carries its name on the label element', () => {
  assert.doesNotMatch(admin, /<label class="tog" aria-label=/);
});

/* ── the inline-edit fields ───────────────────────────────────────────────── */

const shared = read('js/admin-shared.js');

test('an inline-edit field is named by its row label', () => {
  const fn = shared.slice(shared.indexOf('export function initInlineEdit'));
  assert.match(fn, /q\('\.rl', row\)/, 'the row label is what carries the translated name');
  assert.match(fn, /setAttribute\('aria-labelledby'/);
});

/* This runs at module load, before the catalog is fetched, so a placeholder
   read then is the key rather than its translation. */
test('an inline-edit placeholder is read when it is used, not when it is wired', () => {
  const fn = shared.slice(shared.indexOf('export function initInlineEdit'));
  assert.match(fn, /typeof placeholder === 'function' \? placeholder\(\)/);
  assert.doesNotMatch(fn, /inp\.placeholder = placeholder;/);
});

test('the password placeholder is read when the row opens, after the catalog loads', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    const { initPasswordRows } = await import('../js/admin-settings-controls.js');
    const { initI18n, t } = await import('../js/i18n.js');
    initPasswordRows();
    await initI18n('en');
    dom.document.querySelector('#ie-pw .pe').click();
    const field = dom.document.getElementById('sec-pw');
    assert.equal(field.placeholder, t('general.passwordPh'));
    assert.notEqual(field.placeholder, 'general.passwordPh');
  } finally {
    dom.restore();
  }
});

/* ── the import dialog ────────────────────────────────────────────────────── */

test('every import dialog section title is a heading under the dialog title', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody, settle } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    await (await import('../js/i18n.js')).initI18n('en');
    const { reviewImport } = await import('../js/admin-transfer.js');
    const items = [
      { id: 'a', type: 'app', label: 'A', href: 'https://a.local', skipTlsVerify: true },
      { id: 'f', type: 'folder', label: 'F', children: ['a'] },
    ];
    const answer = reviewImport(
      items,
      [{ name: 'B', group: 'G', reason: 'no-href' }],
      [{ name: 'A', group: '', code: 'icon-dropped' }],
      'toast.importForeignNothing',
    );
    await settle();
    const dlg = dom.document.querySelector('dialog.dlg-box');
    assert.equal(dlg.querySelector('h2')?.tagName, 'H2', 'the dialog has no title heading');
    const sections = dlg.querySelectorAll('.dlg-sec');
    assert.equal(sections.length, 5, 'add, create, changed, not imported and self-signed');
    for (const h of sections) assert.equal(h.tagName, 'H3', h.textContent);
    dlg
      .querySelectorAll('button')
      .find(b => b.textContent === 'Cancel')
      .click();
    dlg.dispatchEvent({ type: 'animationend' });
    await answer;
  } finally {
    dom.restore();
  }
});

/* ── widget frame names ───────────────────────────────────────────────────── */

/* Two widgets of one type share a manifest label, and the frame list then holds
   several entries with one name and no way to tell them apart. */
test('a repeated title is numbered from the second one', () => {
  const used = new Set();
  assert.equal(uniqueTitle('Clock', used), 'Clock');
  assert.equal(uniqueTitle('Clock', used), 'Clock 2');
  assert.equal(uniqueTitle('Clock', used), 'Clock 3');
});

test('a title that is already distinct is left alone', () => {
  const used = new Set();
  assert.equal(uniqueTitle('Clock', used), 'Clock');
  assert.equal(uniqueTitle('Weather', used), 'Weather');
});

/* The numbered form is itself a title someone can have typed. */
test('a numbered title does not collide with a generated one', () => {
  const used = new Set();
  assert.equal(uniqueTitle('Clock', used), 'Clock');
  assert.equal(uniqueTitle('Clock 2', used), 'Clock 2');
  assert.equal(uniqueTitle('Clock', used), 'Clock 3');
});

test('both dashboard builders number their frames', () => {
  for (const f of ['js/dashboard.js', 'js/ui.js']) {
    assert.match(read(f), /uniqueTitle\(/, `${f} builds widget frames without numbering them`);
  }
});

/* ── The top-right control is gone, not hidden ────────────────────────────── */

/* Its container was cleared unconditionally on every build, so it rendered
   nothing while four rules, a focus entry, a coarse-pointer size, an
   increased-contrast variant and an icon file were kept for it. */

const dashCss2 = read('css/dashboard.css');

test('no styling is kept for a control that is not drawn', () => {
  assert.doesNotMatch(dashCss2, /\.ctrl\b/, 'dead rules for the removed control');
  assert.doesNotMatch(dashCss2, /#ctrls\b/, 'the container rule outlived the container');
});

test('the markup and its clearing are gone too', () => {
  assert.doesNotMatch(read('index.html'), /id="ctrls"/);
  assert.doesNotMatch(read('js/dashboard.js'), /el\('ctrls'\)/);
});

/* Deleting styles is only safe if nothing references the class. */
test('nothing references the control any more', () => {
  for (const f of ['js/dashboard.js', 'js/ui.js', 'js/spotlight.js', 'index.html']) {
    assert.doesNotMatch(read(f), /\bctrls?\b(?!-)/, `${f} still names the control`);
  }
});

/* ── The internal result does not claim to leave the site ─────────────────── */

const spot = read('js/spotlight.js');

test('a system result opens here, with no leaves-the-site arrow', () => {
  assert.match(spot, /app\.system === 'settings'/, 'nothing distinguishes the internal destination');
  assert.match(spot, /target: isInternal \? '_self' : '_blank'/);
  assert.match(spot, /if \(!isInternal\) \{[\s\S]{0,200}'↗'/, 'the arrow is drawn for every result');
});

test('a system result navigates rather than opening a tab', () => {
  assert.match(spot, /app\.system === 'settings' && app\.href[\s\S]{0,80}window\.location\.href = app\.href/);
});
