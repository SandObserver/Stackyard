/* Regression tests for P6-1 and P5-13: an unrecognised widget leaked its config.

   A widget's manifest is what says which of its config fields are secret.
   Without one, the scrub could not tell, and the previous default was to send
   the config untouched. So an API key went to the browser on GET /api/config, on
   GET /api/widget-config/:id, and into the config export, in plain text.

   Three ways a widget ends up unrecognised:
     its manifest failed validation, so widgets.js skipped it
     the widget folder was removed or renamed, leaving an orphan config item
     WIDGETS_PATH is wrong, in which case the registry loads empty and every
       widget is unrecognised at once

   The default is inverted: not recognised means withhold. That is only safe
   because the save path puts the stored config back, so the empty config the
   browser was handed cannot overwrite the real one. The two are tested together
   here, because either alone is a bug: withholding without restoring destroys
   settings, restoring without withholding is the leak. */

const path = require('node:path');

process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scrubAllSecrets, preserveAllSecrets } = require('../src/config-secrets');
const { WITHHELD_FLAG } = require('../src/widget-secrets');

const SECRET = 'ORPHAN-SECRET';

function storedConfig() {
  return {
    items: [
      { id: 'w1', type: 'widget', widgetType: 'books', widgetConfig: { absUrl: 'https://real.example', absKey: 'KNOWN-SECRET' } },
      { id: 'w2', type: 'widget', widgetType: 'no-such-widget', widgetConfig: { url: 'https://real.example', apiKey: SECRET, nested: { token: 'DEEP-SECRET' } } },
      { id: 'a1', type: 'app', name: 'App' },
    ],
  };
}
const copy = v => JSON.parse(JSON.stringify(v));
const find = (cfg, id) => cfg.items.find(i => i.id === id);

/* ── the read path ────────────────────────────────────────────────────────── */

test('an unrecognised widget sends no config at all', () => {
  const sent = scrubAllSecrets(copy(storedConfig()));
  assert.deepEqual(find(sent, 'w2').widgetConfig, {});
  assert.ok(!JSON.stringify(sent).includes(SECRET), 'no part of the config may carry the secret');
  assert.ok(!JSON.stringify(sent).includes('DEEP-SECRET'), 'nested values too');
});

test('the withheld state is flagged so the UI can explain it', () => {
  const sent = scrubAllSecrets(copy(storedConfig()));
  assert.equal(find(sent, 'w2')[WITHHELD_FLAG], true);
  assert.ok(!(WITHHELD_FLAG in find(sent, 'w1')), 'a recognised widget is not flagged');
});

test('a recognised widget is still scrubbed field by field, not withheld', () => {
  const sent = scrubAllSecrets(copy(storedConfig()));
  const w1 = find(sent, 'w1');
  assert.equal(w1.widgetConfig.absUrl, 'https://real.example', 'non-secret fields still come through');
  assert.equal(w1.widgetConfig.absKey, undefined);
  assert.equal(w1.widgetConfig.absKeySet, true);
});

test('apps are unaffected', () => {
  const sent = scrubAllSecrets(copy(storedConfig()));
  assert.equal(find(sent, 'a1').name, 'App');
});

/* ── the save path, which is what makes withholding safe ──────────────────── */

test('saving back the withheld config does not destroy the stored one', () => {
  const stored = storedConfig();
  const roundTripped = scrubAllSecrets(copy(stored));
  preserveAllSecrets(roundTripped, stored);
  assert.deepEqual(find(roundTripped, 'w2').widgetConfig, find(stored, 'w2').widgetConfig);
});

/* Someone editing the config by hand, or a stale browser, must not be able to
   replace an unrecognised widget's config either: the server has no way to tell
   which of the supplied fields would be secret. */
test('a supplied config for an unrecognised widget is discarded', () => {
  const stored = storedConfig();
  const incoming = copy(stored);
  find(incoming, 'w2').widgetConfig = { url: 'https://evil.example', apiKey: 'attacker-chosen' };
  preserveAllSecrets(incoming, stored);
  assert.deepEqual(find(incoming, 'w2').widgetConfig, find(stored, 'w2').widgetConfig);
});

test('a new widget of an unrecognised type keeps what was sent', () => {
  const stored = storedConfig();
  const incoming = copy(stored);
  incoming.items.push({ id: 'w3', type: 'widget', widgetType: 'no-such-widget', widgetConfig: { url: 'https://new.example' } });
  preserveAllSecrets(incoming, stored);
  assert.deepEqual(find(incoming, 'w3').widgetConfig, { url: 'https://new.example' }, 'nothing stored, so nothing to protect');
});

test('the withheld flag is never written to stored config', () => {
  const stored = storedConfig();
  const roundTripped = scrubAllSecrets(copy(stored));
  preserveAllSecrets(roundTripped, stored);
  assert.ok(!JSON.stringify(roundTripped).includes(WITHHELD_FLAG));
});

/* A manifest that loads again between the read and the save must not leave the
   marker behind on a widget that is now handled normally. */
test('the flag is dropped even when the widget became recognised again', () => {
  const stored = storedConfig();
  const incoming = copy(stored);
  const w1 = find(incoming, 'w1');
  w1[WITHHELD_FLAG] = true;
  preserveAllSecrets(incoming, stored);
  assert.ok(!(WITHHELD_FLAG in w1));
});

/* The case that makes this more than housekeeping is a wrong WIDGETS_PATH: the
   registry loads empty and every widget is unrecognised at once. WIDGETS_PATH is
   read once at module load, so that case is exercised in its own process, in
   unknown-widget-empty-registry.test.js. */
