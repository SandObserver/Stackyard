/* The icon picker is a combobox over four catalogues. The parts that are easy
   to lose are the ones a pointer never exercises: the keyboard cursor, the
   announcement of how many icons were found, and the fallback when no
   catalogue has the name. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { catalogRoutes, fakeFetch, fire, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/admin.css');
const en = JSON.parse(read('i18n/en.json'));
const LOCALES = (await import('../js/i18n.js')).LANGUAGES.map(l => l.code);

const PLEX = { ref: 'plex', name: 'plex', source: 'di', urls: ['https://cdn.example/di/plex.webp'] };
const SPRING = {
  ref: 'si:springboot',
  name: 'Spring Boot',
  source: 'simple',
  urls: ['https://cdn.example/si/springboot.svg'],
};
const search = {
  '/api/icons/search?q=pl': { results: [PLEX, SPRING] },
  '/api/icons/search?q=plex': { results: [PLEX, SPRING] },
  '/api/icons/search?q=spring%20boot': { results: [SPRING] },
  '/api/icons/search?q=myapp': { results: [] },
  '/api/icons/search?q=down': { status: 502, body: { error: 'down' } },
  '/api/icons/search?q=demo': { status: 400, body: { error: 'demo', code: 'blocked.demo' } },
  '/api/icons/variants?ref=plex': {
    variants: [
      { key: 'light', ref: 'plex-light', urls: [] },
      { key: 'dark', ref: 'plex-dark', urls: [] },
    ],
  },
  '/api/icons/variants?ref=si%3Aspringboot': { variants: [] },
};
const fetch = fakeFetch({ ...catalogRoutes(), '/api/icons/local': [], ...search });
const dom = installDom({ markup: pageBody('admin/index.html'), fetch });
const { document } = dom;
globalThis.Element.prototype.scrollIntoView = () => {};
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { state } = await import('../js/admin-state.js');
const { buildAppForm } = await import('../js/admin-app-form.js');

/** A fresh app form. */
function form(iconUrl = '') {
  state.items = [];
  state.siurl = iconUrl;
  state.scol = '';
  const body = document.createElement('div');
  document.body.appendChild(body);
  buildAppForm(body, null);
  return {
    body,
    inp: document.getElementById('ip-in'),
    rs: document.getElementById('iprs'),
    status: document.getElementById('ip-status'),
    prev: document.getElementById('ipv'),
    rows: () => document.getElementById('iprs').querySelectorAll('.ipr'),
    done() {
      body.remove();
    },
  };
}

/** Type into the field and wait for the search. */
async function type(f, value, wait = 340) {
  f.inp.value = value;
  fire(f.inp, 'input');
  if (wait) await settle(wait);
}
const searches = () => fetch.calls.filter(c => c.url.startsWith('/api/icons/search')).map(c => c.url);

test('the search field is a named combobox tied to its results and its status line', () => {
  const f = form();
  assert.equal(f.inp.getAttribute('aria-label'), t('app.icon'), 'the placeholder is the only label');
  assert.equal(f.inp.getAttribute('role'), 'combobox');
  assert.equal(f.inp.getAttribute('aria-controls'), 'iprs');
  assert.equal(f.inp.getAttribute('aria-autocomplete'), 'list');
  assert.equal(f.inp.getAttribute('aria-describedby'), 'ip-status');
  assert.equal(f.rs.getAttribute('role'), 'listbox');
  assert.ok(f.rs.getAttribute('aria-label'), 'the listbox has no name');
  assert.equal(f.status.getAttribute('role'), 'status');
  assert.equal(f.status.getAttribute('aria-live'), 'polite');
  f.done();
});

/* Each miss is remembered for a day in a cache of 300 entries. */
test('a half-typed name is never requested, and the results are announced', async () => {
  const f = form();
  const before = searches().length;
  const glyph = f.prev.firstChild;
  for (const v of ['p', 'pl', 'ple']) await type(f, v, 0);
  assert.equal(f.prev.firstChild, glyph, 'the tile redraws per keystroke');
  await type(f, 'plex');
  assert.deepEqual(searches().slice(before), ['/api/icons/search?q=plex']);
  assert.equal(f.inp.getAttribute('aria-expanded'), 'true');
  assert.equal(f.status.textContent, t('app.iconResultCount', { count: 2 }));
  const rows = f.rows();
  assert.deepEqual(
    rows.map(r => [r.id, r.getAttribute('role'), r.getAttribute('aria-selected')]),
    [
      ['ipr-0', 'option', 'false'],
      ['ipr-1', 'option', 'false'],
    ],
  );
  f.done();
});

