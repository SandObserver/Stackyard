/* The admin nav links and the sections they reveal must agree. A link whose
   data-sec names no section is caught here rather than surviving as a silent
   fallback in resolveAdminSection. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { catalogRoutes, fakeFetch, installDom, pageBody } from './fake-dom.mjs';

import { resolveAdminSection } from '../js/admin-logic.js';

register('./js-root-hooks.mjs', import.meta.url);

/* The Settings page, opened at `hash` with `stored` as the remembered section. */
async function openSettings({ hash = '', stored } = {}) {
  const dom = installDom({
    markup: pageBody('admin/index.html'),
    fetch: fakeFetch(catalogRoutes()),
    location: `http://nas.local/admin/${hash}`,
    storage: stored ? { admin_sec: stored } : {},
  });
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    (await import('../js/admin-nav.js')).initNav();
  } finally {
    console.warn = warn;
  }
  const shown = dom.document.querySelectorAll('.sec').filter(s => !s.hidden);
  return { dom, warned, shown: shown.map(s => s.id) };
}

test('a first visit with no remembered section does not warn', async () => {
  const first = await openSettings();
  assert.deepEqual(first.warned, []);
  assert.equal(first.shown.length, 1);
  const old = await openSettings({ stored: 'removed-section' });
  assert.equal(old.warned.length, 1, 'a stored section from an older version is not reported');
  assert.deepEqual(old.shown, first.shown);
});

test('picking a tab bar tab plays its icon; the first load and the keyboard do not', async () => {
  const { dom } = await openSettings({ hash: '#general' });
  const doc = dom.document;
  const svg = doc.querySelector('.mtab[data-sec="dashboard"] svg');
  const base = Object.getPrototypeOf(Object.getPrototypeOf(svg));
  const owner = Object.hasOwn(base, 'animate') ? base : Object.getPrototypeOf(base);
  const own = owner.animate;
  let played = 0;
  owner.animate = function (...a) {
    if (this.getAttribute?.('data-part')) played++;
    return own.apply(this, a);
  };
  try {
    assert.equal(played, 0, 'nothing plays on load');
    doc.querySelector('.mtab[data-sec="dashboard"]').dispatchEvent({ type: 'click', bubbles: true, detail: 0 });
    assert.equal(played, 0, 'a keyboard pick plays nothing');
    doc.querySelector('.mtab[data-sec="general"]').click();
    assert.ok(played > 0, 'a tap plays the picked icon');
    const after = played;
    doc.querySelector('.mtab[data-sec="general"]').click();
    assert.equal(played, after, 'picking the shown tab again plays nothing');
    doc.querySelector('.nl[data-sec="dashboard"]').click();
    assert.equal(played, after, 'the sidebar plays nothing');
  } finally {
    owner.animate = own;
  }
});

test('the import link opens the settings section that holds import', async () => {
  const empty = installDom({ markup: pageBody('index.html') });
  try {
    const { renderEmptyState } = await import('../js/utils.js');
    renderEmptyState([]);
    const link = empty.document.querySelector('.empty-state .empty-state-hint');
    assert.equal(link?.getAttribute('href'), '/admin/#general', 'it lands wherever settings was left');
  } finally {
    empty.restore();
  }
  const page = await openSettings({ hash: '#general', stored: 'about' });
  assert.deepEqual(page.shown, ['sec-general'], 'admin ignores the hash on load');
  page.dom.location.hash = '#about';
  page.dom.window.dispatchEvent({ type: 'hashchange' });
  const now = page.dom.document.querySelectorAll('.sec').filter(s => !s.hidden);
  assert.deepEqual(
    now.map(s => s.id),
    ['sec-about'],
    'admin ignores a later hash change',
  );
  assert.equal(page.dom.storage.get('admin_sec'), 'about');
});

test('the item editor heading names the item', async () => {
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  const { initI18n, t } = await import('../js/i18n.js');
  await initI18n('en');
  const { state } = await import('../js/admin-state.js');
  const { openEditor } = await import('../js/admin-editor.js');
  const title = dom.document.getElementById('ev-title');
  state.items = [{ id: 'media', type: 'app', label: 'Media (old)', href: 'http://media.local' }];
  openEditor('media');
  assert.equal(title.textContent, t('common.editNamed', { name: '⁨Media (old)⁩' }));
  assert.ok(title.querySelector('bdi'), 'the heading is not isolated as user text');
  state.items = [{ id: 'unnamed', type: 'app', href: 'http://media.local' }];
  openEditor('unnamed');
  assert.match(title.textContent, /unnamed/, 'an item with no label is named by its id');
  openEditor(null);
  assert.equal(title.textContent, t('type.addNew'));
  assert.equal(title.querySelector('bdi'), null);
  assert.equal(title.getAttribute('dir'), null);
});

