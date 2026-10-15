const path = require('node:path');

process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('option-labels'), 'apps.json');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { saveConfig } = require('../src/config');
const { labelOptions } = require('../src/widget-data');
const { _resetCache } = require('../src/widget-i18n');

const entry = { dir: path.join(__dirname, '../../ui/widgets/system-summary') };
const body = () => ({
  options: [
    { value: '*', label: 'All interfaces', labelKey: 'network.interface.all' },
    { value: 'eth0', label: 'eth0' },
  ],
});

beforeEach(() => _resetCache());

test('an option named by key takes its label from the configured language', () => {
  saveConfig({ items: [], settings: { language: 'de' } });
  const out = labelOptions(body(), entry, 'system-summary');
  assert.deepEqual(out.options, [
    { value: '*', label: 'Alle Schnittstellen' },
    { value: 'eth0', label: 'eth0' },
  ]);
});

test('an option whose key no catalog has keeps its English label', () => {
  saveConfig({ items: [], settings: { language: 'fr' } });
  const out = labelOptions(
    { options: [{ value: 'x', label: 'Fallback', labelKey: 'no.such.key' }] },
    entry,
    'system-summary',
  );
  assert.deepEqual(out.options, [{ value: 'x', label: 'Fallback' }]);
});

test('a reply without keyed options passes through untouched', () => {
  const plain = { options: [{ value: 'a', label: 'a' }] };
  assert.equal(labelOptions(plain, entry, 'system-summary'), plain);
  assert.equal(labelOptions(null, entry, 'system-summary'), null);
});
