/* A tile badge paints from the badge and health polls, and speaks through its
   tile's name rather than as a live region of its own. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, installDom, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

const answers = { badges: {}, health: {} };
const fr = JSON.parse(readFileSync(new URL('../i18n/fr.json', import.meta.url), 'utf8'));
const fetch = fakeFetch({
  ...catalogRoutes(),
  '/i18n/fr.json': fr,
  '/api/badges': () => answers.badges,
  '/api/health': () => answers.health,
});
const dom = installDom({
  markup:
    '<a id="ta" data-tile-name="Alpha"><span id="ba" class="badge"></span></a>' +
    '<button id="tf" data-tile-name="Box"><span id="bf" class="badge"></span></button>' +
    '<div id="tr" role="button" data-tile-name="Row"><span id="br" class="badge"></span></div>',
  fetch,
});
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { createDashboardState } = await import('../js/dashboard-state.js');
const { createBadges } = await import('../js/dashboard-badges.js');
const { setNumberLanguage } = await import('../js/format-number.js');

const dash = createDashboardState();
dash.items = [
  { id: 'a', type: 'app', label: 'Alpha', monitoring: { activity: { custom: { unit: 'jobs' } } } },
  { id: 'b', type: 'app', label: 'Beta' },
  { id: 'f', type: 'folder', label: 'Box', children: ['a', 'b'] },
  { id: 'r', type: 'app', label: 'Row' },
];
dash.S = { server: {} };
const badges = createBadges(dash);
const $ = id => dom.document.getElementById(id);
badges.breg('a', $('ba'));
badges.breg('f', $('bf'));
badges.breg('r', $('br'));

test('a poll paints the count and its unit, and names the tile with them', async () => {
  answers.badges = { a: { value: 3 } };
  await badges.pollBadges();
  const b = $('ba');
  assert.ok(b.classList.contains('on'));
  assert.equal(b.querySelector('.badge-txt').textContent, '3');
  assert.equal(b.querySelector('.badge-unit').textContent, ' jobs');
  assert.equal($('ta').getAttribute('aria-label'), `Alpha, ${t('status.pendingValue', { value: '3 jobs' })}`);
});

test('a badge is hidden from readers and is not a live region or a tooltip', async () => {
  const b = $('ba');
  b.setAttribute('role', 'status');
  b.setAttribute('aria-label', 'old');
  b.setAttribute('title', 'old');
  answers.badges = { a: { value: 4 } };
  await badges.pollBadges();
  assert.equal(b.getAttribute('aria-hidden'), 'true');
  assert.equal(b.getAttribute('role'), null);
  assert.equal(b.getAttribute('aria-label'), null);
  assert.equal(b.getAttribute('title'), null);
});

test('a folder adds up its children and names a button tile', () => {
  assert.equal($('bf').querySelector('.badge-txt').textContent, '4');
  assert.match($('tf').getAttribute('aria-label'), /^Box, /);
});

test('a tile carrying the button role is named, and the label does not accumulate', async () => {
  answers.health = { r: { unhealthy: true } };
  await badges.pollHealth();
  await badges.pollHealth();
  assert.equal($('tr').getAttribute('aria-label'), `Row, ${t('status.needsAttention')}`);
});

test('the count takes the digits of the interface language', async () => {
  setNumberLanguage('fa');
  try {
    answers.badges = { a: { value: 5 } };
    await badges.pollBadges();
    assert.equal($('ba').querySelector('.badge-txt').textContent, '۵');
  } finally {
    setNumberLanguage('en');
  }
});

test('two failed polls mark the badge stale, and a good one clears it', async () => {
  const good = answers.badges;
  answers.badges = { status: 500, body: {} };
  await badges.pollBadges();
  assert.ok(!$('ba').classList.contains('stale'), 'one failure is not stale yet');
  await badges.pollBadges();
  assert.ok($('ba').classList.contains('stale'));
  assert.ok($('ta').getAttribute('aria-label').includes(t('status.stale')), 'the label does not say stale');
  answers.badges = good;
  await badges.pollBadges();
  assert.ok(!$('ba').classList.contains('stale'));
});

test('a failed item keeps its last value, marked stale', async () => {
  answers.badges = { a: { error: 'boom' } };
  await badges.pollBadges();
  assert.equal($('ba').querySelector('.badge-txt').textContent, '5');
  assert.ok($('ba').classList.contains('stale'));
});

test('registering a badge paints it at once', () => {
  const span = dom.document.createElement('span');
  $('ta').appendChild(span);
  badges.breg('a', span);
  assert.ok(span.classList.contains('on'));
  badges.bunreg('a', span);
  assert.equal(badges.BEL.get('a').has(span), false);
});

test('the tile name is spoken in the interface language', async () => {
  await initI18n('fr');
  answers.health = { r: { unhealthy: false } };
  answers.badges = { a: { value: 2 } };
  await badges.pollHealth();
  await badges.pollBadges();
  assert.equal($('ta').getAttribute('aria-label'), `Alpha, ${fr.status.pendingValue.replace('{value}', '2 jobs')}`);
});

await settle();