test('each header Save is driven by its own unsaved-change check', () => {
  const src = fs.readFileSync(new URL('../js/admin-settings.js', import.meta.url), 'utf8');
  assert.match(src, /trackSave\('srv-save', readServerForm\)/);
  assert.match(src, /trackSave\('bg-save', readWallpaperForm\)/);
  assert.match(
    src,
    /document\.addEventListener\(type, \(\) =>\s*setTimeout\(/,
    'a picker list lives on the body, so listening on the section misses its choice',
  );
  /* Forcing the reset there swallows a choice made while it was in flight. */
  assert.match(src, /syncAuthFromServer\(\)\.then\(\(\) => _srvTrack\?\.reset\(false\)\)/);
  const reader = src.slice(src.indexOf('const readServerForm'), src.indexOf('const readWallpaperForm'));
  assert.doesNotMatch(reader, /set-labels|set-awake/, 'a save-on-change switch must not light Save');
  assert.match(fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8'), /addEventListener\('beforeunload'/);
});

test('a saved Proxmox secret leaves General with nothing unsaved', () => {
  const src = fs.readFileSync(new URL('../js/admin-settings.js', import.meta.url), 'utf8');
  const save = src.slice(src.indexOf('async function saveServer'));
  assert.ok(save.indexOf('clearPveSecretInput();') >= 0);
  assert.ok(save.indexOf('clearPveSecretInput();') < save.indexOf('_srvTrack?.reset();'));
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const sections = [
  ...new Set(
    [...html.matchAll(/id="sec-([a-z-]+)"[^>]*class="[^"]*\bsec\b/g)]
      .map(m => m[1])
      .concat([...html.matchAll(/class="[^"]*\bsec\b[^"]*"[^>]*id="sec-([a-z-]+)"/g)].map(m => m[1])),
  ),
];
const links = [...new Set([...html.matchAll(/data-sec="([a-z-]+)"/g)].map(m => m[1]))];

test('the markup still has sections and nav links', () => {
  assert.ok(sections.length >= 2, `found ${sections.length} sections`);
  assert.ok(links.length >= 2, `found ${links.length} nav links`);
});

test('every nav link names a section that exists', () => {
  for (const l of links) {
    assert.ok(sections.includes(l), `data-sec="${l}" matches no section in the page`);
  }
});

test('every section is reachable from a nav link', () => {
  for (const s of sections) {
    assert.ok(links.includes(s), `section sec-${s} has no nav link`);
  }
});

/* Clicking any link must leave exactly one section visible. */
test('every nav link resolves to itself', () => {
  for (const l of links) {
    assert.equal(resolveAdminSection(l, sections), l, `clicking ${l} should show ${l}`);
  }
});

test('a stored section from an older version does not blank the page', () => {
  const got = resolveAdminSection('a-section-that-was-renamed', sections);
  assert.ok(sections.includes(got), 'must land on a real section');
});

/* ── A group footer explains the row above it ─────────────────────────────── */

/* The logging tip sat after four rows and described the first, with the health
   checks toggle between them. A footer that is not adjacent to its row reads as
   describing whatever it follows. */
test('the logging tip follows the logging row, not the group below it', () => {
  const level = html.indexOf('id="log-level"');
  const tip = html.indexOf('data-i18n="general.loggingTip"');
  const health = html.indexOf('id="rl-srv-hc-en"');
  assert.ok(level > -1 && tip > -1 && health > -1, 'the Monitoring group has moved');
  assert.ok(tip > level, 'the tip comes before the row it explains');
  assert.ok(tip < health, 'a row it does not describe sits between them');
});

/* "Errors shows warnings and errors only" used the option name as a bare
   subject, which does not parse. */
test('neither Settings tip opens with a bare option name', () => {
  const cat = JSON.parse(read('i18n/en.json'));
  assert.doesNotMatch(cat.general.loggingTip, /^Errors shows/);
  assert.match(cat.general.loggingTip, /Errors/, 'the tip must still name the option it describes');
});

/* "Used to allow your server's IP in badge URLs and SSRF protection" named the
   mechanism rather than the effect. */
test('the host IP tip states what it does, not how', () => {
  const cat = JSON.parse(read('i18n/en.json'));
  assert.doesNotMatch(cat.general.hostIpTip, /SSRF/, 'implementation jargon in a user-facing hint');
});

test('both tips are translated everywhere', () => {
  const en = JSON.parse(read('i18n/en.json')).general;
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json') && f !== 'en.json')) {
    const cat = JSON.parse(read(`i18n/${file}`)).general;
    for (const key of ['loggingTip', 'hostIpTip']) {
      assert.ok(cat[key], `${file} is missing general.${key}`);
      assert.notEqual(cat[key], en[key], `${file} still carries the English ${key}`);
    }
  }
});
