import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const CORE = { widget: { justNow: 'à l’instant' } };
const OWN = {
  'ui.items_one': '{count} élément',
  'ui.items_many': '{count} d’éléments',
  'ui.items_other': '{count} éléments',
  'ui.greet': 'Bonjour {name}',
};
let releaseCore;
const coreHeld = new Promise(r => {
  releaseCore = r;
});
globalThis.location = { search: '?lang=fr', pathname: '/widgets/demo/index.html' };
globalThis.fetch = async url => {
  if (url === '/i18n/fr.json') await coreHeld;
  const body = url === '/i18n/fr.json' ? CORE : url === '/widgets/demo/i18n/fr.json' ? OWN : null;
  return { ok: !!body, json: async () => body };
};

const { loadStrings, wt, wtCount, relativeTime, sinceLabel, formatNumber } = await import('../js/widget-toolbox.js');

test('loadStrings waits for the shared strings as well as the widget catalog', async () => {
  let done = false;
  const loading = loadStrings().then(() => {
    done = true;
  });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(done, false, 'loadStrings resolved before the shared strings arrived');
  releaseCore();
  await loading;
  assert.equal(sinceLabel(Date.now()), 'à l’instant');
});

test('a counted message takes the category of the widget language', () => {
  const en = { one: '{count} item', other: '{count} items' };
  assert.equal(wtCount('ui.items', 0, en), '0 élément', 'French puts zero in one');
  assert.equal(wtCount('ui.items', 2, en), '2 éléments');
  assert.equal(wtCount('ui.items', 1_000_000, en), `${formatNumber(1_000_000)} d’éléments`);
});

test('a counted message missing from the catalog falls back to the English forms', () => {
  const en = { one: '{count} thing', other: '{count} things' };
  assert.equal(wtCount('ui.absent', 1, en), '1 thing');
  assert.equal(wtCount('ui.absent', 0, en), '0 things');
});

test('wt fills placeholders in one pass', () => {
  assert.equal(wt('ui.greet', 'Hello {name}', { name: '{name}' }), 'Bonjour {name}');
  assert.equal(wt('ui.absent', 'Hi {name}', { name: 'Ada' }), 'Hi Ada');
  assert.equal(wt('ui.greet', 'Hello {name}'), 'Bonjour {name}');
});

test('a relative time reads in the widget language, past and future', () => {
  const now = Date.now();
  assert.equal(
    relativeTime(now - 2 * 3600e3),
    new Intl.RelativeTimeFormat('fr', { style: 'short' }).format(-2, 'hour'),
  );
  assert.equal(relativeTime(now + 3 * 86400e3), new Intl.RelativeTimeFormat('fr', { style: 'short' }).format(3, 'day'));
  assert.equal(relativeTime(now - 10e3), new Intl.RelativeTimeFormat('fr', { style: 'short' }).format(-1, 'minute'));
  assert.doesNotMatch(relativeTime(now - 3600e3), /ago|\bin\b/);
});
