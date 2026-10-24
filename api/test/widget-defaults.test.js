const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('wdef');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');
process.env.WIDGETS_PATH = path.join(_tmp, 'widgets');

const MANIFEST = {
  name: 'fixture',
  label: 'Fixture',
  sizes: ['medium'],
  views: { main: { src: 'index.html' } },
  fields: [
    {
      key: 'provider',
      type: 'select',
      label: 'Provider',
      default: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { key: 'url', type: 'text', label: 'URL' },
  ],
};
const _fx = path.join(_tmp, 'widgets', 'fixture');
fs.mkdirSync(_fx, { recursive: true });
fs.writeFileSync(path.join(_fx, 'widget.json'), JSON.stringify(MANIFEST));
fs.writeFileSync(path.join(_fx, 'index.html'), '');
fs.writeFileSync(path.join(_fx, 'data.js'), 'module.exports = async ctx => ({ config: ctx.config });\n');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withManifestDefaults } = require('../src/widget-defaults');

const entry = fields => ({ manifest: { fields } });

test('an absent field gets its default and a set one keeps its value', () => {
  const e = entry([
    { key: 'provider', type: 'select', default: 'a' },
    { key: 'on', type: 'toggle', default: false },
  ]);
  assert.deepEqual(withManifestDefaults({}, e), { provider: 'a', on: false });
  assert.deepEqual(withManifestDefaults({ provider: 'b', on: true }, e), { provider: 'b', on: true });
  assert.deepEqual(withManifestDefaults({ provider: '' }, e), { provider: '', on: false });
});

test('the input config is left unchanged', () => {
  const cfg = { rows: [{ url: 'x' }] };
  const out = withManifestDefaults(
    cfg,
    entry([
      { key: 'provider', type: 'select', default: 'a' },
      { key: 'rows', type: 'group', fields: [{ key: 'type', type: 'select', default: 'cpu' }] },
    ]),
  );
  assert.deepEqual(cfg, { rows: [{ url: 'x' }] });
  assert.deepEqual(out, { provider: 'a', rows: [{ url: 'x', type: 'cpu' }] });
});

test('cosmetic, transient and secret fields get no default', () => {
  const e = entry([
    { key: 'units', type: 'select', default: 'c', cosmetic: true },
    { key: 'search', type: 'text', default: '', transient: true },
    { key: 'key', type: 'secret', default: 'x' },
  ]);
  assert.deepEqual(withManifestDefaults({}, e), {});
});

test('a key declared with differing defaults, or once without one, gets none', () => {
  assert.deepEqual(
    withManifestDefaults(
      {},
      entry([
        { key: 'p', type: 'select', default: 'a' },
        { key: 'p', type: 'select', default: 'b' },
        { key: 'q', type: 'select', default: 'a' },
        { key: 'q', type: 'select' },
        { key: 'r', type: 'select', default: 'a' },
        { key: 'r', type: 'select', default: 'a' },
      ]),
    ),
    { r: 'a' },
  );
});

test('rows of a group and the keys of an object get their defaults', () => {
  const e = entry([
    { key: 'slots', type: 'group', fields: [{ key: 'type', type: 'select', default: 'cpu' }] },
    { key: 'slots', type: 'group', fields: [{ key: 'type', type: 'select', default: 'cpu' }] },
    { key: 'vpn', type: 'object', fields: [{ key: 'service', type: 'select', default: 'gluetun' }] },
  ]);
  assert.deepEqual(withManifestDefaults({ slots: [{}, { type: 'disk' }, 'junk'], vpn: {} }, e), {
    slots: [{ type: 'cpu' }, { type: 'disk' }, 'junk'],
    vpn: { service: 'gluetun' },
  });
});

test('a default array is copied, not shared', () => {
  const e = entry([{ key: 'list', type: 'multiselect', default: ['a'] }]);
  withManifestDefaults({}, e).list.push('b');
  assert.deepEqual(withManifestDefaults({}, e).list, ['a']);
});

test('the data function reads a saved config with its defaults filled in', async () => {
  const { getRegistry } = require('../src/widgets');
  const { getWidgetData } = require('../src/widget-data');
  const out = await getWidgetData(
    { widgetType: 'fixture', widgetConfig: { url: 'http://x' } },
    getRegistry().fixture,
    '',
    new URLSearchParams(),
    null,
  );
  assert.deepEqual(out.body.config, { provider: 'a', url: 'http://x' });
});
