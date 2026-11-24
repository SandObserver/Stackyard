/* The Settings page loads the config into its controls once the catalog is in,
   and offers a retry when the load fails. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const config = {
  items: [{ id: 'a', type: 'app', label: 'A', href: 'http://a.local' }],
  settings: { language: 'en', logLevel: 'error', background: { type: 'color', color: '#203040' } },
};
const fetch = fakeFetch({
  ...catalogRoutes(),
  '/api/config': config,
  '/api/widgets': { widgets: [], rejected: [] },
  '/api/icons/local': [],
  '/api/version': { current: '1.24.0' },
  '/api/auth/status': { enabled: false },
});
const dom = installDom({ markup: pageBody('admin/index.html'), fetch });
const { t } = await import('../js/i18n.js');
const { createPageLoad } = await import('../js/admin-page-load.js');
const { initSettingsControls } = await import('../js/admin-settings-controls.js');
const { initList } = await import('../js/admin-list.js');
initList({ openModal: () => {}, openFolderPicker: () => {}, save: async () => true });
initSettingsControls();

const recorded = [];
const writes = {
  loaded: items => recorded.push(['loaded', items.map(i => i.id)]),
  drawn: () => recorded.push(['drawn']),
  syncDashSave: () => recorded.push(['sync']),
};
const page = createPageLoad({ writes });
const picker = id => dom.document.getElementById(`${id}-list-value`);

test('saved settings reach the pickers in the loaded language', async () => {
  assert.match(picker('bg-type').textContent, /^appearance\./, 'the picker is built before the catalog loads');
  await page.load();
  assert.equal(dom.document.getElementById('bg-type').value, 'color');
  assert.match(picker('bg-type').textContent, new RegExp(t('appearance.sourceColor')));
  assert.equal(dom.document.getElementById('log-level').value, 'error');
  assert.match(picker('log-level').textContent, new RegExp(t('general.logError')));
});

test('the load records the server list before the first draw and the drawn list after it', () => {
  assert.deepEqual(recorded, [['loaded', ['a']], ['drawn'], ['sync']]);
});

test('the language picker marks each language name with its language', () => {
  const options = dom.document.querySelectorAll('#lang-list li[role="option"]');
  const named = options.filter(o => o.lang);
  assert.ok(named.length >= 6, `only ${named.length} options carry their language`);
  for (const o of named) assert.match(o.lang, /^[a-z]{2}(-[A-Z]{2}|-[A-Z][a-z]{3})?$/);
});

test('a failed load says so and offers a retry that reloads the page', async () => {
  fetch.routes['/api/config'] = { status: 500, body: { error: 'down', kind: 'internal' } };
  await page.loadOrShowFailure();
  await settle();
  const retry = dom.document.querySelector('#al .retry-btn');
  assert.ok(retry, 'no retry button');
  assert.equal(retry.getAttribute('onclick'), null);
  const reloads = dom.location.reloads;
  retry.click();
  assert.equal(dom.location.reloads, reloads + 1);
  assert.equal(dom.document.body.classList.contains('loaded'), true);
});

test('a theme change on Settings crossfades', () => {
  const views = [];
  dom.document.startViewTransition = fn => {
    views.push(fn);
    fn();
  };
  dom.storage.set('sy-theme', 'light');
  dom.window.dispatchEvent({ type: 'storage', key: 'sy-theme' });
  assert.equal(views.length, 1, 'a change from another tab does not crossfade');
  assert.equal(dom.document.documentElement.getAttribute('data-theme'), 'light');
  dom.document.querySelector('#theme-list li[role="option"][data-val="dark"]').click();
  assert.equal(views.length, 2, 'picking a mode does not crossfade');
  assert.equal(dom.document.documentElement.getAttribute('data-theme'), 'dark');
  delete dom.document.startViewTransition;
});
