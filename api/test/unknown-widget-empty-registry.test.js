/* The worst case for P6-1: WIDGETS_PATH points somewhere unusable, so no
   manifests load and every widget is unrecognised at once.

   Before the default was inverted, that meant every widget's config went to the
   browser and into the export with its credentials intact, off the back of a
   single log warning. Its own process because WIDGETS_PATH is read once when
   api/src/widgets.js loads. */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.WIDGETS_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sy-nowidgets-')), 'missing');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getRegistry } = require('../src/widgets');
const { scrubAllSecrets, preserveAllSecrets } = require('../src/config-secrets');

const stored = () => ({
  items: [
    { id: 'w1', type: 'widget', widgetType: 'books', widgetConfig: { absUrl: 'https://real.example', absKey: 'KNOWN-SECRET' } },
    { id: 'w2', type: 'widget', widgetType: 'stats', widgetConfig: { token: 'ANOTHER-SECRET' } },
  ],
});
const copy = v => JSON.parse(JSON.stringify(v));

test('the registry really is empty in this process', () => {
  assert.deepEqual(Object.keys(getRegistry()), []);
});

test('no widget config reaches the browser when no manifests load', () => {
  const sent = scrubAllSecrets(copy(stored()));
  const text = JSON.stringify(sent);
  assert.ok(!text.includes('KNOWN-SECRET'), 'a missing registry must not expose every credential');
  assert.ok(!text.includes('ANOTHER-SECRET'));
  for (const item of sent.items) assert.deepEqual(item.widgetConfig, {});
});

test('and saving in that state still does not destroy anything', () => {
  const before = stored();
  const roundTripped = scrubAllSecrets(copy(before));
  preserveAllSecrets(roundTripped, before);
  assert.deepEqual(roundTripped.items, before.items);
});
