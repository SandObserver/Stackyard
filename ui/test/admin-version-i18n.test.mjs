/* The About version line is translated, so it cannot be written before the
   catalogs are loaded. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const catalog = catalogRoutes()['/i18n/en.json'];
let catalogServed = false;
const fetch = fakeFetch({
  '/i18n/en.json': async () => {
    await settle(20);
    catalogServed = true;
    return catalog;
  },
  '/api/config': { items: [], settings: { language: 'en' } },
  '/api/widgets': { widgets: [], rejected: [] },
  '/api/icons/local': [],
  '/api/version': { current: 'v1.24.0', latest: 'v1.25.0', updateAvailable: true },
});
const dom = installDom({ markup: pageBody('admin/index.html'), fetch });
const { initI18n, t } = await import('../js/i18n.js');
const { createPageLoad } = await import('../js/admin-page-load.js');
const { initVersion } = await import('../js/admin-about.js');

const writes = { loaded() {}, drawn() {}, syncDashSave() {} };

test('the version is asked for only after the catalog arrives', async () => {
  let versionAskedEarly = null;
  const route = fetch.routes['/api/version'];
  fetch.routes['/api/version'] = () => {
    versionAskedEarly ??= !catalogServed;
    return route;
  };
  await createPageLoad({ writes }).load();
  assert.equal(versionAskedEarly, false, 'the version line was written before the catalog loaded');
  fetch.routes['/api/version'] = route;
  await settle(5);
  assert.equal(dom.document.getElementById('sidebar-version').textContent, 'v1.24.0');
});

test('both forms of the version line come from the catalog', async () => {
  fetch.routes['/i18n/es.json'] = JSON.parse(readFileSync(new URL('../i18n/es.json', import.meta.url), 'utf8'));
  await initI18n('es');
  const about = dom.document.getElementById('about-version');
  fetch.routes['/api/version'] = { current: '1.24.0', updateAvailable: false };
  await initVersion();
  assert.equal(about.textContent, t('about.version', { v: '1.24.0' }));
  assert.notEqual(about.textContent, 'about.version');

  fetch.routes['/api/version'] = { current: 'v1.24.0', latest: 'v1.25.0', updateAvailable: true };
  await initVersion();
  const link = about.querySelector('a.upd-link');
  assert.ok(link, 'a newer release has no link');
  assert.equal(link.textContent.trim(), t('about.updateTo', { v: '1.25.0' }));
  assert.ok(about.textContent.startsWith(t('about.version', { v: '1.24.0' })));
  assert.notEqual(t('about.version', { v: '1' }), 'Version v1', 'the check needs a catalog that is not English');
  assert.equal(dom.document.getElementById('about-update-dot').classList.contains('d-none'), false);
});