test('each result names its catalogue, reads in its own direction and loads the declared file', async () => {
  const f = form();
  await type(f, 'pl');
  const [plex, spring] = f.rows();
  assert.equal(spring.querySelector('.ipr-src').textContent, t('app.iconFrom', { source: 'simple-icons' }));
  assert.equal(plex.querySelector('.ipr-src').textContent, t('app.iconFrom', { source: 'dashboardicons' }));
  assert.equal(plex.querySelector('.ipr-name').dir, 'auto');
  assert.equal(plex.querySelector('img').src, PLEX.urls[0], 'the row picks a format itself');
  f.done();
});

/* nextActiveIndex also answers Home and End. Focus here is in a text field,
   where they move the caret. */
test('the arrows move a published cursor, and Home, End and an input method are left alone', async () => {
  const f = form();
  await type(f, 'pl');
  assert.equal(fire(f.inp, 'keydown', { key: 'ArrowDown' }), false);
  assert.equal(f.inp.getAttribute('aria-activedescendant'), 'ipr-0', 'the cursor is never announced');
  assert.deepEqual(
    f.rows().map(r => r.getAttribute('aria-selected')),
    ['true', 'false'],
  );
  fire(f.inp, 'keydown', { key: 'ArrowDown' });
  fire(f.inp, 'keydown', { key: 'ArrowDown' });
  assert.equal(f.inp.getAttribute('aria-activedescendant'), 'ipr-1');
  for (const key of ['Home', 'End']) assert.equal(fire(f.inp, 'keydown', { key }), true, `${key} is intercepted`);
  assert.equal(f.inp.getAttribute('aria-activedescendant'), 'ipr-1');
  fire(f.inp, 'keydown', { key: 'ArrowUp', isComposing: true });
  fire(f.inp, 'keydown', { key: 'ArrowUp', keyCode: 229 });
  assert.equal(f.inp.getAttribute('aria-activedescendant'), 'ipr-1', 'a key for the input method moved the cursor');
  f.done();
});

test('Escape closes the list without closing the form behind it, and Tab closes it too', async () => {
  const f = form();
  await type(f, 'pl');
  let reached = false;
  f.body.addEventListener('keydown', () => {
    reached = true;
  });
  fire(f.inp, 'keydown', { key: 'Escape' });
  assert.equal(reached, false, 'Escape reaches the dialog and closes the whole form');
  assert.equal(f.inp.getAttribute('aria-expanded'), 'false');
  assert.equal(f.rs.classList.contains('open'), false);
  await type(f, 'plex');
  fire(f.inp, 'keydown', { key: 'Tab' });
  assert.equal(f.inp.getAttribute('aria-expanded'), 'false');
  f.done();
});

/* Enter acts on the cursor. */
test('the pointer moves the whole cursor, and Enter stores a catalogue reference', async () => {
  const f = form();
  await type(f, 'pl');
  fire(f.rows()[1], 'pointerenter', { bubbles: false });
  assert.equal(f.inp.getAttribute('aria-activedescendant'), 'ipr-1');
  assert.deepEqual(
    f.rows().map(r => r.getAttribute('aria-selected')),
    ['false', 'true'],
    'the pointer sets the index behind the markers',
  );
  fire(f.inp, 'keydown', { key: 'Enter' });
  assert.equal(state.siurl, SPRING.ref, 'the stored value is not the catalogue reference');
  assert.equal(f.inp.value, SPRING.ref);
  assert.equal(f.inp.getAttribute('aria-expanded'), 'false');
  f.done();
});

/* A catalogue lists names it holds no file for. */
test('a chosen name with no file of its own lands on a variant, and the user picks light or dark', async () => {
  const f = form();
  await type(f, 'pl');
  f.rows()[0].click();
  await settle();
  assert.ok(
    fetch.calls.some(c => c.url === '/api/icons/variants?ref=plex'),
    'the variants are guessed',
  );
  assert.equal(state.siurl, 'plex-light', 'a missing base file is left selected');
  const group = document.querySelector('#icon-variant-slot [role="group"]');
  assert.ok(group, 'no chooser for the variants');
  const radios = group.querySelectorAll('input[type="radio"]');
  assert.deepEqual(
    radios.map(r => r.value),
    ['plex-light', 'plex-dark'],
  );
  radios[1].checked = true;
  fire(radios[1], 'change');
  assert.equal(state.siurl, 'plex-dark');
  await type(f, 'spring boot');
  f.rows()[0].click();
  await settle();
  assert.equal(document.querySelector('#icon-variant-slot').children.length, 0, 'one file still shows a chooser');
  f.done();
});

