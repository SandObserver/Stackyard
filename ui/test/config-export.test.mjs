/* The config export fetches the response and checks it before anything is
   saved. Clicking an anchor at the endpoint hands the request to the browser,
   so a refusal, a server error or an expired session is written to disk as an
   error body under the backup's own filename. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { beforeEach, test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, pageBody, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const fetch = fakeFetch({ ...catalogRoutes() });
const dom = installDom({ markup: pageBody('admin/index.html'), fetch });
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { setReauthHandler } = await import('../js/admin-shared.js');
const { wireTransfer } = await import('../js/admin-transfer.js');
wireTransfer({ restoreBackup: async () => true, appendAndSave: async () => {} });

/* What the page hands the browser to save: each anchor clicked, and each object
   URL made and released. */
const saved = { clicks: [], urls: new Map(), revoked: [] };
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
URL.createObjectURL = blob => {
  const url = `blob:nas.local/${saved.urls.size + 1}`;
  saved.urls.set(url, blob);
  return url;
};
URL.revokeObjectURL = url => saved.revoked.push(url);
const realCreateElement = dom.document.createElement.bind(dom.document);
dom.document.createElement = tag => {
  const node = realCreateElement(tag);
  if (tag === 'a') {
    node.click = () => saved.clicks.push({ href: node.href, download: node.download, attached: node.isConnected });
  }
  return node;
};
process.on('exit', () => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

const exportButton = dom.document.getElementById('btn-exp');
const toastText = () => dom.document.getElementById('toast-msg').textContent;

async function pressExport() {
  exportButton.click();
  await settle(5);
}

beforeEach(() => {
  dom.flushFrames();
  saved.clicks = [];
  saved.urls.clear();
  saved.revoked = [];
  fetch.calls.length = 0;
  setReauthHandler(null);
  dom.document.getElementById('toast-msg').textContent = '';
});

test('the export never reaches the endpoint by navigating to it', async () => {
  fetch.routes['/api/config/export'] = { items: [{ id: 'a' }], settings: {} };
  await pressExport();
  assert.equal(saved.clicks.length, 1);
  assert.match(saved.clicks[0].href, /^blob:/, 'the anchor points at the endpoint, which the browser saves unchecked');
});

test('the export reads the endpoint through the shared request, so a failure is visible', async () => {
  fetch.routes['/api/config/export'] = { status: 500, body: { error: 'disk full', kind: 'internal' } };
  await pressExport();
  assert.deepEqual(
    fetch.calls.map(c => c.url),
    ['/api/config/export'],
  );
  assert.equal(saved.clicks.length, 0, 'an error body was handed to the browser to save');
  assert.equal(toastText().startsWith(t('toast.exportFailed', { err: '' }).trim()), true);
});

test('an expired session signs in again and the export finishes', async () => {
  let asked = 0;
  setReauthHandler(() => {
    asked++;
    fetch.routes['/api/config/export'] = { items: [], settings: {} };
    return true;
  });
  fetch.routes['/api/config/export'] = { status: 401 };
  await pressExport();
  assert.equal(asked, 1);
  assert.equal(saved.clicks.length, 1);
});

test('the saved file is the config the server sent', async () => {
  const config = { items: [{ id: 'a', type: 'app' }], settings: { language: 'en' } };
  fetch.routes['/api/config/export'] = config;
  await pressExport();
  const blob = saved.urls.get(saved.clicks[0].href);
  assert.equal(blob.type, 'application/json');
  assert.deepEqual(JSON.parse(await blob.text()), config);
});

test('the object URL is released on the next frame, after the click', async () => {
  fetch.routes['/api/config/export'] = { items: [], settings: {} };
  await pressExport();
  assert.deepEqual(saved.revoked, [], 'revoked in the same frame races the download');
  dom.flushFrames();
  assert.deepEqual(saved.revoked, [saved.clicks[0].href]);
  assert.equal(dom.document.querySelector('a[download]'), null, 'the anchor is left in the page');
});

test('the download keeps the filename users already know', async () => {
  fetch.routes['/api/config/export'] = { items: [], settings: {} };
  await pressExport();
  assert.equal(saved.clicks[0].download, 'stackyard-config.json');
  assert.equal(saved.clicks[0].attached, true, 'the anchor is clicked while outside the page');
});
