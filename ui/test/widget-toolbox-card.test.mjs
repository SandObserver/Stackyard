import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
const { setCardAppearance } = await import('../js/widget-toolbox.js');

const frameIn = card => ({ closest: sel => (sel === '.widget, .mob-widget-card' ? card : null) });

test('a dark widget page marks its card dark, and a light one clears it', () => {
  const card = { dataset: {} };
  globalThis.window = { frameElement: frameIn(card) };
  setCardAppearance(true);
  assert.equal(card.dataset.appearance, 'dark');
  setCardAppearance(false);
  assert.equal('appearance' in card.dataset, false);
});

test('a widget page outside a dashboard card changes nothing', () => {
  globalThis.window = { frameElement: null };
  assert.doesNotThrow(() => setCardAppearance(true));
  globalThis.window = { frameElement: frameIn(null) };
  assert.doesNotThrow(() => setCardAppearance(true));
});

test('the weather widget follows its own day and night on the card', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../widgets/weather/index.html', import.meta.url), 'utf8');
  assert.match(src, /setCardAppearance\(!lightCard\)/);
});