test('a name nothing matched is still offered, with a hint and an announcement', async () => {
  const f = form();
  await type(f, 'myapp');
  const rows = f.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.ipr-name').textContent, 'myapp', 'the typed name is not offered');
  assert.equal(f.rs.querySelector('.ipr-msg').textContent, t('app.iconTryUpload'));
  assert.equal(f.status.textContent, t('app.iconNoMatch', { q: 'myapp' }));
  assert.ok(en.app.iconNoMatch.includes('{q}'), 'the failed query is not shown back');
  assert.ok(f.prev.querySelector('img'), 'an unlisted name is never tried');
  f.done();
});

test('a failed search says so and still previews the typed name', async () => {
  const f = form();
  await type(f, 'down');
  assert.equal(f.status.textContent, t('app.iconSearchFailed'), 'a failed search is not announced');
  assert.match(f.rs.textContent, new RegExp(t('app.iconTryUpload').slice(0, 20)));
  assert.ok(f.prev.querySelector('img'), 'the field goes quiet while the catalogues are down');
  await type(f, 'demo');
  assert.equal(f.status.textContent, t('app.iconSearchDemo'));
  f.done();
});

/* "Spring Boot" matches simple-icons, and saving the typed text resolves to
   dashboardicons and loads nothing. */
test('what the tile shows is what gets saved', async () => {
  const f = form();
  await type(f, 'spring boot');
  assert.equal(state.siurl, SPRING.ref, 'the typed text stays saved');
  assert.equal(f.prev.querySelector('img').src, SPRING.urls[0], 'the preview does not use the confirmed file');
  f.done();
});

test('a pasted address and a local file preview immediately, with no search', async () => {
  const f = form();
  const before = searches().length;
  await type(f, 'https://cdn.example/own.png', 0);
  assert.equal(f.prev.querySelector('img').src, 'https://cdn.example/own.png');
  assert.equal(f.rs.classList.contains('open'), false);
  await settle(340);
  assert.equal(searches().length, before);
  f.done();
});

/* Several attempts are in flight at once and the half-typed ones finish last. */
test('a stale preview attempt cannot overwrite a newer one', async () => {
  const f = form();
  await type(f, 'https://cdn.example/one.png', 0);
  const first = f.prev.querySelector('img');
  await type(f, 'https://cdn.example/two.png', 0);
  const second = f.prev.querySelector('img');
  first.onerror();
  assert.equal(f.prev.firstChild, second, 'a late failure reset the tile');
  assert.equal(second.style.width, undefined, 'the redraw pins a pixel width');
  second.onerror();
  assert.equal(f.prev.querySelector('img'), null, 'the current failure keeps a broken image');
  f.done();
});

test('the source label and the result rows are styled', () => {
  assert.match(css, /\.ipr-src\{/, 'the source label is unstyled');
  assert.match(css, /\.ipr-name\{[^}]*text-align:match-parent/);
});

/* The list draws its own hover background only where the glide highlight is
   not available, or a pointer shows two highlights at once. */
test('the results list uses the shared highlight', () => {
  assert.match(read('js/fluid-hover.js'), /container: '#iprs', item: '\.ipr'/);
  assert.doesNotMatch(
    css,
    /@media not \(\(hover:hover\) and \(pointer:fine\)\)\{\.ipr:hover/,
    'a tapped row stays lit',
  );
  assert.match(css, /\.ipr:active\{background:var\(--fill-tertiary\)\}/, 'a touch press has no feedback');
});

test('every string the picker shows is translated', () => {
  const keys = [
    'iconSearching',
    'iconNoMatch',
    'iconTryUpload',
    'iconSearchFailed',
    'iconSearchDemo',
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

/* The Icon group also holds the colour controls, so a list measured from the
   group opened below the sliders instead of below the field, and moved further
   down when the custom colour picker was open. */
test('the list is measured from the field, not from the panel', () => {
  const f = form();
  const anchor = document.querySelector('#ipw .icon-src-anchor');
  assert.ok(anchor, 'the field row has no positioned anchor');
  assert.ok(anchor.contains(f.rs), 'the list is outside the anchor');
  assert.ok(anchor.contains(f.inp));
  assert.match(css, /\.icon-src-anchor\{position:relative\}/);
  assert.match(css, /\.iprs\{position:absolute;top:calc\(100% \+ 4px\)/);
  assert.doesNotMatch(css, /\.ipw\{/, 'the rule for the old markup is still there');
  assert.doesNotMatch(css, /\.iprs\.open\{display:block;padding/, 'the in-flow rule can still win');
  f.done();
});
