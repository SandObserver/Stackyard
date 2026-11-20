import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mock, test } from 'node:test';
import { fakeFetch, installDom, pageBody } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

let changed = false;
const fetch = fakeFetch({ '/api/config': { items: [] } });
const dom = installDom({ markup: pageBody('index.html'), fetch, location: 'http://nas.local/' });
const { createPolling } = await import('../js/dashboard-polling.js');

const runs = { badges: 0, health: 0 };
const badges = /** @type {any} */ ({
  pollBadges: async () => runs.badges++,
  pollHealth: async () => runs.health++,
});
const polling = createPolling({ badges, differs: () => changed });
polling.watchVisibility();
const doc = dom.document;
const drain = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const configPolls = () => fetch.calls.filter(c => c.url === '/api/config').length;

test('starting the polls again does not run two loops', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    polling.startPolling();
    polling.startPolling();
    mock.timers.tick(31_000);
    await drain();
    assert.equal(runs.health, 1, 'the first loop was left running');
    assert.equal(runs.badges, 1);
    polling.stopPolling();
    mock.timers.tick(120_000);
    await drain();
    assert.equal(runs.health, 1, 'a stopped poll ran');
  } finally {
    mock.timers.reset();
  }
});

test('a hidden tab stops polling, and a returning one polls everything at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    polling.startPolling();
    doc.hidden = true;
    doc.dispatchEvent({ type: 'visibilitychange' });
    mock.timers.tick(120_000);
    await drain();
    assert.deepEqual(runs, { badges: 1, health: 1 }, 'a hidden tab kept polling');
    const before = configPolls();
    doc.hidden = false;
    doc.dispatchEvent({ type: 'visibilitychange' });
    await drain();
    assert.deepEqual(runs, { badges: 2, health: 2 });
    assert.equal(configPolls(), before + 1);
    polling.stopPolling();
  } finally {
    mock.timers.reset();
  }
});

test('a changed config reloads, unless Search, a folder or a swipe is in progress', async () => {
  changed = true;
  await polling.pollConfig();
  assert.equal(dom.location.reloads, 1);
  doc.getElementById('spot').setAttribute('open', '');
  await polling.pollConfig();
  doc.getElementById('spot').removeAttribute('open');
  const folder = doc.createElement('dialog');
  folder.className = 'folder-overlay';
  folder.setAttribute('open', '');
  doc.body.appendChild(folder);
  await polling.pollConfig();
  folder.remove();
  doc.getElementById('pages').classList.add('dragging');
  await polling.pollConfig();
  doc.getElementById('pages').classList.remove('dragging');
  assert.equal(dom.location.reloads, 1, 'a reload landed over an open overlay or a swipe');
  changed = false;
  await polling.pollConfig();
  assert.equal(dom.location.reloads, 1, 'an unchanged config reloaded');
});
